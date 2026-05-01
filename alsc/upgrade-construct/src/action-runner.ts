import { spawnSync, spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  ConstructAction,
  ConstructActionJsonFilePidLocator,
  ConstructActionManifest,
} from "../../compiler/src/construct-upgrade.ts";
import type { ConstructFailureState } from "../../compiler/src/construct-contracts.ts";
import { resolveRuntimeCommand, resolveRuntimePlaceholderPath, type RuntimePathRoots } from "./paths.ts";
import type { ConstructActionRunnerFailure, ConstructActionRunnerOptions, ConstructActionRunnerResult } from "./types.ts";

const DEFAULT_POLL_MS = 250;
const DEFAULT_DRAIN_ACK_TIMEOUT_MS = 10_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_START_TIMEOUT_MS = 5_000;
export const DISPATCHER_HEARTBEAT_STALE_THRESHOLD_MS = Number(
  process.env["DISPATCHER_HEARTBEAT_STALE_THRESHOLD_MS"] ?? 45_000,
);

export async function runConstructActionManifest(
  manifest: ConstructActionManifest,
  options: ConstructActionRunnerOptions,
): Promise<ConstructActionRunnerResult> {
  let completedActionCount = 0;
  for (let index = 0; index < manifest.actions.length; index += 1) {
    const action = manifest.actions[index]!;
    const failure = await executeAction(action, index, options);
    if (failure) {
      return {
        success: false,
        completed_action_count: completedActionCount,
        total_action_count: manifest.actions.length,
        failure: completedActionCount > 0
          ? {
            ...failure,
            overall_failure_state: "lifecycle-partial",
          }
          : failure,
      };
    }
    completedActionCount += 1;
  }

  return {
    success: true,
    completed_action_count: completedActionCount,
    total_action_count: manifest.actions.length,
    failure: null,
  };
}

export async function locateProcessPid(
  locator: ConstructAction["process_locator"],
  roots: RuntimePathRoots,
): Promise<number | null> {
  if (!locator) {
    return null;
  }

  if (locator.kind === "json-file-pid") {
    const resolvedPath = resolveRuntimePlaceholderPath(locator.path, roots);
    const value = await readJsonFile(resolvedPath);
    const pid = typeof value?.[locator.pid_field] === "number" ? value[locator.pid_field] : null;
    return pid && isProcessAlive(pid) ? pid : null;
  }

  const result = spawnSync("ps", ["-axww", "-o", "pid=,command="], {
    encoding: "utf-8",
  });
  if (result.status !== 0 || typeof result.stdout !== "string") {
    return null;
  }

  return findPidInProcessTable(result.stdout, locator.argv_contains);
}

export function findPidInProcessTable(
  processTable: string,
  argvContains: string[],
): number | null {
  const lines = processTable
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    const match = line.match(/^([0-9]+)\s+(.*)$/);
    if (!match) {
      continue;
    }

    const pid = Number(match[1]);
    const command = match[2]!;
    if (
      argvContains.every((needle) => command.includes(needle))
      && isProcessAlive(pid)
    ) {
      return pid;
    }
  }
  return null;
}

async function executeAction(
  action: ConstructAction,
  actionIndex: number,
  options: ConstructActionRunnerOptions,
): Promise<ConstructActionRunnerFailure | null> {
  switch (action.kind) {
    case "drain-then-restart":
      return executeDrainThenRestart(action, actionIndex, options);
    case "kill-then-restart":
      return executeKillThenRestart(action, actionIndex, options);
    case "start-only":
      return executeStartOnly(action, actionIndex, options);
    default:
      return {
        action_index: actionIndex,
        action_kind: String(action.kind),
        precise_failure_state: "lifecycle-start-failed",
        overall_failure_state: "lifecycle-start-failed",
        message: `Unsupported construct action kind '${String(action.kind)}'.`,
      };
  }
}

async function executeDrainThenRestart(
  action: ConstructAction,
  actionIndex: number,
  options: ConstructActionRunnerOptions,
): Promise<ConstructActionRunnerFailure | null> {
  const roots = {
    system_root: options.system_root,
    plugin_root: options.plugin_root,
  };
  const drainFailure = await waitForDrain(action, roots, options);
  if (drainFailure) {
    return buildFailure(actionIndex, action.kind, drainFailure, "dispatcher drain did not complete cleanly");
  }

  const startFailure = await startAction(action, roots, options);
  return startFailure ? buildFailure(actionIndex, action.kind, startFailure, "dispatcher restart failed") : null;
}

async function executeKillThenRestart(
  action: ConstructAction,
  actionIndex: number,
  options: ConstructActionRunnerOptions,
): Promise<ConstructActionRunnerFailure | null> {
  const roots = {
    system_root: options.system_root,
    plugin_root: options.plugin_root,
  };
  const pid = await locateProcessPid(action.process_locator, roots);
  if (pid !== null) {
    const stopped = await stopPid(pid, options.stop_timeout_ms ?? DEFAULT_STOP_TIMEOUT_MS);
    if (!stopped) {
      return buildFailure(actionIndex, action.kind, "lifecycle-stop-failed", `Could not stop PID ${pid}.`);
    }
  }

  const startFailure = await startAction(action, roots, options);
  return startFailure ? buildFailure(actionIndex, action.kind, startFailure, "process restart failed") : null;
}

