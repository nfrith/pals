#!/usr/bin/env bun
/**
 * pulse.ts — Background data producer for the ALS statusline engine (GF-034, Phase 2).
 *
 * Long-running bun process spawned by /bootup. Probes delamain health and OBS
 * live-stream state every TICK_MS, writing raw state (no ANSI) to atomic JSON
 * files under {SYSTEM_ROOT}/.claude/scripts/.cache/pulse/:
 *
 *   - meta.json       — {pid, last_tick, schema_version, tick_ms}
 *   - delamains.json  — {last_tick, delamains: [{name, slug, pid, alive, state, active, blocked, error}]}
 *   - live.json       — {last_tick, connected, streaming, recording, state: "live"|"offline"}
 *
 * The cache format is source-agnostic and consumer-agnostic (no ANSI, no
 * Claude-Code-specific fields). Any face (statusline.sh, future tmux-pane TUI,
 * web, etc.) can consume it and render for its own surface. Pulse never
 * writes to stdout on the face's render path; stderr only on error.
 *
 * Atomic writes via `.tmp + rename` (POSIX atomic rename) — mid-write reads
 * must never yield malformed JSON, per GHOST-163 (2026-04-08): malformed ANSI
 * in a face causes Claude Code to permanently disable the statusline for the
 * session.
 *
 * Lifecycle: spawned by /bootup alongside delamain dispatchers. Survives /clear
 * and /resume (same policy as dispatchers, per GF-034 Q4(a)); lone termination
 * signals are advisory only, and shutdown requires a confirmed signal pair.
 * Diagnostic breadcrumbs land in shutdown.log (pulse-side) and sessionend.log
 * (hook-side) under the pulse cache dir.
 *
 * CACHE PATH INVARIANT: pulse receives SYSTEM_ROOT from /bootup's scan.sh,
 * which walks up for `.als/system.ts`. Faces walk up for `.claude/delamains/`.
 * In ALS systems these resolve to the same dir. If a project has one without
 * the other, the face falls back to inline scan (cache appears missing) —
 * acceptable degradation, documented here so future faces can expect it.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const TICK_MS = Number(process.env.PULSE_TICK_MS ?? 3000);
const OBS_HOST = process.env.OBS_WS_HOST ?? 'localhost';
const OBS_PORT = Number(process.env.OBS_WS_PORT ?? 4455);
const OBS_TIMEOUT_MS = Number(process.env.OBS_WS_TIMEOUT_MS ?? 500);
const SCHEMA_VERSION = 1;
const SIGNAL_CONFIRM_WINDOW_MS = Number(process.env.PULSE_SIGNAL_WINDOW_MS ?? 1500);
const SESSIONEND_MATCH_WINDOW_MS = 5000;

const systemRoot = process.argv[2];
if (!systemRoot) {
  console.error('pulse: SYSTEM_ROOT arg required — usage: bun run pulse.ts <SYSTEM_ROOT>');
  process.exit(2);
}

const cacheDir = join(systemRoot, '.claude', 'scripts', '.cache', 'pulse');
try {
  mkdirSync(cacheDir, { recursive: true });
} catch (err) {
  console.error(`pulse: failed to create cache dir ${cacheDir}: ${String(err)}`);
  process.exit(3);
}

type TerminationSignal = 'SIGTERM' | 'SIGINT' | 'SIGHUP';

interface SessionEndMatch {
  timestamp: string | null;
  reason: string | null;
  action: string | null;
  age_ms: number | null;
  hook_pid: number | null;
  pulse_signal_sent: boolean | null;
}

const textDecoder = new TextDecoder();

// --- Atomic JSON writer (.tmp + rename) ----------------------------------
function atomicWriteJSON(topic: string, data: unknown): void {
  const target = join(cacheDir, `${topic}.json`);
  const tmp = join(cacheDir, `${topic}.json.tmp.${process.pid}`);
  try {
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, target);
  } catch (err) {
    console.error(`pulse: atomic write failed for ${topic}: ${String(err)}`);
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore — tmp may not exist */
    }
  }
}

function appendDiagnosticLog(filename: string, data: Record<string, unknown>): void {
  try {
    appendFileSync(join(cacheDir, filename), `${JSON.stringify(data)}\n`);
  } catch (err) {
    console.error(`pulse: failed to append ${filename}: ${String(err)}`);
  }
}

function resolveParentCommand(ppid: number): string | null {
  if (ppid <= 1) return null;

  try {
    const result = Bun.spawnSync({
      cmd: ['ps', '-p', String(ppid), '-o', 'comm='],
      stdout: 'pipe',
      stderr: 'ignore',
    });
    if (result.exitCode !== 0) return null;

    const parentCommand = textDecoder.decode(result.stdout).trim();
    return parentCommand.length > 0 ? parentCommand : null;
  } catch {
    return null;
  }
}

