import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const TICK_MS = Number(process.env["PULSE_TICK_MS"] ?? 3000);
const OBS_HOST = process.env["OBS_WS_HOST"] ?? "localhost";
const OBS_PORT = Number(process.env["OBS_WS_PORT"] ?? 4455);
const OBS_TIMEOUT_MS = Number(process.env["OBS_WS_TIMEOUT_MS"] ?? 500);
const SCHEMA_VERSION = 1;
const SIGNAL_CONFIRM_WINDOW_MS = Number(process.env["PULSE_SIGNAL_WINDOW_MS"] ?? 1500);
const SESSIONEND_MATCH_WINDOW_MS = 5000;

export type TerminationSignal = "SIGTERM" | "SIGINT" | "SIGHUP";

export interface SessionEndMatch {
  timestamp: string | null;
  reason: string | null;
  action: string | null;
  age_ms: number | null;
  hook_pid: number | null;
  pulse_signal_sent: boolean | null;
}

export interface DelamainRecord {
  name: string;
  slug: string;
  pid: number | null;
  alive: boolean;
  state: DelamainState;
  active: number;
  blocked: number;
  error: string | null;
}

export interface PulseMetaFile {
  schema_version: number;
  pid: number;
  last_tick: number;
  tick_ms: number;
}

export interface PulseDelamainsFile {
  schema_version: number;
  last_tick: number;
  delamains: DelamainRecord[];
}

export interface PulseLiveFile {
  schema_version: number;
  last_tick: number;
  connected: boolean;
  streaming: boolean;
  recording: boolean;
  state: "live" | "offline";
}

type DelamainState = "offline" | "idle" | "active" | "warn" | "error";

interface ObsResult {
  connected: boolean;
  streaming: boolean;
  recording: boolean;
}

interface PulseRuntimeOptions {
  systemRoot: string | null;
}

const OBS_FAIL: ObsResult = { connected: false, streaming: false, recording: false };
const textDecoder = new TextDecoder();

export function discoverSystemRoot(input: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}): string | null {
  const env = input.env ?? process.env;
  const explicit = env["ALS_SYSTEM_ROOT"] ?? env["SYSTEM_ROOT"];
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    const resolved = resolve(explicit);
    return existsSync(join(resolved, ".als", "system.ts")) ? resolved : null;
  }

  let cursor = resolve(input.cwd ?? process.cwd());
  while (cursor !== dirname(cursor)) {
    if (existsSync(join(cursor, ".als", "system.ts"))) {
      return cursor;
    }
    cursor = dirname(cursor);
  }

  return existsSync(join(cursor, ".als", "system.ts")) ? cursor : null;
}

export class PulseRuntime {
  readonly systemRoot: string | null;
  private readonly cacheDir: string | null;
  private readonly signalHandlers = new Map<TerminationSignal, () => void>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private advisoryResetTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingTermination: { signal: TerminationSignal; at_ms: number } | null = null;
  private tickInFlight = false;
  private shuttingDown = false;
  private started = false;

  constructor(options: PulseRuntimeOptions) {
    this.systemRoot = options.systemRoot ? resolve(options.systemRoot) : null;
    this.cacheDir = this.systemRoot
      ? join(this.systemRoot, ".claude", "scripts", ".cache", "pulse")
      : null;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    if (this.cacheDir) {
      mkdirSync(this.cacheDir, { recursive: true });
    }

    for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
      const handler = () => this.handleTerminationSignal(signal);
      this.signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }

    void this.tick();
    this.interval = setInterval(() => {
      void this.tick();
    }, TICK_MS);
  }

  stop(): void {
    if (!this.started) {
      return;
    }

    this.started = false;
    if (this.interval != null) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.clearPendingTermination();

    for (const [signal, handler] of this.signalHandlers) {
      process.off(signal, handler);
    }
    this.signalHandlers.clear();
  }

  async tick(): Promise<void> {
    if (this.tickInFlight || this.shuttingDown || !this.cacheDir || !this.systemRoot) {
      return;
    }

    this.tickInFlight = true;
    try {
      const now = Date.now();

      const delamains = scanDelamains(this.systemRoot);
      atomicWriteJSON(this.cacheDir, "delamains", {
        schema_version: SCHEMA_VERSION,
        last_tick: now,
        delamains,
      } satisfies PulseDelamainsFile);

      let obs: ObsResult;
      try {
        obs = await probeObs();
      } catch {
        obs = OBS_FAIL;
      }

      const live = obs.streaming || obs.recording;
      atomicWriteJSON(this.cacheDir, "live", {
        schema_version: SCHEMA_VERSION,
        last_tick: Date.now(),
        connected: obs.connected,
        streaming: obs.streaming,
        recording: obs.recording,
        state: live ? "live" : "offline",
      } satisfies PulseLiveFile);

      atomicWriteJSON(this.cacheDir, "meta", {
        schema_version: SCHEMA_VERSION,
        pid: process.pid,
        last_tick: Date.now(),
        tick_ms: TICK_MS,
      } satisfies PulseMetaFile);
    } catch (error) {
      console.error(`pulse: tick failed: ${String(error)}`);
    } finally {
      this.tickInFlight = false;
    }
  }

  private handleTerminationSignal(signal: TerminationSignal): void {
    if (!this.cacheDir) {
      this.stop();
      process.exit(0);
    }

    if (this.shuttingDown) {
      return;
    }

    const priorSignal = this.pendingTermination;
    if (priorSignal != null && Date.now() - priorSignal.at_ms <= SIGNAL_CONFIRM_WINDOW_MS) {
      this.shutdown(signal, priorSignal.signal);
      return;
    }

    appendDiagnosticLog(this.cacheDir, "shutdown.log", {
      timestamp: new Date().toISOString(),
      event: "signal_advisory",
      confirm_window_ms: SIGNAL_CONFIRM_WINDOW_MS,
      prior_signal: priorSignal?.signal ?? null,
      ...buildSignalDiagnostic(this.cacheDir, signal),
    });
    this.armPendingTermination(signal);
  }

  private shutdown(signal: TerminationSignal, firstSignal: TerminationSignal | null): void {
    if (this.shuttingDown) {
      return;
    }

    this.shuttingDown = true;
    this.stop();

    if (this.cacheDir) {
      appendDiagnosticLog(this.cacheDir, "shutdown.log", {
        timestamp: new Date().toISOString(),
        event: "shutdown",
        first_signal: firstSignal,
        confirm_window_ms: SIGNAL_CONFIRM_WINDOW_MS,
        ...buildSignalDiagnostic(this.cacheDir, signal),
      });
      try {
        unlinkSync(join(this.cacheDir, "meta.json"));
      } catch {
        // Already gone or never written.
      }
    }

    process.exit(0);
  }

  private armPendingTermination(signal: TerminationSignal): void {
    this.clearPendingTermination();
    this.pendingTermination = { signal, at_ms: Date.now() };
    this.advisoryResetTimer = setTimeout(() => {
      this.pendingTermination = null;
      this.advisoryResetTimer = null;
    }, SIGNAL_CONFIRM_WINDOW_MS);
  }

  private clearPendingTermination(): void {
    this.pendingTermination = null;
    if (this.advisoryResetTimer != null) {
      clearTimeout(this.advisoryResetTimer);
      this.advisoryResetTimer = null;
    }
  }
}

export function startPulseRuntime(options: PulseRuntimeOptions): PulseRuntime {
  const runtime = new PulseRuntime(options);
  runtime.start();
  return runtime;
}

