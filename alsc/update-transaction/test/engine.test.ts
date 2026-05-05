import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { deployClaudeSkills } from "../../compiler/src/claude-skills.ts";
import type { LanguageUpgradeRecipe } from "../../compiler/src/types.ts";
import type { PlannedLanguageUpgradeHop } from "../../upgrade-language/src/plan-chain.ts";
import { runCli } from "../src/cli.ts";
import {
  pathExists,
  prepareUpdateTransaction,
  runPreparedUpdateTransaction,
  type PreparedUpdateTransaction,
  type UpdateTransactionLanguagePlan,
} from "../src/index.ts";

const alsRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const referenceSystemRoot = resolve(alsRepoRoot, "reference-system");
const authoringRuntimeRoot = resolve(alsRepoRoot, "alsc/compiler/src/authoring");
const contractsRuntimePath = resolve(alsRepoRoot, "alsc/compiler/src/contracts.ts");
const dispatcherCurrentBundleRoot = resolve(alsRepoRoot, "delamain-dispatcher");
const dispatcherV11FixtureRoot = resolve(alsRepoRoot, "alsc/upgrade-construct/test/fixtures/dispatcher-v11");

async function withSystemRepo(
  label: string,
  run: (input: { root: string; repo_root: string }) => Promise<void> | void,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `als-update-transaction-${label}-`));
  const repoRoot = join(root, "repo");
  let runError: unknown = null;

  try {
    await cp(referenceSystemRoot, repoRoot, { recursive: true });
    await cp(authoringRuntimeRoot, join(root, "alsc", "compiler", "src", "authoring"), { recursive: true });
    await writeFixtureFile(root, "alsc/compiler/src/contracts.ts", await readFile(contractsRuntimePath, "utf-8"));
    await replaceDispatcherFleet(repoRoot, dispatcherCurrentBundleRoot);
    initializeGitRepository(repoRoot);
    await run({
      root,
      repo_root: repoRoot,
    });
  } catch (error) {
    runError = error;
  }

  try {
    await rm(root, { recursive: true, force: true });
  } catch (cleanupError) {
    if (!runError) {
      throw cleanupError;
    }
  }

  if (runError) {
    throw runError;
  }
}

async function captureCli(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(args, {
    stdout(value) {
      stdout += value.endsWith("\n") ? value : `${value}\n`;
    },
    stderr(value) {
      stderr += value.endsWith("\n") ? value : `${value}\n`;
    },
  });

  return {
    exitCode,
    stdout,
    stderr,
  };
}

test("prepareUpdateTransaction rejects tracked .als changes before any prompt batching", async () => {
  await withSystemRepo("dirty-tree", async ({ repo_root }) => {
    await writeFile(join(repo_root, ".als", "system.ts"), "export const broken = true;\n", "utf-8");

    const prepared = await prepareUpdateTransaction({
      repo_root,
      plugin_root: alsRepoRoot,
    });

    expect(prepared.status).toBe("blocked");
    if (prepared.status === "blocked") {
      expect(prepared.reason).toBe("dirty-live-tree");
    }
  });
});