function readRecentSessionEndMatch(targetPid: number): SessionEndMatch | null {
  const sessionEndLog = join(cacheDir, 'sessionend.log');
  if (!existsSync(sessionEndLog)) return null;

  let raw: string;
  try {
    raw = readFileSync(sessionEndLog, 'utf8');
  } catch {
    return null;
  }

  const lines = raw
    .split('\n')
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
      entry = JSON.parse(lines[index] ?? '{}') as typeof entry;
    } catch {
      continue;
    }

    if (entry.pulse_pid !== targetPid) continue;

    const entryTimestamp = typeof entry.timestamp === 'string' ? entry.timestamp : null;
    const ageMs = entryTimestamp ? now - Date.parse(entryTimestamp) : null;
    if (ageMs == null || !Number.isFinite(ageMs) || ageMs > SESSIONEND_MATCH_WINDOW_MS) {
      return null;
    }

    return {
      timestamp: entryTimestamp,
      reason: typeof entry.reason === 'string' ? entry.reason : null,
      action: typeof entry.action === 'string' ? entry.action : null,
      age_ms: ageMs,
      hook_pid: typeof entry.hook_pid === 'number' ? entry.hook_pid : null,
      pulse_signal_sent:
        typeof entry.pulse_signal_sent === 'boolean' ? entry.pulse_signal_sent : null,
    };
  }

  return null;
}

