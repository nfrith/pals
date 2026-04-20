import "./preflight.js";
import { existsSync } from "fs";
import { writeFileSync, unlinkSync } from "fs";
import { resolve as resolvePath, dirname, join } from "path";
import { resolve, dispatch, type DispatchEntry } from "./dispatcher.js";
import { DispatcherRuntime, type DispatcherRuntimeHeartbeat } from "./dispatcher-runtime.js";
import { formatDispatcherVersionLine, loadDispatcherVersionInfo } from "./dispatcher-version.js";
import { scan } from "./watcher.js";

function findSystemRoot(start: string): string {
  let dir = start;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, ".als", "system.ts"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("No .als/system.ts found in parent directories");
}

const SYSTEM_ROOT = process.env["SYSTEM_ROOT"]
  ? resolvePath(process.env["SYSTEM_ROOT"])
  : findSystemRoot(resolvePath(import.meta.dir));
const BUNDLE_ROOT = dirname(dirname(resolvePath(import.meta.dir)));

const POLL_MS = parseInt(process.env["POLL_MS"] ?? "30000", 10);

try {
  console.log(formatDispatcherVersionLine(await loadDispatcherVersionInfo(BUNDLE_ROOT)));
} catch (error) {
  console.error(`[dispatcher] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const config = await resolve(BUNDLE_ROOT, SYSTEM_ROOT);
const runtime = new DispatcherRuntime({
  bundleRoot: BUNDLE_ROOT,
  systemRoot: SYSTEM_ROOT,
  delamainName: config.delamainName,
  statusField: config.statusField,
  pollMs: POLL_MS,
  submodules: config.submodules,
});

console.log(`[dispatcher] system: ${SYSTEM_ROOT}`);
console.log(`[dispatcher] bundle: ${BUNDLE_ROOT}`);
console.log(`[dispatcher] module: ${config.moduleId}`);
console.log(`[dispatcher] delamain: ${config.delamainName}`);
console.log(`[dispatcher] status field: ${config.statusField}`);
console.log(`[dispatcher] entity: ${config.entityName}`);
console.log(`[dispatcher] entity path: ${config.entityPath}`);
console.log(`[dispatcher] module root: ${config.moduleRoot}`);
if (config.submodules.length > 0) {
  console.log(`[dispatcher] mounted submodules: ${config.submodules.join(", ")}`);
}
if (config.discriminatorField) {
  console.log(`[dispatcher] discriminator: ${config.discriminatorField}=${config.discriminatorValue}`);
}
console.log(`[dispatcher] states: ${config.allStates.join(", ")}`);
console.log(`[dispatcher] watching: ${config.dispatchTable.map((e) => e.state).join(", ")}`);
console.log(`[dispatcher] polling every ${POLL_MS}ms`);

const STATUS_FILE = join(
  SYSTEM_ROOT,
  ".claude",
  "delamains",
  config.delamainName,
  "status.json",
);

let lastItemsScanned = 0;
let lastRuntimeHeartbeat: DispatcherRuntimeHeartbeat = {
  active_dispatches: 0,
  blocked_dispatches: 0,
  orphaned_dispatches: 0,
  guarded_dispatches: 0,
  delegated_dispatches: 0,
  delegated_items: [],
};

async function writeHeartbeat(itemsScanned: number) {
  lastRuntimeHeartbeat = await runtime.heartbeat();
  try {
    writeFileSync(
      STATUS_FILE,
      JSON.stringify({
        name: config.delamainName,
        pid: process.pid,
        last_tick: new Date().toISOString(),
        poll_ms: POLL_MS,
        active_dispatches: lastRuntimeHeartbeat.active_dispatches,
        blocked_dispatches: lastRuntimeHeartbeat.blocked_dispatches,
        orphaned_dispatches: lastRuntimeHeartbeat.orphaned_dispatches,
        guarded_dispatches: lastRuntimeHeartbeat.guarded_dispatches,
        items_scanned: itemsScanned,
        delegated_dispatches: lastRuntimeHeartbeat.delegated_dispatches,
        delegated_items: lastRuntimeHeartbeat.delegated_items,
      }) + "\n",
    );
  } catch {
    // Non-fatal — statusline just won't see us
  }
}

function clearHeartbeat() {
  try {
    unlinkSync(STATUS_FILE);
  } catch {
    // Already gone
  }
}

function findRule(status: string): DispatchEntry | undefined {
  return config.dispatchTable.find((entry) => entry.state === status);
}

function logCounts(prefix: string) {
  console.log(
    `${prefix} (active=${lastRuntimeHeartbeat.active_dispatches}, blocked=${lastRuntimeHeartbeat.blocked_dispatches}, orphaned=${lastRuntimeHeartbeat.orphaned_dispatches}, delegated=${lastRuntimeHeartbeat.delegated_dispatches})`,
  );
}

async function updateHeartbeat() {
  await writeHeartbeat(lastItemsScanned);
}

function logCompletion(itemId: string, result: { success: boolean; blocked: boolean }) {
  console.log(
    `[dispatcher] ${itemId} finished (success=${result.success}, blocked=${result.blocked}, active=${lastRuntimeHeartbeat.active_dispatches}, blocked_total=${lastRuntimeHeartbeat.blocked_dispatches}, delegated=${lastRuntimeHeartbeat.delegated_dispatches})`,
  );
}

function logSweep(prefix: string, summary: Awaited<ReturnType<typeof runtime.sweepOrphans>>) {
  if (
    summary.staleLocksReleased === 0
    && summary.pristineOrphansPruned === 0
    && summary.dirtyOrphansPreserved === 0
  ) {
    return;
  }

  console.log(
    `${prefix} stale_locks=${summary.staleLocksReleased} pristine_orphans=${summary.pristineOrphansPruned} dirty_orphans=${summary.dirtyOrphansPreserved}`,
  );
}

process.on("beforeExit", (code) => {
  console.log(
    `[dispatcher] beforeExit fired (code=${code}, active=${lastRuntimeHeartbeat.active_dispatches}, blocked=${lastRuntimeHeartbeat.blocked_dispatches})`,
  );
});

process.on("exit", (code) => {
  console.log(
    `[dispatcher] exit code=${code} active=${lastRuntimeHeartbeat.active_dispatches} blocked=${lastRuntimeHeartbeat.blocked_dispatches}`,
  );
});

process.on("uncaughtException", (err) => {
  console.error("[dispatcher] uncaughtException:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[dispatcher] unhandledRejection:", reason);
});

let tickCount = 0;

async function tick() {
  tickCount += 1;
  logCounts(`[dispatcher] tick #${tickCount}`);

  const sweep = await runtime.sweepOrphans();
  logSweep("[dispatcher] orphan sweep", sweep);

  const items = await scan(
    config.moduleRoot,
    config.entityPath,
    config.statusField,
    config.discriminatorField,
    config.discriminatorValue,
  );
  lastItemsScanned = items.length;

  const releases = await runtime.reconcileObservedItems(items);
  for (const release of releases) {
    console.log(
      `[dispatcher] release ${release.itemId} after status change ${release.previousStatus} -> ${release.nextStatus} (${release.previousRecordStatus})`,
    );
  }

  for (const item of items) {
    const rule = findRule(item.status);
    if (!rule) continue;
    if (await runtime.hasOpenRecord(item.id)) continue;

    console.log(`[dispatcher] dispatch ${item.id} -> ${item.status}`);
    void dispatch(
      item.id,
      item.filePath,
      rule,
      config.agents,
      config,
      BUNDLE_ROOT,
      runtime,
    )
      .then(async (result) => {
        await updateHeartbeat();
        logCompletion(item.id, result);
      })
      .catch(async (error) => {
        console.error(`[dispatcher] ${item.id} dispatch error:`, error);
        await updateHeartbeat();
      });
  }

  await updateHeartbeat();
}

const bootSweep = await runtime.sweepOrphans();
logSweep("[dispatcher] startup orphan sweep", bootSweep);
await updateHeartbeat();
await tick();
const interval = setInterval(() => {
  void tick().catch((error) => {
    console.error("[dispatcher] tick failed:", error);
  });
}, POLL_MS);

const keepalive = Bun.serve({
  port: 0,
  fetch: () => new Response("dispatcher alive"),
});
console.log(`[dispatcher] keepalive on port ${keepalive.port}`);

let forceShutdownRequested = false;

function clearRuntimeAndExit(code: number) {
  clearInterval(interval);
  keepalive.stop();
  clearHeartbeat();
  process.exit(code);
}

const stop = (signal: string) => {
  if (lastRuntimeHeartbeat.active_dispatches > 0) {
    console.log(
      `[dispatcher] ${signal} ignored while ${lastRuntimeHeartbeat.active_dispatches} active dispatch(es) are running`,
    );
    return false;
  }

  console.log(
    `[dispatcher] ${signal} received, shutting down (active=${lastRuntimeHeartbeat.active_dispatches}, blocked=${lastRuntimeHeartbeat.blocked_dispatches}, delegated=${lastRuntimeHeartbeat.delegated_dispatches})`,
  );
  clearRuntimeAndExit(0);
  return true;
};

process.on("SIGTERM", () => {
  console.log(
    `[dispatcher] SIGTERM ignored (active=${lastRuntimeHeartbeat.active_dispatches}, blocked=${lastRuntimeHeartbeat.blocked_dispatches}, ticks=${tickCount})`,
  );
});

process.on("SIGINT", () => {
  if (forceShutdownRequested) {
    console.log("[dispatcher] second SIGINT - force quit");
    clearRuntimeAndExit(1);
    return;
  }

  forceShutdownRequested = true;
  if (!stop("SIGINT")) return;
});
