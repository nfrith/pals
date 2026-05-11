import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadAuthoredSourceExport } from "../../../../alsc/compiler/src/authored-load.ts";
import {
  convertLegacyOperatorConfig,
  inspectLegacyOperatorConfigFile,
  resolveLegacyOperatorConfigPathFromSystemRoot,
  resolveOperatorConfigPathFromSystemRoot,
  resolveOperatorEntryPathFromSystemRoot,
  serializeOperatorConfigSource,
  serializeOperatorRosterSource,
} from "../../../../alsc/compiler/src/operator-config.ts";

const [, , systemRootArg] = process.argv;

if (!systemRootArg) {
  throw new Error("Usage: migrate-operator-config-to-roster.ts <system-root>");
}

const systemRoot = resolve(systemRootArg);
const systemConfigPath = join(systemRoot, ".als", "system.ts");
const alsGitignorePath = join(systemRoot, ".als", ".gitignore");
const legacyOperatorConfigPath = resolveLegacyOperatorConfigPathFromSystemRoot(systemRoot);

const loadedSystem = loadAuthoredSourceExport(
  systemConfigPath,
  "system",
  "system_config",
  "language_upgrade",
  null,
);

if (!loadedSystem.success || !isRecord(loadedSystem.data)) {
  throw new Error("Could not load .als/system.ts while applying the v4-to-v5 operator roster rewrite.");
}

const systemConfig = loadedSystem.data as {
  als_version: number;
};

await rewriteSystemVersion(systemConfigPath, systemConfig.als_version);
await ensureAlsGitignore(alsGitignorePath);

if (existsSync(legacyOperatorConfigPath)) {
  const legacyInspection = inspectLegacyOperatorConfigFile(legacyOperatorConfigPath);
  if (legacyInspection.status !== "pass" || !legacyInspection.config) {
    const problems = [
      ...legacyInspection.errors.map((issue) => issue.message),
      ...legacyInspection.warnings.map((issue) => issue.message),
    ];
    throw new Error(
      `Could not migrate legacy operator config at '${legacyOperatorConfigPath}': ${problems.join("; ")}`,
    );
  }

  const nextOperator = convertLegacyOperatorConfig(legacyInspection.config);
  const operatorPath = resolveOperatorEntryPathFromSystemRoot(systemRoot, nextOperator.id);
  const rosterPath = resolveOperatorConfigPathFromSystemRoot(systemRoot);

  await mkdir(join(systemRoot, ".als", "operators"), { recursive: true });
  await writeIfChanged(operatorPath, serializeOperatorConfigSource(nextOperator));
  await writeIfChanged(rosterPath, serializeOperatorRosterSource({
    operator_paths: [`./operators/${nextOperator.id}.ts`],
  }));
  await rm(legacyOperatorConfigPath, { force: true });
}

async function ensureAlsGitignore(filePath: string): Promise<void> {
  const current = existsSync(filePath) ? await readFile(filePath, "utf-8") : "";
  const trimmed = current.trimEnd();
  const entries = trimmed.length === 0 ? [] : trimmed.split(/\r?\n/);
  if (entries.includes("/local/")) {
    if (current !== trimmed) {
      await writeFile(filePath, `${trimmed}\n`, "utf-8");
    }
    return;
  }

  const next = [
    ...(entries.length > 0 ? entries : []),
    ...(entries.length > 0 ? [""] : []),
    "# Machine-local operator selection",
    "/local/",
  ].join("\n");
  await writeFile(filePath, `${next}\n`, "utf-8");
}

async function rewriteSystemVersion(systemPath: string, alsVersion: number): Promise<void> {
  const current = await readFile(systemPath, "utf-8");
  const next = current.replace(
    /((?:["'])?als_version(?:["'])?\s*:\s*)4\b/,
    "$15",
  );

  if (next === current) {
    if (alsVersion === 4) {
      throw new Error("Could not rewrite .als/system.ts from ALS v4 to v5.");
    }
    return;
  }

  await writeFile(systemPath, next, "utf-8");
}

async function writeIfChanged(filePath: string, next: string): Promise<void> {
  const current = existsSync(filePath) ? await readFile(filePath, "utf-8") : null;
  if (current === next) {
    return;
  }

  await writeFile(filePath, next, "utf-8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