test("prepareUpdateTransaction batches language and construct prompts without creating a staging worktree", async () => {
  await withSystemRepo("batched-prompts", async ({ repo_root, root }) => {
    const dispatcherVersionFiles = await replaceDispatcherFleet(repo_root, dispatcherV11FixtureRoot);
    const dispatcherRoots = dispatcherVersionFiles.map((relativePath) => dirname(relativePath));
    git(repo_root, ["add", "-A", "--", ...dispatcherRoots]);
    git(repo_root, ["commit", "--no-gpg-sign", "-m", "Downgrade dispatcher fixture"]);
    const bundleRoot = join(root, "bundle");
    await writeFixtureFile(
      bundleRoot,
      "operator-prompts/confirm.md",
      "# Confirm\n\nApply the staged ALS changes now?\n",
    );
    const languagePlan = createLanguagePlan(bundleRoot, [
      {
        id: "confirm-live-apply",
        title: "Confirm live apply",
        type: "operator-prompt",
        category: "must-run",
        depends_on: [],
        preconditions: [],
        postconditions: [],
        trigger: "auto",
        path: "operator-prompts/confirm.md",
        intent: "confirm-live-apply",
      },
    ]);

    const prepared = await prepareUpdateTransaction({
      repo_root,
      plugin_root: alsRepoRoot,
      language_plan: languagePlan,
    });

    expect(prepared.status).toBe("ready");
    if (prepared.status === "ready") {
      expect(prepared.prompts.some((prompt) => prompt.source === "language" && prompt.step_id === "confirm-live-apply")).toBe(true);
      expect(prepared.prompts.some((prompt) => prompt.source === "construct" && prompt.key.startsWith("dispatcher-lifecycle:"))).toBe(true);
      const siblingEntries = await listStagingWorktrees(dirname(repo_root));
      expect(siblingEntries).toEqual([]);
    }
  });
});

test("runPreparedUpdateTransaction preserves the staging worktree on validation failure", async () => {
  await withSystemRepo("validation-failure", async ({ repo_root, root }) => {
    const bundleRoot = join(root, "bundle");
    await writeFixtureFile(
      bundleRoot,
      "scripts/break-system.sh",
      "#!/usr/bin/env bash\nprintf 'export const system = {\\n' > .als/system.ts\n",
    );
    const languagePlan = createLanguagePlan(bundleRoot, [
      {
        id: "break-system",
        title: "Break the staged system",
        type: "script",
        category: "must-run",
        depends_on: [],
        preconditions: [],
        postconditions: [],
        trigger: "auto",
        path: "scripts/break-system.sh",
        args: [],
      },
    ]);
    const prepared = await prepareUpdateTransaction({
      repo_root,
      plugin_root: alsRepoRoot,
      language_plan: languagePlan,
    });
    expect(prepared.status).toBe("ready");
    if (prepared.status !== "ready") {
      return;
    }

    const initialHead = git(repo_root, ["rev-parse", "HEAD"]);
    const result = await runPreparedUpdateTransaction({
      prepared,
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.failure_surface).toBe("validation-deploy-failed");
      expect(result.staging_worktree_path).not.toBeNull();
      expect(await pathExists(result.staging_worktree_path!)).toBe(true);
    }
    expect(git(repo_root, ["rev-parse", "HEAD"])).toBe(initialHead);
  });
});

test("runPreparedUpdateTransaction preserves the staging worktree on deploy failure", async () => {
  await withSystemRepo("deploy-failure", async ({ repo_root }) => {
    const prepared = await prepareUpdateTransaction({
      repo_root,
      plugin_root: alsRepoRoot,
    });
    expect(prepared.status).toBe("ready");
    if (prepared.status !== "ready") {
      return;
    }

    const initialHead = git(repo_root, ["rev-parse", "HEAD"]);
    const result = await runPreparedUpdateTransaction({
      prepared,
      services: {
        deploy_claude(systemRoot) {
          const output = deployClaudeSkills(systemRoot);
          return {
            ...output,
            status: "fail",
            error: "Injected deploy failure.",
          };
        },
      },
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.failure_surface).toBe("validation-deploy-failed");
      expect(result.diagnostic).toContain("Injected deploy failure");
      expect(result.staging_worktree_path).not.toBeNull();
      expect(await pathExists(result.staging_worktree_path!)).toBe(true);
    }
    expect(git(repo_root, ["rev-parse", "HEAD"])).toBe(initialHead);
  });
});