function atomicWriteJSON(cacheDir: string, topic: string, data: unknown): void {
  const target = join(cacheDir, `${topic}.json`);
  const tmp = join(cacheDir, `${topic}.json.tmp.${process.pid}`);
  try {
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, target);
  } catch (error) {
    console.error(`pulse: atomic write failed for ${topic}: ${String(error)}`);
    try {
      unlinkSync(tmp);
    } catch {
      // Temporary file may not exist.
    }
  }
}

function appendDiagnosticLog(
  cacheDir: string,
  filename: string,
  data: Record<string, unknown>,
): void {
  try {
    appendFileSync(join(cacheDir, filename), `${JSON.stringify(data)}\n`);
  } catch (error) {
    console.error(`pulse: failed to append ${filename}: ${String(error)}`);
  }
}

function resolveParentCommand(ppid: number): string | null {
  if (ppid <= 1) {
    return null;
  }

  try {
    const result = Bun.spawnSync({
      cmd: ["ps", "-p", String(ppid), "-o", "comm="],
      stdout: "pipe",
      stderr: "ignore",
    });
    if (result.exitCode !== 0) {
      return null;
    }

    const parentCommand = textDecoder.decode(result.stdout).trim();
    return parentCommand.length > 0 ? parentCommand : null;
  } catch {
    return null;
  }
}

function readRecentSessionEndMatch(
  cacheDir: string,
  targetPid: number,
): SessionEndMatch | null {
  const sessionEndLog = join(cacheDir, "sessionend.log");
  if (!existsSync(sessionEndLog)) {
    return null;
  }

  let raw: string;
  try {
    raw = readFileSync(sessionEndLog, "utf8");
  } catch {
    return null;
  }

  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const now = Date.now();

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let entry: {
      timestamp?: string;
      reason?: string | null;
      action?: string | null;
      hook_pid?: number | null;
      pulse_pid?: number | null;
      pulse_signal_sent?: boolean | null;
    };

    try {
      entry = JSON.parse(lines[index] ?? "{}") as typeof entry;
    } catch {
      continue;
    }

    if (entry.pulse_pid !== targetPid) {
      continue;
    }

    const entryTimestamp = typeof entry.timestamp === "string" ? entry.timestamp : null;
    const ageMs = entryTimestamp ? now - Date.parse(entryTimestamp) : null;
    if (ageMs == null || !Number.isFinite(ageMs) || ageMs > SESSIONEND_MATCH_WINDOW_MS) {
      return null;
    }

    return {
      timestamp: entryTimestamp,
      reason: typeof entry.reason === "string" ? entry.reason : null,
      action: typeof entry.action === "string" ? entry.action : null,
      age_ms: ageMs,
      hook_pid: typeof entry.hook_pid === "number" ? entry.hook_pid : null,
      pulse_signal_sent:
        typeof entry.pulse_signal_sent === "boolean" ? entry.pulse_signal_sent : null,
    };
  }

  return null;
}

