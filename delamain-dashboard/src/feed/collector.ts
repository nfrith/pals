import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { loadRuntimeManifest } from "../../../skills/new/references/dispatcher/src/runtime-manifest.ts";
import {
  readRuntimeState,
  resolveRuntimeStatePaths,
  summarizeRuntimeState,
  type RuntimeDispatchSummary,
} from "../../../skills/new/references/dispatcher/src/runtime-state.ts";
import {
  readTelemetryEvents,
  resolveTelemetryPaths,
  type DispatchTelemetryEvent,
} from "../../../skills/new/references/dispatcher/src/telemetry.ts";
import { scan } from "../../../skills/new/references/dispatcher/src/watcher.ts";
import { parseDelamainYaml } from "./delamain-yaml.ts";
import { discoverDelamainBundles } from "./discovery.ts";
import type {
  DashboardSnapshot,
  DispatcherDefinition,
  DispatcherHeartbeat,
  DispatcherItemRecord,
  DispatcherItemSummary,
  DispatcherRecentError,
  DispatcherRecentRun,
  DispatcherSnapshot,
} from "./types.ts";

interface CollectOptions {
  systemRoot: string;
  telemetryLimit?: number;
  now?: Date;
}

export async function collectSystemSnapshot(
  options: CollectOptions,
): Promise<DashboardSnapshot> {
  const telemetryLimit = options.telemetryLimit ?? 25;
  const now = options.now ?? new Date();
  const discovered = await discoverDelamainBundles(options.systemRoot);
  const dispatchers = await Promise.all(
    discovered.bundles.map((bundle) => collectDispatcherSnapshot(bundle, now, telemetryLimit)),
  );

  return {
    schema: "als-delamain-dashboard-snapshot@1",
    generatedAt: now.toISOString(),
    systemRoot: options.systemRoot,
    roots: discovered.roots,
    dispatcherCount: dispatchers.length,
    dispatchers,
  };
}

async function collectDispatcherSnapshot(
  bundle: { name: string; systemRoot: string; bundleRoot: string },
  now: Date,
  telemetryLimit: number,
): Promise<DispatcherSnapshot> {
  const telemetryPaths = resolveTelemetryPaths(bundle.bundleRoot);
  let heartbeatResult: Awaited<ReturnType<typeof readHeartbeat>> = {
    heartbeat: null,
    error: null,
  };
  let manifestResult: Awaited<ReturnType<typeof readRuntimeManifest>> = {
    manifest: null,
    error: null,
  };
  let definitionResult: Awaited<ReturnType<typeof readDefinition>> = {
    definition: null,
    error: null,
  };
  let runtimeResult: Awaited<ReturnType<typeof readDispatcherRuntimeState>> = {
    available: false,
    path: resolveRuntimeStatePaths(bundle.bundleRoot).stateFile,
    summary: emptyRuntimeSummary(now),
  };
  let telemetryResult: Awaited<ReturnType<typeof readTelemetryEvents>> = {
    available: false,
    events: [],
    parse_errors: 0,
  };

  try {
    heartbeatResult = await readHeartbeat(bundle.bundleRoot);
    manifestResult = await readRuntimeManifest(bundle.bundleRoot);
    definitionResult = await readDefinition(bundle.bundleRoot);
    runtimeResult = await readDispatcherRuntimeState(bundle.bundleRoot);
    telemetryResult = await readTelemetryEvents(bundle.bundleRoot, telemetryLimit);
    const items = await readItems(bundle.systemRoot, manifestResult.manifest);

    return buildDispatcherSnapshot({
      bundle,
      now,
      heartbeatResult,
      manifestResult,
      definitionResult,
      runtimeResult,
      telemetryResult,
      telemetryPaths,
      items,
    });
  } catch (error) {
    console.warn(
      `[delamain-dashboard] failed collecting dispatcher snapshot for '${bundle.name}': ${formatError(error)}`,
    );

    return buildDispatcherSnapshot({
      bundle,
      now,
      heartbeatResult,
      manifestResult,
      definitionResult,
      runtimeResult,
      telemetryResult,
      telemetryPaths,
      items: [],
      failureDetail: `Dispatcher snapshot failed: ${formatError(error)}`,
    });
  }
}

