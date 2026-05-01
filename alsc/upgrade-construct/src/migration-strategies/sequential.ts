import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  parseSequentialMigrationDirectoryEntries,
  validateSequentialMigrationContract,
} from "../../../compiler/src/sequential-migration-validation.ts";
import type { SequentialMigrationContext, SequentialMigrationStep } from "../types.ts";

export async function discoverSequentialMigrationSteps(
  migrationsDir: string,
): Promise<SequentialMigrationStep[]> {
  const entries = (await readdir(migrationsDir)).sort();
  const parsed = parseSequentialMigrationDirectoryEntries({
    entries,
    migrations_dir: migrationsDir,
    path_root: migrationsDir,
  });
  throwOnSequentialMigrationIssues(parsed.issues);
  return parsed.steps;
}

export function validateSequentialMigrationSteps(
  steps: SequentialMigrationStep[],
  targetVersion?: number,
): void {
  const contractTargetVersion = typeof targetVersion === "number"
    ? targetVersion
    : steps.length === 0
    ? 1
    : Math.max(...steps.map((step) => step.to_version));

  throwOnSequentialMigrationIssues(validateSequentialMigrationContract({
    steps,
    target_version: contractTargetVersion,
    path_root: "migrations_dir",
  }));
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

  validateSequentialMigrationSteps(steps, targetVersion);
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

function throwOnSequentialMigrationIssues(
  issues: Array<{ code?: string; path: string; message: string }>,
): void {
  if (issues.length === 0) {
    return;
  }

  throw new Error(issues.map((entry) => entry.code
    ? `${entry.code}: ${entry.path}: ${entry.message}`
    : `${entry.path}: ${entry.message}`).join("; "));
}
