import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { deployHarnessProjection } from "../../compiler/src/harness-projection.ts";
import { TRANSIENT_RUNTIME_GITIGNORE_PATTERNS } from "../../shared/transient-runtime.ts";
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

test("prepareUpdateTransaction checkpoints tracked transient runtime dirt before batching prompts", async () => {
  await withSystemRepo("transient-runtime-checkpoint", async ({ repo_root }) => {
    const trackedTransientPaths = await seedTrackedTransientRuntimeFiles(repo_root);
    await writeFile(join(repo_root, trackedTransientPaths[0]!), "{\"dirty\":true}\n", "utf-8");
    await writeFile(join(repo_root, ".claude", "scripts", ".cache", "pulse", "meta.json"), "{\"pid\":456}\n", "utf-8");
    await writeFile(join(repo_root, "notes.txt"), "leave staged\n", "utf-8");
    git(repo_root, ["add", "notes.txt"]);

    const prepared = await prepareUpdateTransaction({
      repo_root,
      plugin_root: alsRepoRoot,
    });

    expect(prepared.status).toBe("ready");
    expect(git(repo_root, ["log", "-1", "--pretty=%s"])).toBe(
      "chore: checkpoint transient runtime hygiene before /update",
    );

    const trackedFiles = git(repo_root, ["ls-files"]).split("\n").filter((entry) => entry.length > 0);
    for (const path of trackedTransientPaths) {
      expect(trackedFiles).not.toContain(path);
      expect(await pathExists(join(repo_root, path))).toBe(true);
    }

    const gitignore = await readFile(join(repo_root, ".gitignore"), "utf-8");
    for (const pattern of TRANSIENT_RUNTIME_GITIGNORE_PATTERNS) {
      expect(gitignore).toContain(pattern);
    }

    expect(git(repo_root, ["diff", "--cached", "--name-only"])).toBe("notes.txt");
    const checkpointPaths = git(repo_root, ["show", "--pretty=", "--name-only", "HEAD"])
      .split("\n")
      .filter((entry) => entry.length > 0);
    expect(checkpointPaths).not.toContain("notes.txt");

    await writeFile(join(repo_root, trackedTransientPaths[0]!), "{\"dirty\":\"again\"}\n", "utf-8");
    expect(
      git(repo_root, [
        "check-ignore",
        "-q",
        "--",
        trackedTransientPaths[0]!,
      ]),
    ).toBe("");
  });
});

test("prepareUpdateTransaction still blocks tracked non-transient .claude changes", async () => {
  await withSystemRepo("dirty-projected-claude", async ({ repo_root }) => {
    await writeFixtureFile(repo_root, ".claude/manual-note.txt", "initial\n");
    git(repo_root, ["add", ".claude/manual-note.txt"]);
    git(repo_root, ["commit", "--no-gpg-sign", "-m", "Track manual claude note"]);
    await writeFile(join(repo_root, ".claude", "manual-note.txt"), "modified\n", "utf-8");

    const prepared = await prepareUpdateTransaction({
      repo_root,
      plugin_root: alsRepoRoot,
    });

    expect(prepared.status).toBe("blocked");
    if (prepared.status === "blocked") {
      expect(prepared.reason).toBe("dirty-live-tree");
      expect(prepared.diagnostic).toContain(".claude/manual-note.txt");
    }
  });
});