test("runPreparedUpdateTransaction reports commit-failed when live HEAD diverges before writeback", async () => {
  await withSystemRepo("commit-failure", async ({ repo_root }) => {
    const prepared = await prepareUpdateTransaction({
      repo_root,
      plugin_root: alsRepoRoot,
    });
    expect(prepared.status).toBe("ready");
    if (prepared.status !== "ready") {
      return;
    }

    const result = await runPreparedUpdateTransaction({
      prepared,
      services: {
        async before_writeback() {
          await writeFile(join(repo_root, "notes.txt"), "diverged\n", "utf-8");
          git(repo_root, ["add", "notes.txt"]);
          git(repo_root, ["commit", "--no-gpg-sign", "-m", "Diverge live branch"]);
        },
        async run_action_manifest() {
          return {
            success: true,
            completed_action_count: 0,
            total_action_count: 0,
            failure: null,
          };
        },
      },
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.failure_surface).toBe("commit-failed");
      expect(result.commit_oid).not.toBeNull();
      expect(result.staging_worktree_path).not.toBeNull();
      expect(await pathExists(result.staging_worktree_path!)).toBe(true);
    }
  });
});

test("runPreparedUpdateTransaction commits once, runs lifecycle after writeback, and cleans staging on success", async () => {
  await withSystemRepo("success", async ({ repo_root }) => {
    const prepared = await prepareUpdateTransaction({
      repo_root,
      plugin_root: alsRepoRoot,
    });
    expect(prepared.status).toBe("ready");
    if (prepared.status !== "ready") {
      return;
    }

    let sawCommittedRuntimeState = false;
    const result = await runPreparedUpdateTransaction({
      prepared,
      services: {
        async run_action_manifest(manifest) {
          const raw = await readFile(
            join(repo_root, ".als", "runtime", "construct-upgrades", "state.json"),
            "utf-8",
          );
          const parsed = JSON.parse(raw) as {
            constructs: Record<string, { applied_version: number }>;
          };
          sawCommittedRuntimeState = parsed.constructs.statusline.applied_version === 1
            && parsed.constructs.dashboard.applied_version === 1;
          return {
            success: true,
            completed_action_count: manifest.actions.length,
            total_action_count: manifest.actions.length,
            failure: null,
          };
        },
      },
    });

    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.commit_oid).not.toBeNull();
      expect(result.action_count).toBeGreaterThan(0);
      expect(result.manual_follow_up_note).toContain("/bootup");
      expect(result.commit_message).toContain("Construct deltas:");
    }
    expect(sawCommittedRuntimeState).toBe(true);
    expect(git(repo_root, ["rev-list", "--count", "HEAD"])).toBe("2");
    expect(await listStagingWorktrees(dirname(repo_root))).toEqual([]);
  });
});

test("update-transaction CLI prepare emits a ready transaction payload", async () => {
  await withSystemRepo("cli-prepare", async ({ repo_root, root }) => {
    const bundleRoot = join(root, "bundle");
    await writeFixtureFile(
      bundleRoot,
      "operator-prompts/confirm.md",
      "# Confirm\n\nApply the staged ALS changes now?\n",
    );
    const languagePlan = createLanguagePlan(bundleRoot, [
      {
        id: "confirm-live-apply",
        title: "Confirm live apply",
        type: "operator-prompt",
        category: "must-run",
        depends_on: [],
        preconditions: [],
        postconditions: [],
        trigger: "auto",
        path: "operator-prompts/confirm.md",
        intent: "confirm-live-apply",
      },
    ]);
    const languagePlanPath = join(root, "language-plan.json");
    await writeFile(languagePlanPath, JSON.stringify(languagePlan, null, 2) + "\n", "utf-8");

    const result = await captureCli([
      "prepare",
      "--repo-root",
      repo_root,
      "--plugin-root",
      alsRepoRoot,
      "--language-plan-file",
      languagePlanPath,
    ]);

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as PreparedUpdateTransaction;
    expect(output.status).toBe("ready");
    expect(output.language?.plan.hops.map((hop) => hop.hop_id)).toEqual(["v2-to-v2"]);
    expect(output.prompts.some((prompt) => prompt.key === "v2-to-v2:confirm-live-apply")).toBe(true);
  });
});

