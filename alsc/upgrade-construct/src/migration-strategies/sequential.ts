import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { SequentialMigrationContext, SequentialMigrationStep } from "../types.ts";

const STEP_PATTERN = /^v([1-9][0-9]*)-to-v([1-9][0-9]*)\.(?:c|m)?(?:j|t)s$/;

export async function discoverSequentialMigrationSteps(
  migrationsDir: string,
): Promise<SequentialMigrationStep[]> {
  const entries = (await readdir(migrationsDir)).sort();
  return entries.flatMap((entry) => {
    const match = entry.match(STEP_PATTERN);
    if (!match) {
      return [];
    }

    return [{
      from_version: Number(match[1]),
      to_version: Number(match[2]),
      script_path: `${migrationsDir}/${entry}`,
    }];
  });
}

export function validateSequentialMigrationSteps(
  steps: SequentialMigrationStep[],
): void {
  const seen = new Set<string>();
  for (const step of steps) {
    if (step.to_version !== step.from_version + 1) {
      throw new Error(
        `Sequential migration '${step.script_path}' must move exactly one version at a time.`,
      );
    }
    const key = `${step.from_version}->${step.to_version}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate sequential migration step '${key}'.`);
    }
    seen.add(key);
  }
}

export function planSequentialMigrationChain(
  steps: SequentialMigrationStep[],
  currentVersion: number,
  targetVersion: number,
): SequentialMigrationStep[] {
  if (targetVersion < currentVersion) {
    throw new Error(
      `Sequential migration cannot move backwards (${currentVersion} -> ${targetVersion}).`,
    );
  }

  if (targetVersion === currentVersion) {
    return [];
  }

  validateSequentialMigrationSteps(steps);
  const stepByFromVersion = new Map(steps.map((step) => [step.from_version, step]));
  const chain: SequentialMigrationStep[] = [];
  for (let version = currentVersion; version < targetVersion; version += 1) {
    const step = stepByFromVersion.get(version);
    if (!step) {
      throw new Error(`Missing sequential migration step for v${version}-to-v${version + 1}.`);
    }
    chain.push(step);
  }
  return chain;
}

export async function executeSequentialMigrationChain(
  steps: SequentialMigrationStep[],
  contextFactory: (step: SequentialMigrationStep) => SequentialMigrationContext,
): Promise<void> {
  for (const step of steps) {
    const moduleUrl = pathToFileURL(step.script_path).href;
    const loaded = await import(moduleUrl);
    const migrate = typeof loaded.migrate === "function"
      ? loaded.migrate
      : typeof loaded.default === "function"
      ? loaded.default
      : null;
    if (!migrate) {
      throw new Error(
        `Sequential migration '${step.script_path}' must export 'migrate' or a default function.`,
      );
    }
    await migrate(contextFactory(step));
  }
}
