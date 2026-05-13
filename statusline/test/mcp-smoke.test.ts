import { afterEach, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const statuslineRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = resolve(statuslineRoot, "test/fixtures/smoke-system");
const pulsePath = resolve(statuslineRoot, "pulse.ts");
const mcpServerPath = resolve(statuslineRoot, "mcp-server/index.ts");

const tempRoots = new Set<string>();
const spawnedPulses: ReturnType<typeof Bun.spawn>[] = [];
const spawnedChildren: Array<{ client: Client; transport: StdioClientTransport }> = [];
const helperPids = new Set<number>();

afterEach(async () => {
  while (spawnedChildren.length > 0) {
    const child = spawnedChildren.pop();
    if (!child) {
      continue;
    }

    try {
      await child.client.close();
    } catch {
      // Ignore shutdown races.
    }

    if (child.transport.pid && pidAlive(child.transport.pid)) {
      try {
        process.kill(child.transport.pid, "SIGKILL");
      } catch {
        // Ignore shutdown races.
      }
    }
  }

  while (spawnedPulses.length > 0) {
    const pulse = spawnedPulses.pop();
    if (!pulse) {
      continue;
    }

    if (pidAlive(pulse.pid)) {
      try {
        process.kill(pulse.pid, "SIGKILL");
      } catch {
        // Ignore shutdown races.
      }
    }

    try {
      await pulse.exited;
    } catch {
      // Ignore shutdown races.
    }
  }

  for (const pid of helperPids) {
    if (pidAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Ignore shutdown races.
      }
    }
  }
  helperPids.clear();

  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
  tempRoots.clear();
});

test("MCP pulse smoke test matches the legacy wrapper cache output and exposes zero tools", async () => {
  const legacyRoot = await createFixtureCopy("legacy");
  const mcpRoot = await createFixtureCopy("mcp");

  const liveMappings = await createLiveDelamainMappings();
  await writeLiveDelamainStatuses(legacyRoot, liveMappings);
  await writeLiveDelamainStatuses(mcpRoot, liveMappings);

  const legacyPulse = Bun.spawn({
    cmd: [process.execPath, pulsePath, legacyRoot],
    env: {
      ...process.env,
      PULSE_TICK_MS: "60",
      PULSE_SIGNAL_WINDOW_MS: "200",
      OBS_WS_TIMEOUT_MS: "20",
    },
    stdout: "ignore",
    stderr: "pipe",
  });
  spawnedPulses.push(legacyPulse);

  const initialLegacyMeta = await waitForMeta(legacyRoot);
  await waitForAdvancedTick(legacyRoot, initialLegacyMeta.last_tick);

  const { client, transport } = await startMcpPulse({
    cwd: mcpRoot,
    env: {
      ...process.env,
      ALS_SYSTEM_ROOT: mcpRoot,
      PULSE_TICK_MS: "60",
      PULSE_SIGNAL_WINDOW_MS: "200",
      OBS_WS_TIMEOUT_MS: "20",
    },
  });
  expect(transport.pid).not.toBeNull();

  const tools = await client.listTools();
  expect(tools.tools).toEqual([]);
  await client.ping();

  const initialMcpMeta = await waitForMeta(mcpRoot);
  await waitForAdvancedTick(mcpRoot, initialMcpMeta.last_tick);

  const legacySnapshot = await readPulseSnapshot(legacyRoot);
  const mcpSnapshot = await readPulseSnapshot(mcpRoot);

  expect(normalizeMeta(legacySnapshot.meta)).toEqual({ schema_version: 1, tick_ms: 60 });
  expect(normalizeMeta(mcpSnapshot.meta)).toEqual({ schema_version: 1, tick_ms: 60 });
  expect(normalizeLive(legacySnapshot.live)).toEqual(normalizeLive(mcpSnapshot.live));
  expect(normalizeDelamains(legacySnapshot.delamains)).toEqual(normalizeDelamains(mcpSnapshot.delamains));
});

