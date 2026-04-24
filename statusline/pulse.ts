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
 * and /resume (same policy as dispatchers, per GF-034 Q4(a)); dies on real
 * SessionEnd via delamain-stop.sh reap.
 *
 * CACHE PATH INVARIANT: pulse receives SYSTEM_ROOT from /bootup's scan.sh,
 * which walks up for `.als/system.ts`. Faces walk up for `.claude/delamains/`.
 * In ALS systems these resolve to the same dir. If a project has one without
 * the other, the face falls back to inline scan (cache appears missing) —
 * acceptable degradation, documented here so future faces can expect it.
 */

import {
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

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  if (interval != null) clearInterval(interval);
  // Unlink meta.json so faces flip to inline fallback immediately rather than
  // reading stale delamain/live data until the 10s staleness threshold kicks in.
  try {
    unlinkSync(join(cacheDir, 'meta.json'));
  } catch {
    /* already gone or never written — either way, desired end state */
  }
  process.exit(0);
}

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(sig, shutdown);
}

// First tick fires immediately so cache populates within ~1s of startup.
// Subsequent ticks run on interval, with tickInFlight guard preventing overlap.
void tick();
interval = setInterval(() => {
  void tick();
}, TICK_MS);
