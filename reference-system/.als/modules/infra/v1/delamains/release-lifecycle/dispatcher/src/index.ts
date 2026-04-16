import { existsSync } from "fs";
import { writeFileSync, unlinkSync } from "fs";
import { resolve as resolvePath, dirname, join } from "path";
import { scan } from "./watcher.js";
import { resolve, dispatch, type DispatchEntry } from "./dispatcher.js";
import { formatDispatcherVersionLine, loadDispatcherVersionInfo } from "./dispatcher-version.js";
import { resolveTelemetryPaths } from "./telemetry.js";

// -------------------------------------------------------------------
// The only input: system root. Bundle-local runtime identity comes
// from runtime-manifest.json beside delamain.yaml.
//
// If SYSTEM_ROOT is not set, walk up from the dispatcher's location
// looking for .als/system.ts. Works at any nesting depth and after
// deployment to .claude/delamains/.
// -------------------------------------------------------------------

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

// -------------------------------------------------------------------
// Startup — crawl the ALS declaration surface once
// -------------------------------------------------------------------

try {
  console.log(formatDispatcherVersionLine(await loadDispatcherVersionInfo(BUNDLE_ROOT)));
} catch (error) {
  console.error(`[dispatcher] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const config = await resolve(BUNDLE_ROOT, SYSTEM_ROOT);

console.log(`[dispatcher] system: ${SYSTEM_ROOT}`);
console.log(`[dispatcher] bundle: ${BUNDLE_ROOT}`);
console.log(`[dispatcher] module: ${config.moduleId}`);
console.log(`[dispatcher] delamain: ${config.delamainName}`);
console.log(`[dispatcher] status field: ${config.statusField}`);
console.log(`[dispatcher] entity: ${config.entityName}`);
console.log(`[dispatcher] entity path: ${config.entityPath}`);
console.log(`[dispatcher] module root: ${config.moduleRoot}`);
if (config.discriminatorField) {
  console.log(`[dispatcher] discriminator: ${config.discriminatorField}=${config.discriminatorValue}`);
}
console.log(`[dispatcher] states: ${config.allStates.join(", ")}`);
console.log(`[dispatcher] watching: ${config.dispatchTable.map((e) => e.state).join(", ")}`);
console.log(`[dispatcher] polling every ${POLL_MS}ms`);

// -------------------------------------------------------------------
// Heartbeat — write status to .claude/delamains/{name}/status.json
// -------------------------------------------------------------------

const STATUS_FILE = join(
  SYSTEM_ROOT,
  ".claude",
  "delamains",
  config.delamainName,
  "status.json",
);
const { directory: TELEMETRY_DIR } = resolveTelemetryPaths(BUNDLE_ROOT);

function writeHeartbeat(itemsScanned: number) {
  try {
    writeFileSync(
      STATUS_FILE,
      JSON.stringify({
        name: config.delamainName,
        pid: process.pid,
        last_tick: new Date().toISOString(),
        poll_ms: POLL_MS,
        active_dispatches: active.size,
        items_scanned: itemsScanned,
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

function ensureTelemetryDir() {
  try {
    Bun.mkdirSync(TELEMETRY_DIR, { recursive: true });
  } catch {
    // Non-fatal — telemetry stays unavailable
  }
}

// -------------------------------------------------------------------
// Poll loop
// -------------------------------------------------------------------

const lastSeen = new Map<string, string>();
const active = new Set<string>();

function findRule(status: string): DispatchEntry | undefined {
  return config.dispatchTable.find((e) => e.state === status);
}

async function tick() {
  const items = await scan(
    config.moduleRoot,
    config.entityPath,
    config.statusField,
    config.discriminatorField,
    config.discriminatorValue,
  );

  for (const item of items) {
    const prev = lastSeen.get(item.id);
    if (prev && prev !== item.status) active.delete(item.id);
    lastSeen.set(item.id, item.status);
  }

  for (const item of items) {
    if (active.has(item.id)) continue;
    const rule = findRule(item.status);
    if (!rule) continue;

    active.add(item.id);
    dispatch(item.id, item.filePath, rule, config.agents, config, BUNDLE_ROOT)
      .then((r) => {
        if (!r.success) active.delete(item.id);
      })
      .catch(() => active.delete(item.id));
  }

  writeHeartbeat(items.length);
}

await tick();
ensureTelemetryDir();
const interval = setInterval(tick, POLL_MS);

const stop = () => {
  clearInterval(interval);
  clearHeartbeat();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