test("MCP pulse stays a no-op outside ALS projects", async () => {
  const root = await createTempRoot("non-als");
  const { client } = await startMcpPulse({
    cwd: root,
    env: {
      ...process.env,
      PULSE_TICK_MS: "60",
      OBS_WS_TIMEOUT_MS: "20",
    },
  });

  expect((await client.listTools()).tools).toEqual([]);
  await client.ping();
  await Bun.sleep(220);

  expect(await pathExists(join(root, ".claude"))).toBe(false);
});

test("Concurrent MCP pulse writers keep the cache valid", async () => {
  const root = await createFixtureCopy("multi-session");
  await writeLiveDelamainStatuses(root, await createLiveDelamainMappings());

  const first = await startMcpPulse({
    cwd: root,
    env: {
      ...process.env,
      ALS_SYSTEM_ROOT: root,
      PULSE_TICK_MS: "60",
      OBS_WS_TIMEOUT_MS: "20",
    },
  });
  const second = await startMcpPulse({
    cwd: root,
    env: {
      ...process.env,
      ALS_SYSTEM_ROOT: root,
      PULSE_TICK_MS: "60",
      OBS_WS_TIMEOUT_MS: "20",
    },
  });

  expect((await first.client.listTools()).tools).toEqual([]);
  expect((await second.client.listTools()).tools).toEqual([]);
  await Bun.sleep(260);

  const snapshot = await readPulseSnapshot(root);
  const candidatePids = new Set<number>([
    first.transport.pid ?? -1,
    second.transport.pid ?? -1,
  ]);

  expect(candidatePids.has(snapshot.meta.pid)).toBe(true);
  expect(Array.isArray(snapshot.delamains.delamains)).toBe(true);
  expect(snapshot.live.state === "live" || snapshot.live.state === "offline").toBe(true);
});

async function createFixtureCopy(label: string): Promise<string> {
  const root = await createTempRoot(label);
  await cp(fixtureRoot, root, { recursive: true });
  return root;
}

async function createTempRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `als-statusline-${label}-`));
  tempRoots.add(root);
  return root;
}

async function createLiveDelamainMappings(): Promise<Array<{
  name: string;
  pid: number;
  active_dispatches: number;
  blocked_dispatches: number;
  last_error: string | null;
}>> {
  const templates = [
    { name: "factory-jobs", active_dispatches: 3, blocked_dispatches: 0, last_error: null },
    { name: "release-jobs", active_dispatches: 0, blocked_dispatches: 2, last_error: null },
    { name: "idle-jobs", active_dispatches: 0, blocked_dispatches: 0, last_error: null },
    { name: "error-jobs", active_dispatches: 0, blocked_dispatches: 0, last_error: "boom" },
  ] as const;

  const mappings = [];
  for (const template of templates) {
    const helper = Bun.spawn({
      cmd: ["sleep", "60"],
      stdout: "ignore",
      stderr: "ignore",
    });
    helperPids.add(helper.pid);
    mappings.push({
      ...template,
      pid: helper.pid,
    });
  }
  return mappings;
}

async function writeLiveDelamainStatuses(
  root: string,
  mappings: Array<{
    name: string;
    pid: number;
    active_dispatches: number;
    blocked_dispatches: number;
    last_error: string | null;
  }>,
): Promise<void> {
  for (const mapping of mappings) {
    await writeFile(
      join(root, ".claude", "delamains", mapping.name, "status.json"),
      JSON.stringify({
        name: mapping.name,
        pid: mapping.pid,
        active_dispatches: mapping.active_dispatches,
        blocked_dispatches: mapping.blocked_dispatches,
        last_error: mapping.last_error,
      }),
      "utf-8",
    );
  }
}

