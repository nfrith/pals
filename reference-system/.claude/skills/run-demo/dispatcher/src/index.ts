import { existsSync } from "fs";
import { readFile, readdir } from "fs/promises";
import { join, dirname } from "path";
import { parse as parseYaml } from "yaml";
import { query } from "@anthropic-ai/claude-agent-sdk";

// -------------------------------------------------------------------
// System root discovery — walk up from this file to find .als/system.yaml
// -------------------------------------------------------------------

function findSystemRoot(start: string): string {
  let dir = start;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, ".als", "system.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("No .als/system.yaml found in parent directories");
}

const SYSTEM_ROOT = findSystemRoot(import.meta.dir);

// -------------------------------------------------------------------
// Delamain discovery — crawl system.yaml → shape.yaml → delamain.yaml
// -------------------------------------------------------------------

interface DelamainTarget {
  moduleId: string;
  delamainName: string;
  shapeFile: string;
  itemsDir: string;
  idPrefix: string;
  initialAgentState: string;
}

async function discoverDelamains(): Promise<DelamainTarget[]> {
  const system = parseYaml(
    await readFile(join(SYSTEM_ROOT, ".als", "system.yaml"), "utf-8"),
  ) as { modules: Record<string, { path: string; version: number }> };

  const results: DelamainTarget[] = [];

  for (const [moduleId, mod] of Object.entries(system.modules)) {
    const mDir = join(SYSTEM_ROOT, ".als", "modules", moduleId, `v${mod.version}`);

    let shape: any;
    try {
      shape = parseYaml(await readFile(join(mDir, "shape.yaml"), "utf-8"));
    } catch {
      continue;
    }

    if (!shape.delamains) continue;

    for (const [delamainName, delamainRef] of Object.entries(shape.delamains) as [string, { path: string }][]) {
      // Find the entity that uses this delamain
      let entityPath: string | undefined;
      for (const [, entity] of Object.entries(shape.entities) as [string, any][]) {
        for (const [, field] of Object.entries(entity.fields) as [string, any][]) {
          if (field.type === "delamain" && field.delamain === delamainName) {
            entityPath = entity.path;
            break;
          }
        }
        if (entityPath) break;
      }
      if (!entityPath) continue;

      // Read delamain.yaml to find first agent-owned state
      const delamainPath = join(mDir, delamainRef.path);
      let delamain: any;
      try {
        delamain = parseYaml(await readFile(delamainPath, "utf-8"));
      } catch {
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

      // Derive ID prefix from existing items
      const itemsDir = join(SYSTEM_ROOT, mod.path, dirname(entityPath));
      let idPrefix = "ITEM";
      try {
        const files = await readdir(itemsDir);
        const match = files.find((f: string) => /^[A-Z]+-\d+\.md$/.test(f));
        if (match) idPrefix = match.replace(/-\d+\.md$/, "");
      } catch {}

      results.push({
        moduleId,
        delamainName,
        shapeFile: join(mDir, "shape.yaml"),
        itemsDir,
        idPrefix,
        initialAgentState,
      });
    }
  }

  return results;
}

// -------------------------------------------------------------------
// Demo item variety — random titles and field values for realism
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

async function seedItem(target: DelamainTarget): Promise<void> {
  seedCount++;
  const title = pickRandom(DEMO_TITLES);

  const prompt = `Create a demo work item for the ${target.moduleId} module.

Read the shape file at ${target.shapeFile} to understand the entity schema — fields, types, allowed values, sections, everything. Then create a valid record.

Items directory: ${target.itemsDir}
ID prefix: ${target.idPrefix}
Title: "${title}"
Status: ${target.initialAgentState}
Date: ${today()}

1. Read shape.yaml to learn all required fields, enum values, and sections.
2. Scan ${target.itemsDir} for existing items, find the highest ID number, increment by 1.
3. Write a complete valid record to ${target.itemsDir}/${target.idPrefix}-{NNN}.md.
4. Use realistic demo values for required fields. Set nullable fields to null.
5. DESCRIPTION: "Demo item seeded by /run-demo: ${title}"
6. ACTIVITY_LOG: "- ${today()}: Created by run-demo."
7. After writing the file, run the ALS compiler to validate it: find the compiler at alsc/compiler/src/index.ts (search parent directories of ${SYSTEM_ROOT} for the alsc/ directory), then run \`bun <compiler-path> ${SYSTEM_ROOT} ${target.moduleId}\`. If validation fails, fix the errors and re-validate.
8. Print the file path when done.`;

  console.log(`[run-demo] #${seedCount} seeding ${target.moduleId}/${target.delamainName}: "${title}"`);

  try {
    for await (const message of query({
      prompt,
      options: {
        cwd: SYSTEM_ROOT,
        model: "sonnet",
        allowedTools: ["Read", "Write", "Glob", "Bash"],
        env: sdkEnv,
        permissionMode: "acceptEdits",
        maxTurns: 10,
        maxBudgetUsd: 1.00,
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
// Main loop — one parallel seeder per delamain, all running concurrently
// -------------------------------------------------------------------

const targets = await discoverDelamains();

if (targets.length === 0) {
  console.error("[run-demo] no delamains found in system — nothing to seed");
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

console.log(`[run-demo] discovered ${targets.length} delamain(s): ${targets.map(t => `${t.moduleId}/${t.delamainName}`).join(", ")}`);
console.log(`[run-demo] starting ${targets.length} parallel seeders — Ctrl+C to stop`);

// One seeder per delamain, all running concurrently
async function seederLoop(target: DelamainTarget) {
  while (running) {
    await seedItem(target);
  }
}

await Promise.all(targets.map(t => seederLoop(t)));
