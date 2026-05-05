import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { loadAuthoredSourceExport } from "../../../../alsc/compiler/src/authored-load.ts";

const [, , systemRootArg, pluginRootArg] = process.argv;

if (!systemRootArg || !pluginRootArg) {
  throw new Error("Usage: apply-dispatcher-cutover.ts <system-root> <plugin-root>");
}

const systemRoot = resolve(systemRootArg);
const pluginRoot = resolve(pluginRootArg);
const systemConfigPath = join(systemRoot, ".als", "system.ts");
const canonicalDispatcherRoot = join(pluginRoot, "delamain-dispatcher");
const installedDispatcherRoot = join(systemRoot, ".als", "constructs", "delamain-dispatcher");
const dispatcherBackupRoot = join(
  systemRoot,
  ".als",
  "runtime",
  "language-upgrades",
  "v1-to-v2",
  "dispatcher-bundle-backups",
);

const loadedSystem = loadAuthoredSourceExport(systemConfigPath, "system", "system_config", "language_upgrade", null);
if (!loadedSystem.success || !isRecord(loadedSystem.data)) {
  throw new Error("Could not load .als/system.ts while applying the v1-to-v2 dispatcher cutover.");
}

const systemConfig = structuredClone(loadedSystem.data) as {
  als_version: number;
  modules: Record<string, { version: number }>;
};

await ensureDirectoryExists(canonicalDispatcherRoot, "canonical Delamain dispatcher bundle");

const delamainNames = await collectActiveDelamainNames(systemRoot, systemConfig.modules);
for (const delamainName of delamainNames) {
  const targetRoot = join(installedDispatcherRoot, delamainName);
  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(dirname(targetRoot), { recursive: true });
  await cp(canonicalDispatcherRoot, targetRoot, { recursive: true });
}

for (const dispatcherRoot of await collectBundledDispatcherRoots(join(systemRoot, ".als", "modules"))) {
  const relativeDispatcherPath = relative(join(systemRoot, ".als"), dispatcherRoot);
  const backupRoot = join(dispatcherBackupRoot, relativeDispatcherPath);
  await rm(backupRoot, { recursive: true, force: true });
  await mkdir(dirname(backupRoot), { recursive: true });
  await cp(dispatcherRoot, backupRoot, { recursive: true });
  await rm(dispatcherRoot, { recursive: true, force: true });
}

systemConfig.als_version = 2;
await writeFile(systemConfigPath, serializeSystemConfig(systemConfig));

async function collectActiveDelamainNames(
  root: string,
  modules: Record<string, { version: number }>,
): Promise<string[]> {
  const delamainNames = new Set<string>();

  for (const [moduleId, moduleConfig] of Object.entries(modules)) {
    const delamainsRoot = join(root, ".als", "modules", moduleId, `v${moduleConfig.version}`, "delamains");
    for (const entry of await readDirectoryNames(delamainsRoot)) {
      delamainNames.add(entry);
    }
  }

  return [...delamainNames].sort();
}

async function collectBundledDispatcherRoots(root: string): Promise<string[]> {
  const roots: string[] = [];

  for (const entry of await readDirectoryNames(root)) {
    const candidate = join(root, entry);
    if (entry === "dispatcher") {
      roots.push(candidate);
      continue;
    }

    roots.push(...await collectBundledDispatcherRoots(candidate));
  }

  return roots.sort();
}

async function readDirectoryNames(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function ensureDirectoryExists(path: string, label: string): Promise<void> {
  let pathStat;
  try {
    pathStat = await stat(path);
  } catch {
    throw new Error(`Missing ${label} at ${path}.`);
  }

  if (!pathStat.isDirectory()) {
    throw new Error(`Expected ${label} at ${path} to be a directory.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializeSystemConfig(value: Record<string, unknown>): string {
  return `import { defineSystem } from "./authoring.ts";\n\nexport const system = defineSystem(${JSON.stringify(value, null, 2)} as const);\n\nexport default system;\n`;
}
