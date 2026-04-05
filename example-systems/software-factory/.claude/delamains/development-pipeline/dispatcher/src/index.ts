import { existsSync } from "fs";
import { resolve as resolvePath, dirname, join } from "path";
import { scan } from "./watcher.js";
import { resolve, dispatch, type DispatchEntry } from "./dispatcher.js";

// -------------------------------------------------------------------
// The only input: system root. Everything else is derived from
// system.yaml → shape.yaml → delamain.yaml → agents/.
//
// If SYSTEM_ROOT is not set, walk up from the dispatcher's location
// looking for .als/system.yaml. Works at any nesting depth and after
// deployment to .claude/delamains/.
// -------------------------------------------------------------------

function findSystemRoot(start: string): string {
  let dir = start;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, ".als", "system.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("No .als/system.yaml found in parent directories");
}

const SYSTEM_ROOT = process.env["SYSTEM_ROOT"]
  ? resolvePath(process.env["SYSTEM_ROOT"])
  : findSystemRoot(resolvePath(import.meta.dir));

const POLL_MS = parseInt(process.env["POLL_MS"] ?? "30000", 10);

// -------------------------------------------------------------------
// Startup — crawl the ALS declaration surface once
// -------------------------------------------------------------------

const config = await resolve(SYSTEM_ROOT);

console.log(`[dispatcher] system: ${SYSTEM_ROOT}`);
console.log(`[dispatcher] delamain: ${config.delamainName}`);
console.log(`[dispatcher] status field: ${config.statusField}`);
console.log(`[dispatcher] items: ${config.itemsDir}`);
console.log(`[dispatcher] agents loaded: ${Object.keys(config.agents).length}`);
console.log(
  `[dispatcher] dispatch table: ${config.dispatchTable.map((e) => `${e.state}→${e.agentName}`).join(", ")}`,
);
console.log(`[dispatcher] polling every ${POLL_MS}ms`);

// -------------------------------------------------------------------
// Poll loop
// -------------------------------------------------------------------

const lastSeen = new Map<string, string>();
const active = new Set<string>();

function findRule(status: string): DispatchEntry | undefined {
  return config.dispatchTable.find((e) => e.state === status);
}

async function tick() {
  const items = await scan(config.itemsDir);

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
    dispatch(item.id, item.filePath, rule, config.agents, config.systemRoot)
      .then((r) => {
        if (!r.success) active.delete(item.id);
      })
      .catch(() => active.delete(item.id));
  }
}

await tick();
const interval = setInterval(tick, POLL_MS);

const stop = () => {
  clearInterval(interval);
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