function buildSignalDiagnostic(
  cacheDir: string,
  signal: TerminationSignal,
): Record<string, unknown> {
  const recentSessionEnd = readRecentSessionEndMatch(cacheDir, process.pid);
  return {
    signal,
    pid: process.pid,
    ppid: process.ppid,
    parent_comm: resolveParentCommand(process.ppid),
    recent_sessionend_timestamp: recentSessionEnd?.timestamp ?? null,
    recent_sessionend_reason: recentSessionEnd?.reason ?? null,
    recent_sessionend_action: recentSessionEnd?.action ?? null,
    recent_sessionend_age_ms: recentSessionEnd?.age_ms ?? null,
    recent_sessionend_hook_pid: recentSessionEnd?.hook_pid ?? null,
    recent_sessionend_signal_sent: recentSessionEnd?.pulse_signal_sent ?? null,
  };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function scanDelamains(systemRoot: string): DelamainRecord[] {
  const dirs: string[] = [];
  const primary = join(systemRoot, ".claude", "delamains");
  if (existsSync(primary)) {
    dirs.push(primary);
  }

  const rootsFile = join(systemRoot, ".claude", "delamain-roots");
  if (existsSync(rootsFile)) {
    try {
      const extra = readFileSync(rootsFile, "utf8")
        .split("\n")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      for (const root of extra) {
        const path = join(root, ".claude", "delamains");
        if (existsSync(path)) {
          dirs.push(path);
        }
      }
    } catch {
      // Unreadable roots file is not fatal.
    }
  }

  const out: DelamainRecord[] = [];
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    for (const name of entries) {
      const yaml = join(dir, name, "delamain.yaml");
      if (!existsSync(yaml)) {
        continue;
      }

      const statusFile = join(dir, name, "status.json");
      const slug = name.split("-")[0] ?? name;

      let pid: number | null = null;
      let active = 0;
      let blocked = 0;
      let error: string | null = null;

      if (existsSync(statusFile)) {
        try {
          const raw = JSON.parse(readFileSync(statusFile, "utf8")) as {
            pid?: number;
            active_dispatches?: number;
            blocked_dispatches?: number;
            last_error?: string;
          };
          pid = typeof raw.pid === "number" ? raw.pid : null;
          active = typeof raw.active_dispatches === "number" ? raw.active_dispatches : 0;
          blocked = typeof raw.blocked_dispatches === "number" ? raw.blocked_dispatches : 0;
          error = typeof raw.last_error === "string" && raw.last_error.length > 0
            ? raw.last_error
            : null;
        } catch {
          // Malformed status.json is treated as offline.
        }
      }

      const alive = pid != null && pidAlive(pid);
      let state: DelamainState = "offline";
      if (alive) {
        if (error) {
          state = "error";
        } else if (blocked > 0) {
          state = "warn";
        } else if (active > 0) {
          state = "active";
        } else {
          state = "idle";
        }
      }

      out.push({ name, slug, pid, alive, state, active, blocked, error });
    }
  }

  return out;
}

function probeObs(): Promise<ObsResult> {
  return new Promise((resolve) => {
    let settled = false;
    let ws: WebSocket | null = null;
    let streaming = false;
    let recording = false;
    let phase: "hello" | "identified" | "stream" | "record" | "done" = "hello";

    const settle = (result: ObsResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        // Ignore close errors.
      }
      resolve(result);
    };

    const timer = setTimeout(() => settle(OBS_FAIL), OBS_TIMEOUT_MS);

    try {
      ws = new WebSocket(`ws://${OBS_HOST}:${OBS_PORT}`);
    } catch {
      settle(OBS_FAIL);
      return;
    }

    ws.addEventListener("error", () => settle(OBS_FAIL));
    ws.addEventListener("close", () => {
      if (phase !== "done") {
        settle(OBS_FAIL);
      }
    });

    ws.addEventListener("message", (event) => {
      if (settled) {
        return;
      }

      let message: {
        op?: number;
        d?: {
          requestId?: string;
          responseData?: { outputActive?: boolean };
        };
      };

      try {
        message = JSON.parse(String(event.data)) as typeof message;
      } catch {
        return;
      }

      if (phase === "hello" && message.op === 0) {
        ws?.send(JSON.stringify({ op: 1, d: { rpcVersion: 1 } }));
        phase = "identified";
      } else if (phase === "identified" && message.op === 2) {
        ws?.send(JSON.stringify({ op: 6, d: { requestType: "GetStreamStatus", requestId: "s1" } }));
        phase = "stream";
      } else if (phase === "stream" && message.op === 7 && message.d?.requestId === "s1") {
        streaming = Boolean(message.d.responseData?.outputActive);
        ws?.send(JSON.stringify({ op: 6, d: { requestType: "GetRecordStatus", requestId: "s2" } }));
        phase = "record";
      } else if (phase === "record" && message.op === 7 && message.d?.requestId === "s2") {
        recording = Boolean(message.d.responseData?.outputActive);
        phase = "done";
        settle({ connected: true, streaming, recording });
      }
    });
  });
}