function buildSignalDiagnostic(signal: TerminationSignal): Record<string, unknown> {
  const recentSessionEnd = readRecentSessionEndMatch(process.pid);
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

// --- Delamain scan (port of face's inline scan; same 5-state mapping) -----
type DelamainState = 'offline' | 'idle' | 'active' | 'warn' | 'error';

interface DelamainRecord {
  name: string;
  slug: string;
  pid: number | null;
  alive: boolean;
  state: DelamainState;
  active: number;
  blocked: number;
  error: string | null;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function scanDelamains(): DelamainRecord[] {
  const dirs: string[] = [];
  const primary = join(systemRoot, '.claude', 'delamains');
  if (existsSync(primary)) dirs.push(primary);

  const rootsFile = join(systemRoot, '.claude', 'delamain-roots');
  if (existsSync(rootsFile)) {
    try {
      const extra = readFileSync(rootsFile, 'utf8')
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const er of extra) {
        const p = join(er, '.claude', 'delamains');
        if (existsSync(p)) dirs.push(p);
      }
    } catch {
      /* swallow — unreadable roots file is not fatal */
    }
  }

  const out: DelamainRecord[] = [];
  for (const dp of dirs) {
    let entries: string[];
    try {
      entries = readdirSync(dp);
    } catch {
      continue;
    }
    for (const name of entries) {
      const yaml = join(dp, name, 'delamain.yaml');
      if (!existsSync(yaml)) continue;
      const sf = join(dp, name, 'status.json');
      const slug = name.split('-')[0] ?? name;

      let pid: number | null = null;
      let active = 0;
      let blocked = 0;
      let error: string | null = null;

      if (existsSync(sf)) {
        try {
          const raw = JSON.parse(readFileSync(sf, 'utf8')) as {
            pid?: number;
            active_dispatches?: number;
            blocked_dispatches?: number;
            last_error?: string;
          };
          pid = typeof raw.pid === 'number' ? raw.pid : null;
          active = typeof raw.active_dispatches === 'number' ? raw.active_dispatches : 0;
          blocked = typeof raw.blocked_dispatches === 'number' ? raw.blocked_dispatches : 0;
          error = typeof raw.last_error === 'string' && raw.last_error.length > 0 ? raw.last_error : null;
        } catch {
          /* malformed status.json — treat as offline, don't crash the tick */
        }
      }

      const alive = pid != null && pidAlive(pid);
      let state: DelamainState = 'offline';
      if (alive) {
        if (error) state = 'error';
        else if (blocked > 0) state = 'warn';
        else if (active > 0) state = 'active';
        else state = 'idle';
      }

      out.push({ name, slug, pid, alive, state, active, blocked, error });
    }
  }
  return out;
}

// --- OBS WebSocket v5 probe (port of obs-status.py → bun native WebSocket) -
interface ObsResult {
  connected: boolean;
  streaming: boolean;
  recording: boolean;
}

const OBS_FAIL: ObsResult = { connected: false, streaming: false, recording: false };

function probeObs(): Promise<ObsResult> {
  return new Promise((resolve) => {
    let settled = false;
    let ws: WebSocket | null = null;
    let streaming = false;
    let recording = false;
    let phase: 'hello' | 'identified' | 'stream' | 'record' | 'done' = 'hello';

    const settle = (r: ObsResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      resolve(r);
    };

    const timer = setTimeout(() => settle(OBS_FAIL), OBS_TIMEOUT_MS);

    try {
      ws = new WebSocket(`ws://${OBS_HOST}:${OBS_PORT}`);
    } catch {
      settle(OBS_FAIL);
      return;
    }

    ws.addEventListener('error', () => settle(OBS_FAIL));
    ws.addEventListener('close', () => {
      if (phase !== 'done') settle(OBS_FAIL);
    });

    ws.addEventListener('message', (ev) => {
      if (settled) return;
      let msg: { op?: number; d?: { requestId?: string; responseData?: { outputActive?: boolean } } };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const op = msg.op;

      if (phase === 'hello' && op === 0) {
        // Hello → Identify (rpcVersion 1, no auth — matches obs-status.py unauth path)
        ws?.send(JSON.stringify({ op: 1, d: { rpcVersion: 1 } }));
        phase = 'identified';
      } else if (phase === 'identified' && op === 2) {
        // Identified → GetStreamStatus
        ws?.send(JSON.stringify({ op: 6, d: { requestType: 'GetStreamStatus', requestId: 's1' } }));
        phase = 'stream';
      } else if (phase === 'stream' && op === 7 && msg.d?.requestId === 's1') {
        streaming = Boolean(msg.d?.responseData?.outputActive);
        ws?.send(JSON.stringify({ op: 6, d: { requestType: 'GetRecordStatus', requestId: 's2' } }));
        phase = 'record';
      } else if (phase === 'record' && op === 7 && msg.d?.requestId === 's2') {
        recording = Boolean(msg.d?.responseData?.outputActive);
        phase = 'done';
        settle({ connected: true, streaming, recording });
      }
    });
  });
}

// --- Tick loop with in-flight guard --------------------------------------
let tickInFlight = false;
let shuttingDown = false;

async function tick(): Promise<void> {
  if (tickInFlight || shuttingDown) return;
  tickInFlight = true;
  try {
    const now = Date.now();

    const delamains = scanDelamains();
    atomicWriteJSON('delamains', {
      schema_version: SCHEMA_VERSION,
      last_tick: now,
      delamains,
    });

    let obs: ObsResult;
    try {
      obs = await probeObs();
    } catch {
      obs = OBS_FAIL;
    }
    const live = obs.streaming || obs.recording;
    atomicWriteJSON('live', {
      schema_version: SCHEMA_VERSION,
      last_tick: Date.now(),
      connected: obs.connected,
      streaming: obs.streaming,
      recording: obs.recording,
      state: live ? 'live' : 'offline',
    });

    // meta.json written LAST so its mtime is the canonical "fresh tick" signal.
    // Faces check meta.mtime for liveness; writing it last guarantees that when
    // meta looks fresh, the topic files behind it are also fresh.
    atomicWriteJSON('meta', {
      schema_version: SCHEMA_VERSION,
      pid: process.pid,
      last_tick: Date.now(),
      tick_ms: TICK_MS,
    });
  } catch (err) {
    console.error(`pulse: tick failed: ${String(err)}`);
  } finally {
    tickInFlight = false;
  }
}

// --- Shutdown ------------------------------------------------------------
let interval: ReturnType<typeof setInterval> | null = null;
let advisoryResetTimer: ReturnType<typeof setTimeout> | null = null;
let pendingTermination: { signal: TerminationSignal; at_ms: number } | null = null;

function clearPendingTermination(): void {
  pendingTermination = null;
  if (advisoryResetTimer != null) {
    clearTimeout(advisoryResetTimer);
    advisoryResetTimer = null;
  }
}

function armPendingTermination(signal: TerminationSignal): void {
  clearPendingTermination();
  pendingTermination = { signal, at_ms: Date.now() };
  advisoryResetTimer = setTimeout(() => {
    pendingTermination = null;
    advisoryResetTimer = null;
  }, SIGNAL_CONFIRM_WINDOW_MS);
}

function shutdown(signal: TerminationSignal, firstSignal: TerminationSignal | null): void {
  if (shuttingDown) return;
  shuttingDown = true;
  if (interval != null) clearInterval(interval);
  clearPendingTermination();
  appendDiagnosticLog('shutdown.log', {
    timestamp: new Date().toISOString(),
    event: 'shutdown',
    first_signal: firstSignal,
    confirm_window_ms: SIGNAL_CONFIRM_WINDOW_MS,
    ...buildSignalDiagnostic(signal),
  });
  // Unlink meta.json so faces flip to inline fallback immediately rather than
  // reading stale delamain/live data until the 10s staleness threshold kicks in.
  try {
    unlinkSync(join(cacheDir, 'meta.json'));
  } catch {
    /* already gone or never written — either way, desired end state */
  }
  process.exit(0);
}

function handleTerminationSignal(signal: TerminationSignal): void {
  if (shuttingDown) return;

  const priorSignal = pendingTermination;
  if (priorSignal != null && Date.now() - priorSignal.at_ms <= SIGNAL_CONFIRM_WINDOW_MS) {
    shutdown(signal, priorSignal.signal);
    return;
  }

  appendDiagnosticLog('shutdown.log', {
    timestamp: new Date().toISOString(),
    event: 'signal_advisory',
    confirm_window_ms: SIGNAL_CONFIRM_WINDOW_MS,
    prior_signal: priorSignal?.signal ?? null,
    ...buildSignalDiagnostic(signal),
  });
  armPendingTermination(signal);
}

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(sig, () => handleTerminationSignal(sig));
}

// First tick fires immediately so cache populates within ~1s of startup.
// Subsequent ticks run on interval, with tickInFlight guard preventing overlap.
void tick();
interval = setInterval(() => {
  void tick();
}, TICK_MS);
