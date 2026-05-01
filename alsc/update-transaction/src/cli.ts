#!/usr/bin/env bun

import { readFile, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { inspectLanguageUpgradeRecipe } from "../../compiler/src/language-upgrade-recipe.ts";
import { validateSystem } from "../../compiler/src/validate.ts";
import {
  planLanguageUpgradeChain,
  type PlannedLanguageUpgradeHop,
} from "../../upgrade-language/src/plan-chain.ts";
import {
  prepareUpdateTransaction,
  runPreparedUpdateTransaction,
  type PreparedUpdateTransaction,
  type UpdateTransactionLanguagePlan,
} from "./index.ts";

const MAIN_USAGE = `Usage:
  update-transaction prepare --repo-root <path> --plugin-root <path> [--system-root <path>] [--language-plan-file <path>] [--target-als-version <version>]
  update-transaction execute --prepared-file <path> [--answers-file <path>]

Commands:
  prepare  Build the batched-prompt transaction payload for /update.
  execute  Run a prepared transaction with a prompt-answer map.
`;

const PREPARE_USAGE = "Usage: update-transaction prepare --repo-root <path> --plugin-root <path> [--system-root <path>] [--language-plan-file <path>] [--target-als-version <version>]";
const EXECUTE_USAGE = "Usage: update-transaction execute --prepared-file <path> [--answers-file <path>]";

export interface CliIo {
  stdout(value: string): void;
  stderr(value: string): void;
}

export async function runCli(
  args: string[],
  io: CliIo = createProcessCliIo(),
): Promise<number> {
  if (args.length === 0) {
    writeStderr(io, MAIN_USAGE);
    return 2;
  }

  if (isHelpFlag(args[0])) {
    writeStdout(io, MAIN_USAGE);
    return 0;
  }

  const [command, ...rest] = args;

  if (command === "prepare") {
    return runPrepareCommand(rest, io);
  }

  if (command === "execute") {
    return runExecuteCommand(rest, io);
  }

  writeStderr(io, MAIN_USAGE);
  return 2;
}

async function runPrepareCommand(args: string[], io: CliIo): Promise<number> {
  if (args.length === 1 && isHelpFlag(args[0])) {
    writeStdout(io, `${PREPARE_USAGE}\n`);
    return 0;
  }

  let parsed: Record<string, string>;
  try {
    parsed = parseNamedArgs(args, {
      "--repo-root": true,
      "--plugin-root": true,
      "--system-root": true,
      "--language-plan-file": true,
      "--target-als-version": true,
    });
  } catch (error) {
    writeStderr(io, `${PREPARE_USAGE}\n${formatError(error)}\n`);
    return 2;
  }

  if (!parsed["--repo-root"] || !parsed["--plugin-root"]) {
    writeStderr(io, `${PREPARE_USAGE}\n`);
    return 2;
  }

  try {
    const repoRoot = resolve(parsed["--repo-root"]);
    const systemRoot = resolve(parsed["--system-root"] ?? repoRoot);
    const pluginRoot = resolve(parsed["--plugin-root"]);
    const targetAlsVersion = parsed["--target-als-version"]
      ? parseAlsVersion(parsed["--target-als-version"])
      : null;
    const languagePlan = parsed["--language-plan-file"]
      ? await readJsonFile<UpdateTransactionLanguagePlan>(parsed["--language-plan-file"])
      : await discoverLanguagePlan({
        system_root: systemRoot,
        plugin_root: pluginRoot,
        target_als_version: targetAlsVersion,
      });

    const prepared = await prepareUpdateTransaction({
      repo_root: repoRoot,
      system_root: systemRoot,
      plugin_root: pluginRoot,
      language_plan: languagePlan,
    });
    writeStdout(io, JSON.stringify(prepared, null, 2));
    return prepared.status === "ready" ? 0 : 1;
  } catch (error) {
    writeStderr(io, `${formatError(error)}\n`);
    return 1;
  }
}

async function runExecuteCommand(args: string[], io: CliIo): Promise<number> {
  if (args.length === 1 && isHelpFlag(args[0])) {
    writeStdout(io, `${EXECUTE_USAGE}\n`);
    return 0;
  }

  let parsed: Record<string, string>;
  try {
    parsed = parseNamedArgs(args, {
      "--prepared-file": true,
      "--answers-file": true,
    });
  } catch (error) {
    writeStderr(io, `${EXECUTE_USAGE}\n${formatError(error)}\n`);
    return 2;
  }

  if (!parsed["--prepared-file"]) {
    writeStderr(io, `${EXECUTE_USAGE}\n`);
    return 2;
  }

  try {
    const prepared = await readJsonFile<PreparedUpdateTransaction>(parsed["--prepared-file"]);
    if (prepared.status !== "ready") {
      throw new Error("Prepared transaction payload must have status 'ready'.");
    }

    const operatorAnswers = parsed["--answers-file"]
      ? await readJsonFile<Record<string, string>>(parsed["--answers-file"])
      : {};
    const result = await runPreparedUpdateTransaction({
      prepared,
      operator_answers: operatorAnswers,
    });
    writeStdout(io, JSON.stringify(result, null, 2));
    return result.status === "completed" ? 0 : 1;
  } catch (error) {
    writeStderr(io, `${formatError(error)}\n`);
    return 1;
  }
}

async function discoverLanguagePlan(input: {
  system_root: string;
  plugin_root: string;
  target_als_version: number | null;
}): Promise<UpdateTransactionLanguagePlan | null> {
  const validation = validateSystem(input.system_root);
  if (validation.status === "fail") {
    throw new Error("Live ALS system validation failed before language planning.");
  }
  if (typeof validation.als_version !== "number") {
    throw new Error("Live ALS system validation did not report an als_version.");
  }

  const recipesRoot = join(input.plugin_root, "language-upgrades", "recipes");
  const recipePaths = await findRecipePaths(recipesRoot);
  if (recipePaths.length === 0) {
    if (input.target_als_version && input.target_als_version > validation.als_version) {
      throw new Error(
        `No language-upgrade recipes exist under '${recipesRoot}', so ALS v${input.target_als_version} is unreachable.`,
      );
    }
    return null;
  }

  const recipes: PlannedLanguageUpgradeHop[] = [];
  for (const recipePath of recipePaths) {
    const inspection = inspectLanguageUpgradeRecipe(recipePath);
    if (inspection.status !== "pass" || !inspection.recipe) {
      continue;
    }
    recipes.push({
      hop_id: buildDiscoveredHopId(inspection.recipe.from.als_version, inspection.recipe.to.als_version),
      recipe: inspection.recipe,
      recipe_path: inspection.recipe_path,
      bundle_root: inspection.bundle_root,
    });
  }

  if (recipes.length === 0) {
    throw new Error("No valid language-upgrade recipes were discoverable.");
  }

  const targetAlsVersion = input.target_als_version
    ?? recipes.reduce((max, recipe) => Math.max(max, recipe.recipe.to.als_version), validation.als_version);
  if (targetAlsVersion <= validation.als_version) {
    return {
      current_als_version: validation.als_version,
      target_als_version: targetAlsVersion,
      hops: [],
    };
  }

  const plan = planLanguageUpgradeChain({
    current_als_version: validation.als_version,
    target_als_version: targetAlsVersion,
    recipes,
  });
  if (plan.status === "fail") {
    throw new Error(plan.error ?? "Could not build a language-upgrade chain.");
  }

  return {
    current_als_version: plan.current_als_version,
    target_als_version: plan.target_als_version,
    hops: plan.hops,
  };
}

async function findRecipePaths(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const paths: string[] = [];
  for (const entry of entries) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await findRecipePaths(entryPath));
      continue;
    }
    if (entry.isFile() && basename(entryPath) === "recipe.yaml") {
      paths.push(resolve(entryPath));
    }
  }

  return paths.sort();
}

function parseNamedArgs(
  args: string[],
  allowed: Record<string, true>,
): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith("--") || !allowed[key]) {
      throw new Error(`Unknown argument '${key ?? "<missing>"}'.`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Argument '${key}' requires a value.`);
    }
    parsed[key] = value;
    index += 1;
  }

  return parsed;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(resolve(filePath), "utf-8");
  return JSON.parse(raw) as T;
}

function parseAlsVersion(raw: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`ALS version must be a positive integer; received '${raw}'.`);
  }
  return value;
}

function buildDiscoveredHopId(fromAlsVersion: number, toAlsVersion: number): string {
  return `v${fromAlsVersion}-to-v${toAlsVersion}`;
}

function createProcessCliIo(): CliIo {
  return {
    stdout(value) {
      process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
    },
    stderr(value) {
      process.stderr.write(value.endsWith("\n") ? value : `${value}\n`);
    },
  };
}

function writeStdout(io: CliIo, value: string): void {
  io.stdout(value.endsWith("\n") ? value : `${value}\n`);
}

function writeStderr(io: CliIo, value: string): void {
  io.stderr(value.endsWith("\n") ? value : `${value}\n`);
}

function isHelpFlag(value: string): boolean {
  return value === "-h" || value === "--help";
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2));
}
