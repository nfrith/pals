import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pulsePath = fileURLToPath(new URL("../../../statusline/pulse.ts", import.meta.url));
const hookPath = fileURLToPath(new URL("../../../hooks/delamain-stop.sh", import.meta.url));

const spawnedPulses: ReturnType<typeof Bun.spawn>[] = [];
const tempRoots = new Set<string>();
const textDecoder = new TextDecoder();

interface PulseMeta {
  pid: number;
  last_tick: number;
  tick_ms: number;
  schema_version: number;
}

interface LogEntry {
  [key: string]: unknown;
}

afterEach(async () => {
  while (spawnedPulses.length > 0) {
    const pulse = spawnedPulses.pop();
    if (!pulse) continue;

    if (pidAlive(pulse.pid)) {
      try {
        process.kill(pulse.pid, "SIGKILL");
      } catch {
        /* process already exited */
      }
    }

    try {
      await pulse.exited;
    } catch {
      /* ignore cleanup failures */
    }
  }

  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
  tempRoots.clear();
});

test("pulse survives lone SIGTERM and SIGHUP signals", async () => {
  const root = await createSystemRoot("lone-signals");
  const pulse = startPulse(root);
  const metaPath = join(root, ".claude", "scripts", ".cache", "pulse", "meta.json");
  const shutdownLogPath = join(root, ".claude", "scripts", ".cache", "pulse", "shutdown.log");

  const initialMeta = await waitForMeta(metaPath);
  const pulsePid = initialMeta.pid;
  expect(pulsePid).toBe(pulse.pid);

  process.kill(pulsePid, "SIGTERM");
  const afterSigterm = await waitForLogEntryCount(shutdownLogPath, 1);
  expect(afterSigterm[0]).toMatchObject({
    event: "signal_advisory",
    signal: "SIGTERM",
    pid: pulsePid,
  });
  await waitFor(() => pidAlive(pulsePid), "pulse stays alive after lone SIGTERM");
  const metaAfterSigterm = await waitForNewTick(metaPath, initialMeta.last_tick);
  await Bun.sleep(250);

  process.kill(pulsePid, "SIGHUP");
  const afterSighup = await waitForLogEntryCount(shutdownLogPath, 2);
  expect(afterSighup[1]).toMatchObject({
    event: "signal_advisory",
    signal: "SIGHUP",
    pid: pulsePid,
  });
  await waitFor(() => pidAlive(pulsePid), "pulse stays alive after lone SIGHUP");
  const metaAfterSighup = await waitForNewTick(metaPath, metaAfterSigterm.last_tick);

  expect(metaAfterSighup.pid).toBe(pulsePid);
});

test("pulse exits on a confirmed shutdown pair and removes meta.json", async () => {
  const root = await createSystemRoot("confirmed-shutdown");
  const pulse = startPulse(root);
  const metaPath = join(root, ".claude", "scripts", ".cache", "pulse", "meta.json");
  const shutdownLogPath = join(root, ".claude", "scripts", ".cache", "pulse", "shutdown.log");

  const initialMeta = await waitForMeta(metaPath);
  const pulsePid = initialMeta.pid;
  expect(pulsePid).toBe(pulse.pid);

  process.kill(pulsePid, "SIGTERM");
  await waitForLogEntryCount(shutdownLogPath, 1);
  expect(pidAlive(pulsePid)).toBe(true);

  process.kill(pulsePid, "SIGHUP");
  expect(await pulse.exited).toBe(0);
  await waitFor(() => !existsSync(metaPath), "meta.json removed after confirmed shutdown");

  const shutdownEntries = await waitForLogEntryCount(shutdownLogPath, 2);
  expect(shutdownEntries[1]).toMatchObject({
    event: "shutdown",
    first_signal: "SIGTERM",
    signal: "SIGHUP",
    pid: pulsePid,
  });
});