function buildDispatcherSnapshot(input: {
  bundle: { name: string; systemRoot: string; bundleRoot: string };
  now: Date;
  heartbeatResult: Awaited<ReturnType<typeof readHeartbeat>>;
  manifestResult: Awaited<ReturnType<typeof readRuntimeManifest>>;
  definitionResult: Awaited<ReturnType<typeof readDefinition>>;
  runtimeResult: Awaited<ReturnType<typeof readDispatcherRuntimeState>>;
  telemetryResult: Awaited<ReturnType<typeof readTelemetryEvents>>;
  telemetryPaths: ReturnType<typeof resolveTelemetryPaths>;
  items: DispatcherItemRecord[];
  failureDetail?: string;
}): DispatcherSnapshot {
  const { bundle } = input;
  const { heartbeatResult, manifestResult, definitionResult, runtimeResult, telemetryResult } = input;
  const items = input.items;
  const itemSummary = summarizeItems(items, definitionResult.definition);
  const recentRun = findRecentRun(telemetryResult.events);
  const recentError = findRecentError(telemetryResult.events);

  const classification = input.failureDetail
    ? {
      state: "error" as const,
      detail: input.failureDetail,
      pidLive: isProcessAlive(heartbeatResult.heartbeat?.pid ?? null),
      lastTickAgeMs: measureAgeMs(heartbeatResult.heartbeat?.lastTick ?? null, input.now),
    }
    : classifyDispatcher({
      bundleName: bundle.name,
      heartbeat: heartbeatResult.heartbeat,
      heartbeatError: heartbeatResult.error,
      manifestError: manifestResult.error,
      definitionError: definitionResult.error,
      runtimeSummary: runtimeResult.summary,
      recentRun,
      now: input.now,
    });

  return {
    name: bundle.name,
    systemRoot: bundle.systemRoot,
    bundleRoot: bundle.bundleRoot,
    state: classification.state,
    detail: classification.detail,
    heartbeat: heartbeatResult.heartbeat,
    pidLive: classification.pidLive,
    lastTickAgeMs: classification.lastTickAgeMs,
    pollMs: heartbeatResult.heartbeat?.pollMs ?? null,
    activeDispatches: Math.max(
      heartbeatResult.heartbeat?.activeDispatches ?? 0,
      runtimeResult.summary.activeCount,
    ),
    itemsScanned: heartbeatResult.heartbeat?.itemsScanned ?? 0,
    moduleId: manifestResult.manifest?.module_id ?? null,
    moduleVersion: manifestResult.manifest?.module_version ?? null,
    moduleMountPath: manifestResult.manifest?.module_mount_path ?? null,
    entityName: manifestResult.manifest?.entity_name ?? null,
    entityPath: manifestResult.manifest?.entity_path ?? null,
    statusField: manifestResult.manifest?.status_field ?? null,
    phaseOrder: definitionResult.definition?.phases ?? [],
    states: definitionResult.definition?.states ?? {},
    transitions: definitionResult.definition?.transitions ?? [],
    items,
    itemSummary,
    recentEvents: telemetryResult.events,
    recentRun,
    recentError,
    runtime: {
      available: runtimeResult.available,
      path: runtimeResult.path,
      active: runtimeResult.summary.active,
      blocked: runtimeResult.summary.blocked,
      orphaned: runtimeResult.summary.orphaned,
      guarded: runtimeResult.summary.guarded,
    },
    journeyTelemetry: buildJourneyTelemetry(runtimeResult.summary, telemetryResult.events, input.now),
    telemetry: {
      available: telemetryResult.available,
      legacyMode: !telemetryResult.available,
      path: input.telemetryPaths.eventsFile,
      parseErrors: telemetryResult.parse_errors,
    },
  };
}

function emptyRuntimeSummary(now: Date): RuntimeDispatchSummary {
  return summarizeRuntimeState({
    schema: "als-delamain-worktree-state@1",
    updated_at: now.toISOString(),
    records: [],
  });
}