test("prepareUpdateTransaction blocks tracked non-transient Codex projection changes for Codex harness", async () => {
  await withSystemRepo("dirty-projected-codex", async ({ repo_root }) => {
    await writeFixtureFile(repo_root, ".codex/manual-note.txt", "initial\n");
    git(repo_root, ["add", ".codex/manual-note.txt"]);
    git(repo_root, ["commit", "--no-gpg-sign", "-m", "Track manual codex note"]);
    await writeFile(join(repo_root, ".codex", "manual-note.txt"), "modified\n", "utf-8");

    const prepared = await prepareUpdateTransaction({
      repo_root,
      plugin_root: alsRepoRoot,
      harness: "codex",
    });

    expect(prepared.status).toBe("blocked");
    if (prepared.status === "blocked") {
      expect(prepared.reason).toBe("dirty-live-tree");
      expect(prepared.diagnostic).toContain(".codex/manual-note.txt");
      expect(prepared.diagnostic).toContain(".agents");
      expect(prepared.diagnostic).toContain(".codex");
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
        deploy_harness_projection(target, systemRoot) {
          const output = deployHarnessProjection(target, systemRoot);
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

test("runPreparedUpdateTransaction deploys Codex projection roots when prepared for Codex", async () => {
  await withSystemRepo("codex-success", async ({ repo_root, root }) => {
    const bundleRoot = join(root, "bundle");
    await writeFixtureFile(
      bundleRoot,
      "scripts/mark-codex-update.sh",
      "#!/usr/bin/env bash\nprintf 'codex\\n' > .als/codex-update-marker.txt\n",
    );
    const languagePlan = createLanguagePlan(bundleRoot, [
      {
        id: "mark-codex-update",
        title: "Mark Codex update",
        type: "script",
        category: "must-run",
        depends_on: [],
        preconditions: [],
        postconditions: [],
        trigger: "auto",
        path: "scripts/mark-codex-update.sh",
        args: [],
      },
    ]);
    const prepared = await prepareUpdateTransaction({
      repo_root,
      plugin_root: alsRepoRoot,
      harness: "codex",
      language_plan: languagePlan,
    });
    expect(prepared.status).toBe("ready");
    if (prepared.status !== "ready") {
      return;
    }
    expect(prepared.harness).toBe("codex");
    expect(prepared.constructs.dashboard.needs_upgrade).toBe(true);
    expect(prepared.constructs.statusline.needs_upgrade).toBe(false);
    expect(prepared.manual_follow_up_note).toBeNull();

    const result = await runPreparedUpdateTransaction({
      prepared,
      services: {
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

    expect(result.status).toBe("completed");
    expect((await readFile(join(repo_root, ".als", "codex-update-marker.txt"), "utf-8")).trim()).toBe("codex");
    expect(await pathExists(join(repo_root, ".als", "AGENTS.md"))).toBe(true);
    expect(await pathExists(join(repo_root, ".agents", "skills"))).toBe(true);
    expect(await pathExists(join(repo_root, ".codex", "delamains"))).toBe(true);
    const committedPaths = git(repo_root, ["show", "--pretty=", "--name-only", "HEAD"])
      .split("\n")
      .filter((entry) => entry.length > 0);
    expect(committedPaths.some((path) => path.startsWith(".agents/"))).toBe(true);
    expect(committedPaths.some((path) => path.startsWith(".codex/"))).toBe(true);
  });
});

test("runPreparedUpdateTransaction emits Codex dispatcher lifecycle actions for Codex updates", async () => {
  await withSystemRepo("codex-dispatcher-lifecycle", async ({ repo_root }) => {
    const dispatcherVersionFiles = await replaceDispatcherFleet(repo_root, dispatcherV11FixtureRoot);
    const dispatcherRoots = dispatcherVersionFiles.map((relativePath) => dirname(relativePath));
    git(repo_root, ["add", "-A", "--", ...dispatcherRoots]);
    git(repo_root, ["commit", "--no-gpg-sign", "-m", "Downgrade dispatcher fixture"]);

    const prepared = await prepareUpdateTransaction({
      repo_root,
      plugin_root: alsRepoRoot,
      harness: "codex",
    });
    expect(prepared.status).toBe("ready");
    if (prepared.status !== "ready") {
      return;
    }

    const operatorAnswers = Object.fromEntries(
      prepared.prompts
        .filter((prompt) => prompt.key.startsWith("dispatcher-lifecycle:"))
        .map((prompt) => [prompt.key, "drain"]),
    );
    let capturedCommands: string[][] = [];
    let capturedPaths: string[] = [];
    const result = await runPreparedUpdateTransaction({
      prepared,
      operator_answers: operatorAnswers,
      services: {
        async run_action_manifest(manifest) {
          capturedCommands = manifest.actions.map((action) => action.start.command);
          capturedPaths = manifest.actions
            .flatMap((action) => [
              action.process_locator?.path,
              action.drain_signal?.path,
            ])
            .filter((path): path is string => typeof path === "string");
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
    const dispatcherCommands = capturedCommands.filter((command) =>
      command.some((part) => part.includes("/delamains/"))
    );
    const dashboardCommands = capturedCommands.filter((command) =>
      command.some((part) => part.includes("delamain-dashboard/src/index.ts"))
    );
    expect(dispatcherCommands.length).toBeGreaterThan(0);
    expect(dispatcherCommands.every((command) => command.some((part) => part.includes(".codex/delamains/")))).toBe(true);
    expect(dispatcherCommands.some((command) => command.some((part) => part.includes(".claude/delamains/")))).toBe(false);
    expect(dashboardCommands.some((command) => command.includes("--harness") && command.includes("codex"))).toBe(true);
    expect(capturedPaths.length).toBeGreaterThan(0);
    expect(capturedPaths.filter((path) => path.includes("/delamains/")).every((path) => path.includes(".codex/delamains/"))).toBe(true);
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

test("runPreparedUpdateTransaction completes after transient runtime hygiene checkpoint and live rewrites", async () => {
  await withSystemRepo("checkpoint-writeback", async ({ repo_root, root }) => {
    const trackedTransientPaths = await seedTrackedTransientRuntimeFiles(repo_root);
    await writeFile(join(repo_root, trackedTransientPaths[0]!), "{\"dirty\":true}\n", "utf-8");
    const bundleRoot = join(root, "bundle");
    await writeFixtureFile(
      bundleRoot,
      "scripts/mark-update.sh",
      "#!/usr/bin/env bash\nprintf 'updated\\n' > .als/update-marker.txt\n",
    );
    const languagePlan = createLanguagePlan(bundleRoot, [
      {
        id: "mark-update",
        title: "Mark update",
        type: "script",
        category: "must-run",
        depends_on: [],
        preconditions: [],
        postconditions: [],
        trigger: "auto",
        path: "scripts/mark-update.sh",
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

    await writeFile(join(repo_root, trackedTransientPaths[0]!), "{\"dirty\":\"live\"}\n", "utf-8");
    const result = await runPreparedUpdateTransaction({
      prepared,
    });

    expect(result.status).toBe("completed");
    expect((await readFile(join(repo_root, ".als", "update-marker.txt"), "utf-8")).trim()).toBe("updated");
    expect(git(repo_root, ["rev-list", "--count", "HEAD"])).toBe("4");

    const trackedFiles = git(repo_root, ["ls-files"]).split("\n").filter((entry) => entry.length > 0);
    for (const path of trackedTransientPaths) {
      expect(trackedFiles).not.toContain(path);
    }
    expect(
      git(repo_root, [
        "check-ignore",
        "-q",
        "--",
        trackedTransientPaths[0]!,
      ]),
    ).toBe("");
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
    expect(output.harness).toBe("claude");
    expect(output.language?.plan.hops.map((hop) => hop.hop_id)).toEqual(["v3-to-v3"]);
    expect(output.prompts.some((prompt) => prompt.key === "v3-to-v3:confirm-live-apply")).toBe(true);
  });
});

test("update-transaction CLI prepare accepts a Codex harness target", async () => {
  await withSystemRepo("cli-prepare-codex", async ({ repo_root }) => {
    const result = await captureCli([
      "prepare",
      "--repo-root",
      repo_root,
      "--plugin-root",
      alsRepoRoot,
      "--harness",
      "codex",
      "--target-als-version",
      "3",
    ]);

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as PreparedUpdateTransaction;
    expect(output.status).toBe("ready");
    expect(output.harness).toBe("codex");
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
    current_als_version: 3,
    target_als_version: 3,
    hops: [{
      hop_id: "v3-to-v3",
      recipe: {
        schema: "als-language-upgrade-recipe@1",
        from: {
          als_version: 3,
        },
        to: {
          als_version: 3,
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

async function seedTrackedTransientRuntimeFiles(repoRoot: string): Promise<string[]> {
  const files: Record<string, string> = {
    ".claude/delamains/ops/runtime/worktree-state.json": "{\"dirty\":false}\n",
    ".claude/delamains/ops/status.json": "{\"pid\":123}\n",
    ".claude/scripts/.cache/pulse/meta.json": "{\"pid\":123}\n",
    ".claude/delamains/ops/telemetry/events.jsonl": "{\"event\":\"tick\"}\n",
    ".claude/delamains/ops/dispatcher/control/drain-request.json": "{\"requested\":true}\n",
    ".codex/delamains/ops/runtime/worktree-state.json": "{\"dirty\":false}\n",
    ".codex/delamains/ops/status.json": "{\"pid\":789}\n",
    ".codex/delamains/ops/telemetry/events.jsonl": "{\"event\":\"tick\"}\n",
    ".codex/delamains/ops/dispatcher/control/drain-request.json": "{\"requested\":true}\n",
  };

  for (const [relativePath, contents] of Object.entries(files)) {
    await writeFixtureFile(repoRoot, relativePath, contents);
  }

  const paths = Object.keys(files).sort();
  git(repoRoot, ["add", "-f", "--", ...paths]);
  git(repoRoot, ["commit", "--no-gpg-sign", "-m", "Track transient runtime files"]);
  return paths;
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
