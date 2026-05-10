import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadAuthoredSourceExport } from "../../../../alsc/compiler/src/authored-load.ts";

const [, , systemRootArg] = process.argv;

if (!systemRootArg) {
  throw new Error("Usage: generate-state-labels-and-outcomes.ts <system-root>");
}

const systemRoot = resolve(systemRootArg);
const systemConfigPath = join(systemRoot, ".als", "system.ts");

const LABEL_OVERRIDES = new Map<string, string>([
  ["done", "Shipped"],
  ["shelved", "Stopped"],
  ["cancelled", "Stopped"],
]);

const TOKEN_OVERRIDES = new Map<string, string>([
  ["aat", "AAT"],
  ["uat", "UAT"],
]);

const OUTCOME_BY_TERMINAL_STATE = new Map<string, "success" | "stopped" | "errored">([
  ["done", "success"],
  ["completed", "success"],
  ["concluded", "success"],
  ["processed", "success"],
  ["closed", "success"],
  ["shelved", "stopped"],
  ["cancelled", "stopped"],
  ["deferred", "stopped"],
  ["superseded", "stopped"],
  ["failed", "errored"],
  ["rolled-back", "errored"],
]);

const loadedSystem = loadAuthoredSourceExport(
  systemConfigPath,
  "system",
  "system_config",
  "language_upgrade",
  null,
);

if (!loadedSystem.success || !isRecord(loadedSystem.data)) {
  throw new Error("Could not load .als/system.ts while applying the v3-to-v4 Delamain metadata rewrite.");
}

const systemConfig = loadedSystem.data as {
  als_version: number;
  modules: Record<string, { version: number }>;
};

await rewriteSystemVersion(systemConfigPath, systemConfig.als_version);

for (const [moduleId, moduleConfig] of Object.entries(systemConfig.modules)) {
  const moduleRoot = join(systemRoot, ".als", "modules", moduleId, `v${moduleConfig.version}`);
  const modulePath = join(moduleRoot, "module.ts");
  const loadedModule = loadAuthoredSourceExport(
    modulePath,
    "module",
    "module_shape",
    "language_upgrade",
    moduleId,
  );

  if (!loadedModule.success || !isRecord(loadedModule.data)) {
    throw new Error(`Could not load '${modulePath}' while applying the v3-to-v4 Delamain metadata rewrite.`);
  }

  const delamains = isRecord(loadedModule.data.delamains) ? loadedModule.data.delamains : {};
  for (const [delamainName, registryEntry] of Object.entries(delamains)) {
    if (!isRecord(registryEntry) || typeof registryEntry.path !== "string" || registryEntry.path.length === 0) {
      throw new Error(`Module '${moduleId}' Delamain '${delamainName}' is missing a valid registry path.`);
    }

    const delamainPath = join(moduleRoot, registryEntry.path);
    const loadedDelamain = loadAuthoredSourceExport(
      delamainPath,
      "delamain",
      "module_shape",
      "language_upgrade",
      moduleId,
    );

    if (!loadedDelamain.success || !isRecord(loadedDelamain.data)) {
      throw new Error(`Could not load '${delamainPath}' while applying the v3-to-v4 Delamain metadata rewrite.`);
    }

    const nextDelamain = upgradeDelamainDefinition(loadedDelamain.data, delamainName);
    const nextSource = serializeAuthoredDefinition("delamain", nextDelamain);
    const currentSource = await readFile(delamainPath, "utf-8");
    if (currentSource !== nextSource) {
      await writeFile(delamainPath, nextSource, "utf-8");
    }
  }
}

async function rewriteSystemVersion(systemPath: string, alsVersion: number): Promise<void> {
  const current = await readFile(systemPath, "utf-8");
  const next = current.replace(
    /((?:["'])?als_version(?:["'])?\s*:\s*)3\b/,
    "$14",
  );

  if (next === current) {
    if (alsVersion === 3) {
      throw new Error("Could not rewrite .als/system.ts from ALS v3 to v4.");
    }
    return;
  }

  await writeFile(systemPath, next, "utf-8");
}

function upgradeDelamainDefinition(
  value: Record<string, unknown>,
  delamainName: string,
): Record<string, unknown> {
  const next = structuredClone(value);
  const states = expectRecord(next.states, `Delamain '${delamainName}' is missing a valid states map.`);

  for (const [stateName, rawState] of Object.entries(states)) {
    if (!isRecord(rawState)) {
      throw new Error(`Delamain '${delamainName}' state '${stateName}' must be an object.`);
    }

    if (rawState.label === undefined) {
      rawState.label = buildDefaultLabel(stateName);
    }

    if (rawState.terminal === true && rawState.outcome === undefined) {
      const outcome = OUTCOME_BY_TERMINAL_STATE.get(stateName);
      if (!outcome) {
        throw new Error(
          `Delamain '${delamainName}' terminal state '${stateName}' has no approved v3-to-v4 outcome mapping.`,
        );
      }
      rawState.outcome = outcome;
    }
  }

  return next;
}

function buildDefaultLabel(stateName: string): string {
  const override = LABEL_OVERRIDES.get(stateName);
  if (override) {
    return override;
  }

  const parts = stateName.split("-").map((part, index) => {
    const overrideToken = TOKEN_OVERRIDES.get(part);
    if (overrideToken) {
      return overrideToken;
    }

    if (index === 0) {
      return part.charAt(0).toUpperCase() + part.slice(1);
    }

    return part;
  });

  return parts.join(" ");
}

function serializeAuthoredDefinition(
  exportName: "delamain",
  value: Record<string, unknown>,
): string {
  return `import { defineDelamain } from "als:authoring";\n\nexport const ${exportName} = defineDelamain(${JSON.stringify(value, null, 2)} as const);\n\nexport default ${exportName};\n`;
}

function expectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(message);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
