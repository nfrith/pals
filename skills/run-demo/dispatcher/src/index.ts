import { existsSync, statSync, readdirSync } from "fs";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { query } from "@anthropic-ai/claude-agent-sdk";

// -------------------------------------------------------------------
// System root discovery — walk up from this file to find .als/system.ts
// -------------------------------------------------------------------

function findSystemRoot(start: string): string {
  if (process.env.ALS_SYSTEM_ROOT) return process.env.ALS_SYSTEM_ROOT;
  let dir = start;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, ".als", "system.ts"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("No .als/system.ts found in parent directories — set ALS_SYSTEM_ROOT");
}

const SYSTEM_ROOT = findSystemRoot(import.meta.dir);

// -------------------------------------------------------------------
// Find compiler path once at startup
// -------------------------------------------------------------------

function findCompilerPath(): string {
  let dir = SYSTEM_ROOT;
  while (dir !== dirname(dir)) {
    const candidate = join(dir, "alsc", "compiler", "src", "index.ts");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error("alsc compiler not found in parent directories");
}

const COMPILER_PATH = findCompilerPath();

// -------------------------------------------------------------------
// Delamain discovery — crawl system.ts → module.ts → delamain.ts
// -------------------------------------------------------------------

// Recursively resolve a path template like "regions/{region}/clusters/{cluster}/releases"
// into concrete directories by walking the filesystem
function findConcreteDirs(base: string, template: string): string[] {
  const parts = template.split("/");
  let dirs = [base];

  for (const part of parts) {
    const next: string[] = [];
    for (const d of dirs) {
      if (part.startsWith("{") && part.endsWith("}")) {
        // Wildcard segment — enumerate all subdirectories
        try {
          for (const entry of readdirSync(d)) {
            const full = join(d, entry);
            try { if (statSync(full).isDirectory()) next.push(full); } catch {}
          }
        } catch {}
      } else {
        // Literal segment
        const full = join(d, part);
        try { if (statSync(full).isDirectory()) next.push(full); } catch {}
      }
    }
    dirs = next;
  }
  return dirs;
}

interface DelamainTarget {
  moduleId: string;
  delamainName: string;
  moduleContent: string;
  entityPathTemplate: string;
  concreteDirs: string[];
  moduleMount: string;
  idPrefix: string;
  initialAgentState: string;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loadAuthoredExport<T>(filePath: string, exportName: string): T {
  try {
    const requireFn = require as NodeJS.Require;
    const resolvedPath = requireFn.resolve(filePath);
    delete requireFn.cache?.[resolvedPath];
    const loaded = requireFn(resolvedPath);
    const candidate = loaded?.[exportName] ?? loaded?.default;
    if (candidate === undefined) {
      throw new Error(`expected export '${exportName}' or a default export`);
    }
    return candidate as T;
  } catch (error) {
    throw new Error(`Could not load ${filePath}: ${describeError(error)}`);
  }
}

async function discoverDelamains(): Promise<DelamainTarget[]> {
  let system: { modules: Record<string, { path: string; version: number }> };
  try {
    system = loadAuthoredExport<{ modules: Record<string, { path: string; version: number }> }>(
      join(SYSTEM_ROOT, ".als", "system.ts"),
      "system",
    );
  } catch (error) {
    console.error(`run-demo: ${describeError(error)}`);
    return [];
  }

  const results: DelamainTarget[] = [];

  for (const [moduleId, mod] of Object.entries(system.modules)) {
    const mDir = join(SYSTEM_ROOT, ".als", "modules", moduleId, `v${mod.version}`);

    let moduleShape: any;
    let moduleRaw: string;
    try {
      moduleRaw = await readFile(join(mDir, "module.ts"), "utf-8");
      moduleShape = loadAuthoredExport(join(mDir, "module.ts"), "module");
    } catch (error) {
      console.error(`run-demo: ${describeError(error)}`);
      continue;
    }

    if (!moduleShape?.delamains) continue;

    for (const [delamainName, delamainRef] of Object.entries(moduleShape.delamains) as [string, { path: string }][]) {
      let entityPath: string | undefined;
      for (const [, entity] of Object.entries(moduleShape.entities) as [string, any][]) {
        for (const [, field] of Object.entries(entity.fields) as [string, any][]) {
          if (field.type === "delamain" && field.delamain === delamainName) {
            entityPath = entity.path;
            break;
          }
        }
        if (entityPath) break;
      }
      if (!entityPath) continue;

      const delamainPath = join(mDir, delamainRef.path);
      let delamain: any;
      try {
        delamain = loadAuthoredExport(delamainPath, "delamain");
      } catch (error) {
        console.error(`run-demo: ${describeError(error)}`);
        continue;
      }

      let initialAgentState = "";
      for (const phase of delamain.phases) {
        for (const [stateId, state] of Object.entries(delamain.states) as [string, any][]) {
          if (state.actor === "agent" && state.phase === phase) {
            initialAgentState = stateId;
            break;
          }
        }
        if (initialAgentState) break;
      }
      if (!initialAgentState) continue;

      // Resolve concrete item directories from the entity path template
      const dirTemplate = dirname(entityPath);
      const moduleMount = mod.path;

      // Find concrete item directories by walking the glob pattern
      const concreteDirs = findConcreteDirs(join(SYSTEM_ROOT, moduleMount), dirTemplate);

      // Derive ID prefix from first concrete directory with items
      let idPrefix = "ITEM";
      for (const d of concreteDirs) {
        try {
          const files = readdirSync(d);
          const match = files.find((f: string) => /^[A-Z]+-\d+\.md$/.test(f));
          if (match) { idPrefix = match.replace(/-\d+\.md$/, ""); break; }
        } catch {}
      }

      results.push({
        moduleId,
        delamainName,
        moduleContent: moduleRaw,
        entityPathTemplate: entityPath,
        concreteDirs,
        moduleMount,
        idPrefix,
        initialAgentState,
      });
    }
  }

  return results;
}

// -------------------------------------------------------------------
// Pre-compute next item: resolve concrete directory and next ID
// -------------------------------------------------------------------

interface ResolvedItem {
  filePath: string;
  itemId: string;
  itemsDir: string;
}

function resolveNextItem(target: DelamainTarget): ResolvedItem {
  // Pick a random concrete directory
  const itemsDir = target.concreteDirs.length > 0
    ? target.concreteDirs[Math.floor(Math.random() * target.concreteDirs.length)]!
    : join(SYSTEM_ROOT, target.moduleMount);

  // Scan for highest existing ID across ALL concrete dirs
  let maxId = 0;
  for (const d of target.concreteDirs) {
    try {
      for (const f of readdirSync(d)) {
        const m = f.match(/^[A-Z]+-(\d+)\.md$/);
        if (m) {
          const num = parseInt(m[1]!, 10);
          if (num > maxId) maxId = num;
        }
      }
    } catch {}
  }

  const nextNum = maxId + 1;
  const paddedNum = String(nextNum).padStart(3, "0");
  const itemId = `${target.idPrefix}-${paddedNum}`;
  const filePath = join(itemsDir, `${itemId}.md`);

  return { filePath, itemId, itemsDir };
}

// -------------------------------------------------------------------
// Demo item variety — random titles
// -------------------------------------------------------------------

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

const DEMO_TITLES = [
  "Add retry logic to webhook delivery",
  "Fix race condition in batch processor",
  "Migrate config from YAML to TOML",
  "Add health check endpoint",
  "Refactor auth middleware for token rotation",
  "Fix memory leak in event stream handler",
  "Add OpenTelemetry tracing to API layer",
  "Upgrade Node runtime to latest LTS",
  "Fix flaky integration test in CI",
  "Add rate limiting to public endpoints",
  "Implement graceful shutdown for workers",
  "Fix timezone handling in scheduled jobs",
  "Add structured logging to all services",
  "Migrate database queries to prepared statements",
  "Fix pagination cursor drift on concurrent writes",
];

// -------------------------------------------------------------------
// Seed one item via Agent SDK
// -------------------------------------------------------------------

const today = () => new Date().toISOString().slice(0, 10);
let seedCount = 0;

const sdkEnv: Record<string, string | undefined> = { ...process.env };
delete sdkEnv["ANTHROPIC_API_KEY"];
sdkEnv["ALS_DEMO_MODE"] = "1";

async function seedItem(target: DelamainTarget): Promise<void> {
  seedCount++;
  const title = pickRandom(DEMO_TITLES);
  const resolved = resolveNextItem(target);

  const prompt = `Create a demo work item for the ${target.moduleId} module.

## Module definition

\`\`\`ts
${target.moduleContent}
\`\`\`

## Pre-computed values

File path: ${resolved.filePath}
Item ID: ${resolved.itemId}
Title: "${title}"
Status: ${target.initialAgentState}
Date: ${today()}

## Instructions

1. Write a complete valid record to exactly: ${resolved.filePath}
2. Use realistic demo values for required fields. Set nullable fields to null.
3. DESCRIPTION: "Demo item seeded by /run-demo: ${title}"
4. ACTIVITY_LOG: "- ${today()}: Created by run-demo."
5. Print the file path when done.`;

  console.log(`[run-demo] #${seedCount} seeding ${target.moduleId}/${target.delamainName}: "${title}" → ${resolved.itemId}`);

  try {
    for await (const message of query({
      prompt,
      options: {
        cwd: SYSTEM_ROOT,
        model: "haiku",
        allowedTools: ["Read", "Write", "Bash"],
        env: sdkEnv,
        permissionMode: "acceptEdits",
        maxTurns: 20,
        maxBudgetUsd: 10.0,
      },
    })) {
      if (message.type === "result") {
        const tag =
          message.subtype === "success"
            ? `$${(message as any).total_cost_usd?.toFixed(4) ?? "?"}`
            : message.subtype;
        console.log(`[run-demo] #${seedCount} ${target.moduleId} done (${tag})`);
      }
    }
  } catch (err) {
    console.error(
      `[run-demo] #${seedCount} ${target.moduleId} failed:`,
      err instanceof Error ? err.message : err,
    );
  }
}

// -------------------------------------------------------------------
// Main loop — seed a single delamain continuously (one process per delamain)
// -------------------------------------------------------------------

const filterModule = process.argv[2]; // optional: "module/delamain" filter

const targets = await discoverDelamains();

if (targets.length === 0) {
  console.error("[run-demo] no delamains found in system — nothing to seed");
  process.exit(1);
}

const filtered = filterModule
  ? targets.filter(t => `${t.moduleId}/${t.delamainName}` === filterModule)
  : targets;

if (filtered.length === 0) {
  console.error(`[run-demo] no delamain matches filter: ${filterModule}`);
  console.error(`[run-demo] available: ${targets.map(t => `${t.moduleId}/${t.delamainName}`).join(", ")}`);
  process.exit(1);
}

let running = true;
const stop = () => {
  running = false;
  console.log(`[run-demo] stopped after ${seedCount} items`);
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const target = filtered[0]!;
console.log(`[run-demo] seeding ${target.moduleId}/${target.delamainName} continuously — Ctrl+C to stop`);
console.log(`[run-demo] compiler: ${COMPILER_PATH}`);

while (running) {
  await seedItem(target);
}