test("update-transaction CLI execute consumes prepared and answer JSON files", async () => {
  await withSystemRepo("cli-execute", async ({ repo_root, root }) => {
    const prepared = await prepareUpdateTransaction({
      repo_root,
      plugin_root: alsRepoRoot,
    });
    expect(prepared.status).toBe("ready");
    if (prepared.status !== "ready") {
      return;
    }

    const preparedFile = join(root, "prepared.json");
    const answersFile = join(root, "answers.json");
    const noOpPrepared: PreparedUpdateTransaction = {
      ...prepared,
      requires_changes: false,
      prompts: [],
    };
    await writeFile(preparedFile, JSON.stringify(noOpPrepared, null, 2) + "\n", "utf-8");
    await writeFile(answersFile, "{}\n", "utf-8");

    const result = await captureCli([
      "execute",
      "--prepared-file",
      preparedFile,
      "--answers-file",
      answersFile,
    ]);

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as {
      status: string;
      commit_oid: string | null;
      action_count: number;
    };
    expect(output.status).toBe("completed");
    expect(output.commit_oid).toBeNull();
    expect(output.action_count).toBe(0);
  });
});

function createLanguagePlan(
  bundleRoot: string,
  steps: LanguageUpgradeRecipe["steps"],
): UpdateTransactionLanguagePlan {
  return {
    current_als_version: 2,
    target_als_version: 2,
    hops: [{
      hop_id: "v2-to-v2",
      recipe: {
        schema: "als-language-upgrade-recipe@1",
        from: {
          als_version: 2,
        },
        to: {
          als_version: 2,
        },
        summary: "Synthetic transaction-wrapper hop.",
        steps,
      },
      recipe_path: join(bundleRoot, "recipe.yaml"),
      bundle_root: bundleRoot,
    } satisfies PlannedLanguageUpgradeHop],
  };
}

async function listStagingWorktrees(parentDir: string): Promise<string[]> {
  return (await readdirSafe(parentDir))
    .filter((name) => name.startsWith(".als-update-staging-"))
    .sort();
}

async function readdirSafe(parentDir: string): Promise<string[]> {
  try {
    return await readdir(parentDir);
  } catch {
    return [];
  }
}

async function writeFixtureFile(
  root: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  const filePath = join(root, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf-8");
}

async function replaceDispatcherFleet(
  repoRoot: string,
  sourceRoot: string,
): Promise<string[]> {
  const versionFiles = findDispatcherVersionFiles(repoRoot);
  for (const relativePath of versionFiles) {
    const dispatcherRoot = dirname(join(repoRoot, relativePath));
    await rm(dispatcherRoot, { recursive: true, force: true });
    await cp(sourceRoot, dispatcherRoot, { recursive: true });
  }
  return versionFiles;
}

function findDispatcherVersionFiles(repoRoot: string): string[] {
  const result = Bun.spawnSync({
    cmd: ["find", repoRoot, "-path", "*/.als/constructs/delamain-dispatcher/*/VERSION"],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(Buffer.from(result.stderr).toString("utf-8").trim() || "Could not locate dispatcher bundles.");
  }

  return Buffer.from(result.stdout).toString("utf-8")
    .trim()
    .split("\n")
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.replace(`${repoRoot}/`, ""));
}

function initializeGitRepository(root: string): void {
  git(root, ["init"]);
  git(root, ["config", "user.name", "ALS Update Tests"]);
  git(root, ["config", "user.email", "als-update-tests@local"]);
  git(root, ["add", "."]);
  git(root, ["commit", "--no-gpg-sign", "-m", "Initial fixture snapshot"]);
}

function git(root: string, args: string[]): string {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      Buffer.from(result.stderr).toString("utf-8").trim()
      || Buffer.from(result.stdout).toString("utf-8").trim()
      || `git ${args.join(" ")} failed`,
    );
  }
  return Buffer.from(result.stdout).toString("utf-8").trim();
}