async function readHeartbeat(bundleRoot: string): Promise<{
  heartbeat: DispatcherHeartbeat | null;
  error: string | null;
}> {
  const statusFile = join(bundleRoot, "status.json");

  let raw: string;
  try {
    raw = await readFile(statusFile, "utf-8");
  } catch (error) {
    if (isMissing(error)) {
      return {
        heartbeat: null,
        error: null,
      };
    }
    return {
      heartbeat: null,
      error: `Heartbeat unreadable: ${formatError(error)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      heartbeat: null,
      error: `Heartbeat is invalid JSON: ${formatError(error)}`,
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      heartbeat: null,
      error: "Heartbeat must be a JSON object",
    };
  }

  const value = parsed as Record<string, unknown>;

  return {
    heartbeat: {
      name: asString(value["name"]) ?? "unknown",
      pid: asNumber(value["pid"]),
      lastTick: asString(value["last_tick"]),
      pollMs: asNumber(value["poll_ms"]),
      activeDispatches: asNumber(value["active_dispatches"]) ?? 0,
      activeByProvider: {
        anthropic: asProviderNumber(value["active_by_provider"], "anthropic"),
        openai: asProviderNumber(value["active_by_provider"], "openai"),
      },
      blockedDispatches: asNumber(value["blocked_dispatches"]) ?? 0,
      orphanedDispatches: asNumber(value["orphaned_dispatches"]) ?? 0,
      guardedDispatches: asNumber(value["guarded_dispatches"]) ?? 0,
      itemsScanned: asNumber(value["items_scanned"]) ?? 0,
    },
    error: null,
  };
}

function asProviderNumber(
  value: unknown,
  provider: "anthropic" | "openai",
): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return 0;
  }

  return asNumber((value as Record<string, unknown>)[provider]) ?? 0;
}

async function readRuntimeManifest(bundleRoot: string): Promise<{
  manifest: Awaited<ReturnType<typeof loadRuntimeManifest>> | null;
  error: string | null;
}> {
  try {
    return {
      manifest: await loadRuntimeManifest(bundleRoot),
      error: null,
    };
  } catch (error) {
    return {
      manifest: null,
      error: `Runtime manifest unavailable: ${formatError(error)}`,
    };
  }
}

async function readDefinition(bundleRoot: string): Promise<{
  definition: DispatcherDefinition | null;
  error: string | null;
}> {
  const definitionPath = join(bundleRoot, "delamain.yaml");

  try {
    const raw = await readFile(definitionPath, "utf-8");
    return {
      definition: parseDelamainYaml(raw),
      error: null,
    };
  } catch (error) {
    return {
      definition: null,
      error: `Delamain graph unavailable: ${formatError(error)}`,
    };
  }
}

async function readDispatcherRuntimeState(bundleRoot: string): Promise<{
  available: boolean;
  path: string;
  summary: RuntimeDispatchSummary;
}> {
  const paths = resolveRuntimeStatePaths(bundleRoot);
  const available = existsSync(paths.stateFile);

  try {
    const state = await readRuntimeState(bundleRoot);
    return {
      available,
      path: paths.stateFile,
      summary: summarizeRuntimeState(state),
    };
  } catch (error) {
    console.warn(
      `[delamain-dashboard] failed reading runtime worktree state for '${bundleRoot}': ${formatError(error)}`,
    );
    return {
      available,
      path: paths.stateFile,
      summary: summarizeRuntimeState({
        schema: "als-delamain-worktree-state@1",
        updated_at: new Date().toISOString(),
        records: [],
      }),
    };
  }
}

async function readItems(
  systemRoot: string,
  manifest: Awaited<ReturnType<typeof loadRuntimeManifest>> | null,
): Promise<DispatcherItemRecord[]> {
  if (!manifest) return [];

  const moduleRoot = join(systemRoot, manifest.module_mount_path);
  const items = await scan(
    moduleRoot,
    manifest.entity_path,
    manifest.status_field,
    manifest.discriminator_field ?? undefined,
    manifest.discriminator_value ?? undefined,
  );

  return items
    .map((item) => ({
      id: item.id,
      status: item.status,
      type: item.type,
      filePath: item.filePath,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function summarizeItems(
  items: DispatcherItemRecord[],
  definition: DispatcherDefinition | null,
): DispatcherItemSummary {
  const byState: Record<string, number> = {};
  const byActor = {
    agent: 0,
    operator: 0,
    terminal: 0,
    unknown: 0,
  };

  for (const item of items) {
    byState[item.status] = (byState[item.status] ?? 0) + 1;
    const state = definition?.states[item.status];

    if (state?.terminal) {
      byActor.terminal += 1;
    } else if (state?.actor === "agent") {
      byActor.agent += 1;
    } else if (state?.actor === "operator") {
      byActor.operator += 1;
    } else {
      byActor.unknown += 1;
    }
  }

  return {
    totalItems: items.length,
    byState,
    byActor,
  };
}

function buildJourneyTelemetry(
  runtimeSummary: RuntimeDispatchSummary,
  events: DispatchTelemetryEvent[],
  now: Date,
): DispatcherSnapshot["journeyTelemetry"] {
  const activeJobs = [
    ...runtimeSummary.active,
    ...runtimeSummary.guarded,
    ...runtimeSummary.blocked,
    ...runtimeSummary.orphaned,
  ].map((record) => {
    const startedAt = Date.parse(record.started_at);
    return {
      dispatchId: record.dispatch_id,
      jobId: record.item_id,
      state: record.state,
      age_ms: Number.isFinite(startedAt) ? Math.max(0, now.getTime() - startedAt) : 0,
      provider: record.provider,
      status: record.status,
    };
  });

  const recentEdges = events.flatMap((event) => {
    if (event.transition_targets.length === 0) return [];
    return event.transition_targets.map((target) => ({
      from: event.state,
      to: target,
      t: event.timestamp,
    }));
  });

  return {
    activeJobs,
    recentEdges,
  };
}

function findRecentRun(events: DispatchTelemetryEvent[]): DispatcherRecentRun | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.event_type !== "dispatch_finish" && event.event_type !== "dispatch_failure") {
      continue;
    }

    return {
      outcome: event.event_type === "dispatch_finish" ? "success" : "failure",
      timestamp: event.timestamp,
      itemId: event.item_id,
      state: event.state,
      durationMs: event.duration_ms,
      numTurns: event.num_turns,
      costUsd: event.cost_usd,
      error: event.error,
      sessionId: event.worker_session_id,
    };
  }

  return null;
}

function findRecentError(events: DispatchTelemetryEvent[]): DispatcherRecentError | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.event_type !== "dispatch_failure" || !event.error) continue;
    return {
      timestamp: event.timestamp,
      itemId: event.item_id,
      state: event.state,
      error: event.error,
    };
  }

  return null;
}

function classifyDispatcher(input: {
  bundleName: string;
  heartbeat: DispatcherHeartbeat | null;
  heartbeatError: string | null;
  manifestError: string | null;
  definitionError: string | null;
  runtimeSummary: RuntimeDispatchSummary;
  recentRun: DispatcherRecentRun | null;
  now: Date;
}): {
  state: DispatcherSnapshot["state"];
  detail: string;
  pidLive: boolean;
  lastTickAgeMs: number | null;
} {
  if (input.heartbeatError) {
    return {
      state: "error",
      detail: input.heartbeatError,
      pidLive: false,
      lastTickAgeMs: null,
    };
  }

  const heartbeat = input.heartbeat;
  if (!heartbeat) {
    return {
      state: "offline",
      detail: `${input.bundleName} has not written a heartbeat yet`,
      pidLive: false,
      lastTickAgeMs: null,
    };
  }

  const pidLive = isProcessAlive(heartbeat.pid);
  const lastTickAgeMs = measureAgeMs(heartbeat.lastTick, input.now);

  if (heartbeat.lastTick && lastTickAgeMs === null) {
    return {
      state: "error",
      detail: "Heartbeat last_tick is invalid",
      pidLive,
      lastTickAgeMs: null,
    };
  }

  if (input.manifestError) {
    return {
      state: "error",
      detail: input.manifestError,
      pidLive,
      lastTickAgeMs,
    };
  }

  if (input.definitionError) {
    return {
      state: "error",
      detail: input.definitionError,
      pidLive,
      lastTickAgeMs,
    };
  }

  if (!pidLive) {
    return {
      state: "offline",
      detail: "Dispatcher PID is no longer running",
      pidLive: false,
      lastTickAgeMs,
    };
  }

  const staleAfterMs = Math.max(60_000, (heartbeat.pollMs ?? 30_000) * 2);
  if (lastTickAgeMs !== null && lastTickAgeMs > staleAfterMs) {
    return {
      state: "stale",
      detail: `Heartbeat is older than ${staleAfterMs}ms`,
      pidLive,
      lastTickAgeMs,
    };
  }

  if (input.recentRun?.outcome === "failure") {
    return {
      state: "error",
      detail: `Last run failed on ${input.recentRun.itemId}`,
      pidLive,
      lastTickAgeMs,
    };
  }

  if (input.runtimeSummary.blockedCount > 0) {
    return {
      state: "error",
      detail: `${input.runtimeSummary.blockedCount} blocked dispatch incident${input.runtimeSummary.blockedCount === 1 ? "" : "s"}`,
      pidLive,
      lastTickAgeMs,
    };
  }

  if (input.runtimeSummary.orphanedCount > 0) {
    return {
      state: "error",
      detail: `${input.runtimeSummary.orphanedCount} orphaned worktree${input.runtimeSummary.orphanedCount === 1 ? "" : "s"}`,
      pidLive,
      lastTickAgeMs,
    };
  }

  const activeDispatches = Math.max(heartbeat.activeDispatches, input.runtimeSummary.activeCount);
  if (activeDispatches > 0) {
    return {
      state: "live",
      detail: `${activeDispatches} active dispatch${activeDispatches === 1 ? "" : "es"}`,
      pidLive,
      lastTickAgeMs,
    };
  }

  return {
    state: "idle",
    detail: "Dispatcher is idle",
    pidLive,
    lastTickAgeMs,
  };
}

function isProcessAlive(pid: number | null): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function measureAgeMs(timestamp: string | null, now: Date): number | null {
  if (!timestamp) return null;
  const value = Date.parse(timestamp);
  if (Number.isNaN(value)) return null;
  return Math.max(0, now.getTime() - value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