async function startMcpPulse(input: {
  cwd: string;
  env: Record<string, string | undefined>;
}): Promise<{ client: Client; transport: StdioClientTransport }> {
  const client = new Client({
    name: "statusline-smoke",
    version: "1.0.0",
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpServerPath],
    cwd: input.cwd,
    env: Object.fromEntries(
      Object.entries(input.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
    stderr: "pipe",
  });
  await client.connect(transport);
  spawnedChildren.push({ client, transport });
  return { client, transport };
}

async function waitForMeta(root: string): Promise<{ pid: number; last_tick: number; tick_ms: number; schema_version: number }> {
  const metaPath = join(root, ".claude", "scripts", ".cache", "pulse", "meta.json");
  return waitFor(async () => {
    if (!(await pathExists(metaPath))) {
      return null;
    }
    return JSON.parse(await readFile(metaPath, "utf-8")) as {
      pid: number;
      last_tick: number;
      tick_ms: number;
      schema_version: number;
    };
  }, `meta file ${metaPath}`);
}

async function waitForAdvancedTick(root: string, lastTick: number): Promise<void> {
  const metaPath = join(root, ".claude", "scripts", ".cache", "pulse", "meta.json");
  await waitFor(async () => {
    if (!(await pathExists(metaPath))) {
      return null;
    }
    const meta = JSON.parse(await readFile(metaPath, "utf-8")) as { last_tick: number };
    return meta.last_tick > lastTick ? meta : null;
  }, `advanced tick for ${root}`);
}

async function readPulseSnapshot(root: string): Promise<{
  meta: { pid: number; last_tick: number; tick_ms: number; schema_version: number };
  delamains: { schema_version: number; last_tick: number; delamains: Array<Record<string, unknown>> };
  live: { schema_version: number; last_tick: number; connected: boolean; streaming: boolean; recording: boolean; state: string };
}> {
  const cacheRoot = join(root, ".claude", "scripts", ".cache", "pulse");
  return {
    meta: JSON.parse(await readFile(join(cacheRoot, "meta.json"), "utf-8")) as {
      pid: number;
      last_tick: number;
      tick_ms: number;
      schema_version: number;
    },
    delamains: JSON.parse(await readFile(join(cacheRoot, "delamains.json"), "utf-8")) as {
      schema_version: number;
      last_tick: number;
      delamains: Array<Record<string, unknown>>;
    },
    live: JSON.parse(await readFile(join(cacheRoot, "live.json"), "utf-8")) as {
      schema_version: number;
      last_tick: number;
      connected: boolean;
      streaming: boolean;
      recording: boolean;
      state: string;
    },
  };
}

function normalizeMeta(meta: { schema_version: number; tick_ms: number }): { schema_version: number; tick_ms: number } {
  return {
    schema_version: meta.schema_version,
    tick_ms: meta.tick_ms,
  };
}

function normalizeLive(
  live: {
    schema_version: number;
    connected: boolean;
    streaming: boolean;
    recording: boolean;
    state: string;
  },
): {
  schema_version: number;
  connected: boolean;
  streaming: boolean;
  recording: boolean;
  state: string;
} {
  return {
    schema_version: live.schema_version,
    connected: live.connected,
    streaming: live.streaming,
    recording: live.recording,
    state: live.state,
  };
}

function normalizeDelamains(
  delamains: {
    schema_version: number;
    delamains: Array<Record<string, unknown>>;
  },
): {
  schema_version: number;
  delamains: Array<Record<string, unknown>>;
} {
  return {
    schema_version: delamains.schema_version,
    delamains: [...delamains.delamains].sort((left, right) =>
      String(left["name"]).localeCompare(String(right["name"]))
    ),
  };
}

async function waitFor<T>(
  poll: () => Promise<T | null> | T | null,
  label: string,
  timeoutMs = 3000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await poll();
    if (value != null) {
      return value;
    }
    await Bun.sleep(50);
  }

  throw new Error(`Timed out waiting for ${label}`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
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