async function executeStartOnly(
  action: ConstructAction,
  actionIndex: number,
  options: ConstructActionRunnerOptions,
): Promise<ConstructActionRunnerFailure | null> {
  const roots = {
    system_root: options.system_root,
    plugin_root: options.plugin_root,
  };
  const startFailure = await startAction(action, roots, options);
  return startFailure ? buildFailure(actionIndex, action.kind, startFailure, "process start failed") : null;
}

async function waitForDrain(
  action: ConstructAction,
  roots: RuntimePathRoots,
  options: ConstructActionRunnerOptions,
): Promise<Exclude<ConstructFailureState, "lifecycle-partial"> | null> {
  if (
    action.process_locator?.kind !== "json-file-pid"
    || !action.drain_signal
  ) {
    return "lifecycle-drain-stalled";
  }

  const statusPath = resolveRuntimePlaceholderPath(action.process_locator.path, roots);
  const drainSignalPath = resolveRuntimePlaceholderPath(action.drain_signal.path, roots);
  await mkdir(dirname(drainSignalPath), { recursive: true });
  await writeFile(drainSignalPath, JSON.stringify(action.drain_signal.payload, null, 2) + "\n", "utf-8");

  const pollMs = options.poll_ms ?? DEFAULT_POLL_MS;
  const ackDeadline = Date.now() + (options.drain_ack_timeout_ms ?? DEFAULT_DRAIN_ACK_TIMEOUT_MS);
  const staleThreshold = options.dispatcher_heartbeat_stale_threshold_ms ?? DISPATCHER_HEARTBEAT_STALE_THRESHOLD_MS;

  while (Date.now() < ackDeadline) {
    const status = await readJsonFile(statusPath);
    if (
      status?.lifecycle_mode === "draining"
      && isFreshHeartbeat(status?.last_tick, staleThreshold)
    ) {
      break;
    }
    await sleep(pollMs);
  }

  const acknowledgedStatus = await readJsonFile(statusPath);
  if (
    acknowledgedStatus?.lifecycle_mode !== "draining"
    || !isFreshHeartbeat(acknowledgedStatus?.last_tick, staleThreshold)
  ) {
    return "lifecycle-drain-stalled";
  }

  while (true) {
    const status = await readJsonFile(statusPath);
    if (!isFreshHeartbeat(status?.last_tick, staleThreshold)) {
      return "lifecycle-drain-stalled";
    }
    const activeDispatches = typeof status?.active_dispatches === "number" ? status.active_dispatches : Number.NaN;
    const pid = typeof status?.pid === "number" ? status.pid : null;
    if (activeDispatches === 0 && (pid === null || !isProcessAlive(pid))) {
      await rm(drainSignalPath, { force: true });
      return null;
    }
    await sleep(pollMs);
  }
}

async function startAction(
  action: ConstructAction,
  roots: RuntimePathRoots,
  options: ConstructActionRunnerOptions,
): Promise<Exclude<ConstructFailureState, "lifecycle-partial"> | null> {
  const command = resolveRuntimeCommand(action.start.command, roots);
  const cwd = resolveRuntimePlaceholderPath(action.start.cwd, roots);
  const child = spawn(command[0]!, command.slice(1), {
    cwd,
    detached: true,
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: roots.plugin_root,
    },
    stdio: "ignore",
  });
  child.unref();

  if (!action.process_locator) {
    return null;
  }

  const deadline = Date.now() + (options.start_timeout_ms ?? DEFAULT_START_TIMEOUT_MS);
  while (Date.now() < deadline) {
    const pid = await locateProcessPid(action.process_locator, roots);
    if (pid !== null) {
      return null;
    }
    await sleep(options.poll_ms ?? DEFAULT_POLL_MS);
  }

  return "lifecycle-start-failed";
}

async function stopPid(pid: number, timeoutMs: number): Promise<boolean> {
  if (!isProcessAlive(pid)) {
    return true;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return true;
  }
  if (await waitForExit(pid, timeoutMs)) {
    return true;
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return true;
  }

  return waitForExit(pid, timeoutMs);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await sleep(DEFAULT_POLL_MS);
  }
  return !isProcessAlive(pid);
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isFreshHeartbeat(value: unknown, staleThresholdMs: number): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  return Date.now() - timestamp <= staleThresholdMs;
}

function buildFailure(
  actionIndex: number,
  actionKind: string,
  preciseFailureState: Exclude<ConstructFailureState, "lifecycle-partial">,
  message: string,
): ConstructActionRunnerFailure {
  return {
    action_index: actionIndex,
    action_kind: actionKind,
    precise_failure_state: preciseFailureState,
    overall_failure_state: preciseFailureState,
    message,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