test("delamain-stop logs clear and resume skips, then signals logout shutdown", async () => {
  const root = await createSystemRoot("sessionend-hook");
  const pulse = startPulse(root);
  const metaPath = join(root, ".claude", "scripts", ".cache", "pulse", "meta.json");
  const shutdownLogPath = join(root, ".claude", "scripts", ".cache", "pulse", "shutdown.log");
  const sessionEndLogPath = join(root, ".claude", "scripts", ".cache", "pulse", "sessionend.log");

  const initialMeta = await waitForMeta(metaPath);
  const pulsePid = initialMeta.pid;
  expect(pulsePid).toBe(pulse.pid);

  runHook(root, "clear", "als-047-clear");
  runHook(root, "resume", "als-047-resume");
  const skipEntries = await waitForLogEntryCount(sessionEndLogPath, 2);
  expect(skipEntries[0]).toMatchObject({
    reason: "clear",
    action: "skipped_clear_resume",
    pulse_signal_sent: false,
    pulse_pid: pulsePid,
  });
  expect(skipEntries[1]).toMatchObject({
    reason: "resume",
    action: "skipped_clear_resume",
    pulse_signal_sent: false,
    pulse_pid: pulsePid,
  });
  await waitFor(() => pidAlive(pulsePid), "pulse survives clear/resume hook skips");
  await waitForNewTick(metaPath, initialMeta.last_tick);

  runHook(root, "logout", "als-047-logout");
  const sessionEndEntries = await waitForLogEntryCount(sessionEndLogPath, 3);
  expect(sessionEndEntries[2]).toMatchObject({
    reason: "logout",
    action: "pulse_signal_sent",
    pulse_signal_sent: true,
    pulse_pid: pulsePid,
  });

  const advisoryEntries = await waitForLogEntryCount(shutdownLogPath, 1);
  expect(advisoryEntries[0]).toMatchObject({
    event: "signal_advisory",
    signal: "SIGTERM",
    recent_sessionend_reason: "logout",
    pid: pulsePid,
  });
  expect(pidAlive(pulsePid)).toBe(true);

  process.kill(pulsePid, "SIGHUP");
  expect(await pulse.exited).toBe(0);

  const finalShutdownEntries = await waitForLogEntryCount(shutdownLogPath, 2);
  expect(finalShutdownEntries[1]).toMatchObject({
    event: "shutdown",
    first_signal: "SIGTERM",
    signal: "SIGHUP",
    recent_sessionend_reason: "logout",
    pid: pulsePid,
  });
});

async function createSystemRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `als-pulse-${label}-`));
  tempRoots.add(root);
  await mkdir(join(root, ".claude", "delamains", "mock"), { recursive: true });
  return root;
}

function startPulse(root: string): ReturnType<typeof Bun.spawn> {
  const pulse = Bun.spawn({
    cmd: [process.execPath, pulsePath, root],
    env: {
      ...process.env,
      PULSE_TICK_MS: "60",
      PULSE_SIGNAL_WINDOW_MS: "200",
      OBS_WS_TIMEOUT_MS: "20",
    },
    stdout: "ignore",
    stderr: "pipe",
  });
  spawnedPulses.push(pulse);
  return pulse;
}

function runHook(root: string, reason: string, sessionId: string): void {
  const payload = JSON.stringify({ reason, cwd: root, session_id: sessionId });
  const result = Bun.spawnSync({
    cmd: [
      "bash",
      "-lc",
      `cat <<'EOF' | bash ${JSON.stringify(hookPath)}
${payload}
EOF`,
    ],
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `delamain-stop.sh failed for reason=${reason} with exit ${result.exitCode}\nstdout:\n${decode(result.stdout)}\nstderr:\n${decode(result.stderr)}`,
    );
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForMeta(metaPath: string): Promise<PulseMeta> {
  return waitFor(async () => {
    if (!existsSync(metaPath)) return null;
    return (await readJson(metaPath)) as PulseMeta;
  }, `meta file ${metaPath}`);
}

async function waitForNewTick(metaPath: string, priorTick: number): Promise<PulseMeta> {
  return waitFor(async () => {
    if (!existsSync(metaPath)) return null;
    const meta = (await readJson(metaPath)) as PulseMeta;
    return meta.last_tick > priorTick ? meta : null;
  }, `new pulse tick after ${priorTick}`);
}

async function waitForLogEntryCount(logPath: string, expectedCount: number): Promise<LogEntry[]> {
  return waitFor(async () => {
    const entries = await readJsonLines(logPath);
    return entries.length >= expectedCount ? entries : null;
  }, `at least ${expectedCount} entries in ${logPath}`);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readJsonLines(path: string): Promise<LogEntry[]> {
  if (!existsSync(path)) return [];

  const contents = await readFile(path, "utf8");
  return contents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as LogEntry);
}

async function waitFor<T>(
  predicate: () => T | Promise<T>,
  label: string,
  timeoutMs = 5000,
  pollMs = 25,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await Bun.sleep(pollMs);
  }

  throw new Error(`Timed out waiting for ${label}`);
}

function decode(bytes: Uint8Array): string {
  const text = textDecoder.decode(bytes).trim();
  return text.length > 0 ? text : "<empty>";
}
