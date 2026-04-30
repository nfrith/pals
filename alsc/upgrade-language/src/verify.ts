import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { LANGUAGE_UPGRADE_RECIPE_VERIFICATION_SCHEMA_LITERAL } from "../../compiler/src/contracts.ts";
import type {
  LanguageUpgradeRecipeVerificationMismatch,
  LanguageUpgradeRecipeVerificationOutput,
  LanguageUpgradeRecipeVerificationStepResult,
} from "../../compiler/src/types.ts";
import type { PlannedLanguageUpgradeHop } from "./plan-chain.ts";
import { runLanguageUpgradeChain, type LanguageUpgradeRunOptions, type LanguageUpgradeRunnerServices } from "./runner.ts";

export async function verifyLanguageUpgradeRecipe(input: {
  from_fixture_path: string;
  expected_fixture_path: string;
  hop: PlannedLanguageUpgradeHop;
  services: LanguageUpgradeRunnerServices;
  options?: LanguageUpgradeRunOptions;
}): Promise<LanguageUpgradeRecipeVerificationOutput> {
  const workingRoot = await mkdtemp(join(tmpdir(), "als-language-upgrade-verification-"));
  const actualRoot = join(workingRoot, "actual");
  const statePath = join(workingRoot, "runtime-state.json");

  try {
    await cp(resolve(input.from_fixture_path), actualRoot, {
      recursive: true,
      force: true,
    });
    await rm(join(actualRoot, ".git"), { recursive: true, force: true });
    initializeGitRepository(actualRoot);

    const runResult = await runLanguageUpgradeChain({
      system_root: actualRoot,
      hops: [input.hop],
      target_als_version: input.hop.recipe.to.als_version,
      services: input.services,
      options: {
        ...input.options,
        state_path: statePath,
      },
    });

    const stepResults = flattenStepResults(runResult.state);
    if (runResult.status !== "completed") {
      return {
        schema: LANGUAGE_UPGRADE_RECIPE_VERIFICATION_SCHEMA_LITERAL,
        status: "fail",
        generated_at: new Date().toISOString(),
        recipe_path: input.hop.recipe_path,
        from_fixture_path: resolve(input.from_fixture_path),
        expected_fixture_path: resolve(input.expected_fixture_path),
        actual_fixture_path: actualRoot,
        mismatches: [],
        step_results: stepResults,
        error: runResult.diagnostic ?? `Verification run ended with status '${runResult.status}'.`,
      };
    }

    const mismatches = await compareDirectories(resolve(input.expected_fixture_path), actualRoot);
    return {
      schema: LANGUAGE_UPGRADE_RECIPE_VERIFICATION_SCHEMA_LITERAL,
      status: mismatches.length === 0 ? "pass" : "fail",
      generated_at: new Date().toISOString(),
      recipe_path: input.hop.recipe_path,
      from_fixture_path: resolve(input.from_fixture_path),
      expected_fixture_path: resolve(input.expected_fixture_path),
      actual_fixture_path: actualRoot,
      mismatches,
      step_results: stepResults,
      error: mismatches.length === 0 ? null : "Verified output diverges from the expected fixture snapshot.",
    };
  } finally {
    await rm(workingRoot, { recursive: true, force: true });
  }
}

function flattenStepResults(
  state: Awaited<ReturnType<typeof runLanguageUpgradeChain>>["state"],
): LanguageUpgradeRecipeVerificationStepResult[] {
  return state.hops.flatMap((hop) => hop.steps.map((step) => ({
    hop_id: hop.hop_id,
    step_id: step.step_id,
    status: step.status,
    attempt_count: step.attempt_count,
    error_code: step.error_code,
    diagnostic: step.diagnostic,
  })));
}

async function compareDirectories(
  expectedRoot: string,
  actualRoot: string,
): Promise<LanguageUpgradeRecipeVerificationMismatch[]> {
  const expectedFiles = await collectFiles(expectedRoot);
  const actualFiles = await collectFiles(actualRoot);
  const mismatches: LanguageUpgradeRecipeVerificationMismatch[] = [];

  const expectedSet = new Set(expectedFiles);
  const actualSet = new Set(actualFiles);

  for (const filePath of expectedFiles) {
    if (!actualSet.has(filePath)) {
      mismatches.push({
        type: "missing",
        path: filePath,
        expected: "present",
        actual: null,
      });
      continue;
    }

    const [expectedContents, actualContents] = await Promise.all([
      readFile(join(expectedRoot, filePath), "utf-8"),
      readFile(join(actualRoot, filePath), "utf-8"),
    ]);
    if (expectedContents !== actualContents) {
      mismatches.push({
        type: "content_mismatch",
        path: filePath,
        expected: expectedContents,
        actual: actualContents,
      });
    }
  }

  for (const filePath of actualFiles) {
    if (expectedSet.has(filePath)) {
      continue;
    }

    mismatches.push({
      type: "unexpected",
      path: filePath,
      expected: null,
      actual: "present",
    });
  }

  return mismatches;
}

async function collectFiles(root: string, relativeRoot = ""): Promise<string[]> {
  const directory = join(root, relativeRoot);
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === ".git") {
      continue;
    }

    const nextRelativePath = relativeRoot.length > 0 ? join(relativeRoot, entry.name) : entry.name;
    const fullPath = join(root, nextRelativePath);
    const stats = await stat(fullPath);
    if (stats.isDirectory()) {
      files.push(...await collectFiles(root, nextRelativePath));
      continue;
    }

    files.push(relative(root, fullPath).split("\\").join("/"));
  }

  return files.sort();
}

function initializeGitRepository(root: string): void {
  runGit(root, ["init"]);
  runGit(root, ["config", "user.name", "ALS Verification"]);
  runGit(root, ["config", "user.email", "als-verification@local"]);
  runGit(root, ["add", "."]);
  runGit(root, ["commit", "--no-gpg-sign", "-m", "Initial fixture snapshot"]);
}

function runGit(root: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`);
  }
}
