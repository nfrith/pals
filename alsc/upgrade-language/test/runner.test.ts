import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { LANGUAGE_UPGRADE_RECIPE_SCHEMA_LITERAL } from "../../compiler/src/contracts.ts";
import { inspectLanguageUpgradeRecipe } from "../../compiler/src/language-upgrade-recipe.ts";
import { TRANSIENT_RUNTIME_GITIGNORE_PATTERNS } from "../../shared/transient-runtime.ts";
import { validateSystem } from "../../compiler/src/validate.ts";
import type { LanguageUpgradeRecipe } from "../../compiler/src/types.ts";
import { buildHopId, planLanguageUpgradeChain, type PlannedLanguageUpgradeHop } from "../src/plan-chain.ts";
import { preflightLanguageUpgradeChain } from "../src/preflight.ts";
import { executeLanguageUpgradeChain } from "../src/runner.ts";
import { readLanguageUpgradeRuntimeState } from "../src/runtime-state.ts";
import { verifyLanguageUpgradeRecipe } from "../src/verify.ts";

const alsRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const authoringRuntimePath = resolve(alsRepoRoot, "alsc/compiler/src/authoring/index.ts");
const contractsRuntimePath = resolve(alsRepoRoot, "alsc/compiler/src/contracts.ts");
const v1FixtureRoot = resolve(alsRepoRoot, "language-upgrades/fixtures/v1");
const v2FixtureRoot = resolve(alsRepoRoot, "language-upgrades/fixtures/v2");
const v1ToV2RecipeRoot = resolve(alsRepoRoot, "language-upgrades/recipes/v1-to-v2");

interface UpgradeHarness {
  root: string;
  bundle_root: string;
  system_root: string;
  state_path: string;
}

async function withUpgradeHarness(
  label: string,
  input: {
    bundle_files?: Record<string, string>;
    system_files?: Record<string, string>;
  },
  run: (harness: UpgradeHarness) => Promise<void> | void,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `als-upgrade-language-${label}-`));
  const bundleRoot = join(root, "bundle");
  const systemRoot = join(root, "system");
  const statePath = join(root, "runtime-state.json");

  let runError: unknown = null;
  try {
    await mkdir(bundleRoot, { recursive: true });
    await mkdir(systemRoot, { recursive: true });
    await writeFixtureFiles(bundleRoot, input.bundle_files ?? {});
    await writeFixtureFiles(systemRoot, input.system_files ?? {
      ".als/version.txt": "1\n",
      ".als/system.ts": "export const system = { als_version: 1 };\n",
    });
    initializeGitRepository(systemRoot);
    await run({
      root,
      bundle_root: bundleRoot,
      system_root: systemRoot,
      state_path: statePath,
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

function createRecipe(
  steps: LanguageUpgradeRecipe["steps"],
  toAlsVersion = 2,
): LanguageUpgradeRecipe {
  return {
    schema: LANGUAGE_UPGRADE_RECIPE_SCHEMA_LITERAL,
    from: {
      als_version: 1,
    },
    to: {
      als_version: toAlsVersion,
    },
    summary: "Synthetic language upgrade recipe for engine tests.",
    steps,
  };
}

function createHop(
  bundleRoot: string,
  recipe: LanguageUpgradeRecipe,
): PlannedLanguageUpgradeHop {
  return {
    hop_id: buildHopId(recipe.from.als_version, recipe.to.als_version),
    recipe,
    recipe_path: join(bundleRoot, "recipe.yaml"),
    bundle_root: bundleRoot,
  };
}

function createInspectableServices() {
  return {
    async inspect_system(systemRoot: string) {
      const rawVersion = await readFile(join(systemRoot, ".als", "version.txt"), "utf-8");
      return {
        als_version: Number(rawVersion.trim()),
        status: "pass" as const,
      };
    },
  };
}

test("planLanguageUpgradeChain builds a transparent multi-hop journey", () => {
  const recipeA = createRecipe([], 2);
  const recipeB = {
    ...createRecipe([], 3),
    from: { als_version: 2 },
  } satisfies LanguageUpgradeRecipe;
  const plan = planLanguageUpgradeChain({
    current_als_version: 1,
    target_als_version: 3,
    recipes: [
      {
        hop_id: "ignored",
        recipe: recipeA,
        recipe_path: "/tmp/v1-to-v2/recipe.yaml",
        bundle_root: "/tmp/v1-to-v2",
      },
      {
        hop_id: "ignored",
        recipe: recipeB,
        recipe_path: "/tmp/v2-to-v3/recipe.yaml",
        bundle_root: "/tmp/v2-to-v3",
      },
    ],
  });

  expect(plan.status).toBe("pass");
  expect(plan.hops.map((hop) => hop.hop_id)).toEqual(["v1-to-v2", "v2-to-v3"]);
});

test("preflight surfaces operator prompts and execute consumes answers silently", async () => {
  await withUpgradeHarness("preflight-execute", {
    bundle_files: {
      "scripts/rewrite.sh": "#!/usr/bin/env bash\nprintf '2\\n' > .als/version.txt\n",
      "operator-prompts/confirm.md": "# Confirm\n\nApply the v2 changes to `.als/` now?\n",
    },
  }, async ({ bundle_root, state_path, system_root }) => {
    const recipe = createRecipe([
      {
        id: "rewrite",
        title: "Rewrite ALS version marker",
        type: "script",
        category: "must-run",
        depends_on: [],
        preconditions: ["als-version-matches-from"],
        postconditions: [],
        trigger: "auto",
        path: "scripts/rewrite.sh",
        args: [],
      },
      {
        id: "confirm-live-apply",
        title: "Confirm live apply",
        type: "operator-prompt",
        category: "must-run",
        depends_on: ["rewrite"],
        preconditions: [],
        postconditions: [],
        trigger: "auto",
        path: "operator-prompts/confirm.md",
        intent: "confirm-live-apply",
      },
    ]);
    const hop = createHop(bundle_root, recipe);

    const preflight = await preflightLanguageUpgradeChain({
      current_als_version: 1,
      target_als_version: 2,
      hops: [hop],
    });
    expect(preflight.prompts.map((prompt) => prompt.step_id)).toEqual(["confirm-live-apply"]);
    expect((await readFile(join(system_root, ".als", "version.txt"), "utf-8")).trim()).toBe("1");

    const missingAnswer = await executeLanguageUpgradeChain({
      system_root,
      hops: [hop],
      target_als_version: 2,
      services: createInspectableServices(),
      options: {
        state_path,
      },
    });
    expect(missingAnswer.status).toBe("failed");
    expect(missingAnswer.error_code).toBe("operator_response_missing");
    expect((await readFile(join(system_root, ".als", "version.txt"), "utf-8")).trim()).toBe("2");

    const persisted = await readLanguageUpgradeRuntimeState(state_path);
    expect(persisted?.hops[0]?.steps.map((step) => step.status)).toEqual(["completed", "failed"]);

    const resumedRun = await executeLanguageUpgradeChain({
      system_root,
      hops: [hop],
      target_als_version: 2,
      services: createInspectableServices(),
      options: {
        state_path,
        operator_responses: {
          "confirm-live-apply": "yes",
        },
      },
    });
    expect(resumedRun.status).toBe("completed");
    expect(resumedRun.state.hops[0]?.steps.map((step) => step.status)).toEqual(["completed", "completed"]);
  });
});

test("runner dispatches declared recovery steps and continues the hop", async () => {
  await withUpgradeHarness("recovery", {
    bundle_files: {
      "scripts/fail.sh": "#!/usr/bin/env bash\nexit 1\n",
      "scripts/recover.sh": "#!/usr/bin/env bash\nprintf 'recovered\\n' > .als/recovered.txt\n",
      "scripts/after.sh": "#!/usr/bin/env bash\nprintf 'after\\n' > .als/after.txt\n",
    },
  }, async ({ bundle_root, state_path, system_root }) => {
    const recipe = createRecipe([
      {
        id: "rewrite",
        title: "Fail deliberately",
        type: "script",
        category: "must-run",
        depends_on: [],
        preconditions: [],
        postconditions: [],
        trigger: "auto",
        path: "scripts/fail.sh",
        args: [],
      },
      {
        id: "recover",
        title: "Recover the failed rewrite",
        type: "script",
        category: "recovery",
        depends_on: [],
        preconditions: [],
        postconditions: [],
        trigger: "on-error",
        path: "scripts/recover.sh",
        args: [],
        recovers: {
          step_ids: ["rewrite"],
          error_codes: ["script_failed"],
        },
      },
      {
        id: "after",
        title: "Continue after recovery",
        type: "script",
        category: "must-run",
        depends_on: ["rewrite"],
        preconditions: [],
        postconditions: [],
        trigger: "auto",
        path: "scripts/after.sh",
        args: [],
      },
    ]);
    const hop = createHop(bundle_root, recipe);

    const result = await executeLanguageUpgradeChain({
      system_root,
      hops: [hop],
      target_als_version: 2,
      services: createInspectableServices(),
      options: {
        state_path,
      },
    });
    expect(result.status).toBe("completed");
    expect(result.state.hops[0]?.steps.map((step) => step.status)).toEqual(["recovered", "completed", "completed"]);
    expect((await readFile(join(system_root, ".als", "recovered.txt"), "utf-8")).trim()).toBe("recovered");
    expect((await readFile(join(system_root, ".als", "after.txt"), "utf-8")).trim()).toBe("after");
  });
});

test("shipped cleanup step untracks historical runtime ephemera and commits the hygiene update", async () => {
  const inspection = inspectLanguageUpgradeRecipe(v1ToV2RecipeRoot);
  expect(inspection.status).toBe("pass");
  if (inspection.status !== "pass" || !inspection.recipe) {
    return;
  }

  const cleanupStep = inspection.recipe.steps.find((step) => step.id === "cleanup-tracked-runtime-ephemera");
  expect(cleanupStep).toBeDefined();
  if (!cleanupStep) {
    return;
  }

  await withUpgradeHarness("cleanup-runtime-ephemera", {
    system_files: {
      ".als/version.txt": "1\n",
      ".als/system.ts": "export const system = { als_version: 1 };\n",
      ".gitignore": [
        "# Delamain dispatcher runtime artifacts",
        ".claude/delamains/*/status.json",
        "",
      ].join("\n"),
      ".claude/delamains/ops/runtime/worktree-state.json": "{\"dirty\":false}\n",
      ".claude/delamains/ops/status.json": "{\"pid\":123}\n",
      ".claude/scripts/.cache/pulse/delamains.json": "{}\n",
      ".claude/delamains/ops/telemetry/events.jsonl": "{\"event\":\"tick\"}\n",
      ".claude/delamains/ops/dispatcher/control/drain-request.json": "{\"requested\":true}\n",
    },
  }, async ({ state_path, system_root }) => {
    const hop = {
      hop_id: "v1-to-v1-cleanup-runtime-ephemera",
      recipe: createRecipe([cleanupStep], 1),
      recipe_path: join(v1ToV2RecipeRoot, "recipe.yaml"),
      bundle_root: v1ToV2RecipeRoot,
    };

    const result = await executeLanguageUpgradeChain({
      system_root,
      hops: [hop],
      target_als_version: 1,
      services: createInspectableServices(),
      options: {
        state_path,
      },
    });

    expect(result.status).toBe("completed");
    expect(result.state.hops[0]?.steps.map((step) => step.status)).toEqual(["completed"]);
    expect(readGit(system_root, ["status", "--short"])).toBe("");
    expect(readGit(system_root, ["log", "-1", "--pretty=%s"])).toBe(
      "chore: clean tracked runtime ephemera before ALS v2 upgrade",
    );

    const trackedFiles = readGit(system_root, ["ls-files"]);
    expect(trackedFiles).not.toContain(".claude/delamains/ops/runtime/worktree-state.json");
    expect(trackedFiles).not.toContain(".claude/delamains/ops/status.json");
    expect(trackedFiles).not.toContain(".claude/scripts/.cache/pulse/delamains.json");
    expect(trackedFiles).not.toContain(".claude/delamains/ops/telemetry/events.jsonl");
    expect(trackedFiles).not.toContain(".claude/delamains/ops/dispatcher/control/drain-request.json");

    const gitignore = await readFile(join(system_root, ".gitignore"), "utf-8");
    for (const pattern of TRANSIENT_RUNTIME_GITIGNORE_PATTERNS) {
      expect(gitignore).toContain(pattern);
      expect(gitignore.split(pattern).length - 1).toBe(1);
    }
    expect((await readFile(
      join(system_root, ".claude", "delamains", "ops", "runtime", "worktree-state.json"),
      "utf-8",
    )).trim()).toBe("{\"dirty\":false}");
    expect((await readFile(
      join(system_root, ".claude", "scripts", ".cache", "pulse", "delamains.json"),
      "utf-8",
    )).trim()).toBe("{}");
    expect((await readFile(
      join(system_root, ".claude", "delamains", "ops", "telemetry", "events.jsonl"),
      "utf-8",
    )).trim()).toBe("{\"event\":\"tick\"}");
    expect((await readFile(
      join(system_root, ".claude", "delamains", "ops", "dispatcher", "control", "drain-request.json"),
      "utf-8",
    )).trim()).toBe("{\"requested\":true}");

    await writeFile(
      join(system_root, ".claude", "delamains", "ops", "runtime", "worktree-state.json"),
      "{\"dirty\":true}\n",
      "utf-8",
    );
    expect(readGit(system_root, [
      "check-ignore",
      "-q",
      "--",
      ".claude/delamains/ops/runtime/worktree-state.json",
    ])).toBe("");

    const rerun = spawnSync("bash", [
      join(v1ToV2RecipeRoot, "scripts", "cleanup-tracked-runtime-ephemera.sh"),
      ".",
    ], {
      cwd: system_root,
      encoding: "utf-8",
    });
    expect(rerun.status).toBe(0);
    expect(readGit(system_root, ["rev-list", "--count", "HEAD"])).toBe("2");
    expect(readGit(system_root, ["status", "--short"])).toBe("");
  });
});

test("runner fails closed when a mutating step writes outside .als/", async () => {
  await withUpgradeHarness("boundary", {
    bundle_files: {
      "scripts/bad-write.sh": "#!/usr/bin/env bash\nprintf 'boom\\n' > README.md\n",
    },
  }, async ({ bundle_root, state_path, system_root }) => {
    const recipe = createRecipe([
      {
        id: "bad-write",
        title: "Write outside .als",
        type: "script",
        category: "must-run",
        depends_on: [],
        preconditions: [],
        postconditions: [],
        trigger: "auto",
        path: "scripts/bad-write.sh",
        args: [],
      },
    ]);
    const hop = createHop(bundle_root, recipe);

    const result = await executeLanguageUpgradeChain({
      system_root,
      hops: [hop],
      target_als_version: 2,
      services: createInspectableServices(),
      options: {
        state_path,
      },
    });
    expect(result.status).toBe("failed");
    expect(result.error_code).toBe("mutation_boundary_violation");
  });
});

test("runner applies recommended defaults and skips optional steps by default", async () => {
  await withUpgradeHarness("category-defaults", {
    bundle_files: {
      "scripts/recommended.sh": "#!/usr/bin/env bash\nprintf 'recommended\\n' > .als/recommended.txt\n",
      "scripts/optional.sh": "#!/usr/bin/env bash\nprintf 'optional\\n' > .als/optional.txt\n",
    },
  }, async ({ bundle_root, state_path, system_root }) => {
    const recipe = createRecipe([
      {
        id: "recommended",
        title: "Recommended step",
        type: "script",
        category: "recommended",
        depends_on: [],
        preconditions: [],
        postconditions: [],
        trigger: "auto",
        path: "scripts/recommended.sh",
        args: [],
      },
      {
        id: "optional",
        title: "Optional step",
        type: "script",
        category: "optional",
        depends_on: [],
        preconditions: [],
        postconditions: [],
        trigger: "manual",
        path: "scripts/optional.sh",
        args: [],
      },
    ]);
    const hop = createHop(bundle_root, recipe);

    const result = await executeLanguageUpgradeChain({
      system_root,
      hops: [hop],
      target_als_version: 2,
      services: createInspectableServices(),
      options: {
        state_path,
      },
    });
    expect(result.status).toBe("completed");
    expect(result.state.hops[0]?.steps.map((step) => step.status)).toEqual(["completed", "skipped"]);
    expect((await readFile(join(system_root, ".als", "recommended.txt"), "utf-8")).trim()).toBe("recommended");
    await expect(readFile(join(system_root, ".als", "optional.txt"), "utf-8")).rejects.toThrow();
  });
});

test("runner fails closed on unsupported recipe schemas", async () => {
  await withUpgradeHarness("unsupported-schema", {}, async ({ bundle_root, state_path, system_root }) => {
    const recipe = {
      ...createRecipe([]),
      schema: "als-language-upgrade-recipe@9",
    } as LanguageUpgradeRecipe;
    const hop = createHop(bundle_root, recipe);

    await expect(executeLanguageUpgradeChain({
      system_root,
      hops: [hop],
      target_als_version: 2,
      services: createInspectableServices(),
      options: {
        state_path,
      },
    })).rejects.toThrow("Unsupported language-upgrade-recipe schema");
  });
});

test("verification compares the upgraded snapshot against the expected fixture", async () => {
  await withUpgradeHarness("verification", {
    bundle_files: {
      "scripts/rewrite.sh": "#!/usr/bin/env bash\nprintf '2\\n' > .als/version.txt\n",
    },
  }, async ({ bundle_root, root, system_root }) => {
    const expectedRoot = join(root, "expected");
    await mkdir(expectedRoot, { recursive: true });
    await writeFixtureFiles(expectedRoot, {
      ".als/version.txt": "2\n",
      ".als/system.ts": "export const system = { als_version: 1 };\n",
    });

    const recipe = createRecipe([
      {
        id: "rewrite",
        title: "Rewrite ALS version marker",
        type: "script",
        category: "must-run",
        depends_on: [],
        preconditions: [],
        postconditions: [],
        trigger: "auto",
        path: "scripts/rewrite.sh",
        args: [],
      },
    ]);

    const verification = await verifyLanguageUpgradeRecipe({
      from_fixture_path: system_root,
      expected_fixture_path: expectedRoot,
      hop: createHop(bundle_root, recipe),
      services: createInspectableServices(),
    });

    expect(verification.schema).toBe("als-language-upgrade-recipe-verification@1");
    expect(verification.status).toBe("pass");
    expect(verification.mismatches).toEqual([]);
    expect(verification.step_results[0]?.status).toBe("completed");
  });
});

test("shipped v1-to-v2 recipe verifies against the frozen fixtures", async () => {
  const inspection = inspectLanguageUpgradeRecipe(v1ToV2RecipeRoot);
  expect(inspection.status).toBe("pass");
  if (inspection.status !== "pass" || !inspection.recipe) {
    return;
  }

  const workingRoot = await mkdtemp(join(tmpdir(), "als-upgrade-language-fixture-"));
  const fromFixtureRoot = join(workingRoot, "from");
  const expectedFixtureRoot = join(workingRoot, "expected");

  try {
    await prepareRunnableFixture(v1FixtureRoot, fromFixtureRoot);
    await prepareRunnableFixture(v2FixtureRoot, expectedFixtureRoot);

    const verification = await verifyLanguageUpgradeRecipe({
      from_fixture_path: fromFixtureRoot,
      expected_fixture_path: expectedFixtureRoot,
      hop: {
        hop_id: "v1-to-v2",
        recipe: inspection.recipe,
        recipe_path: inspection.recipe_path,
        bundle_root: inspection.bundle_root,
      },
      services: {
        inspect_system(systemRoot) {
          const validation = validateSystem(systemRoot);
          return {
            als_version: validation.als_version,
            status: validation.status,
          };
        },
      },
    });

    expect(verification.status).toBe("pass");
    expect(verification.mismatches).toEqual([]);
    expect(verification.step_results.map((step) => step.status)).toEqual(["completed", "completed"]);
  } finally {
    await rm(workingRoot, { recursive: true, force: true });
  }
});

async function writeFixtureFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = join(root, relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, "utf-8");
  }
}

async function prepareRunnableFixture(sourceRoot: string, targetRoot: string): Promise<void> {
  await cp(sourceRoot, targetRoot, { recursive: true });
  await writeFile(
    join(targetRoot, ".als", "authoring.ts"),
    [
      `export { defineSystem, defineModule, defineDelamain } from ${JSON.stringify(authoringRuntimePath)};`,
      "export {",
      "  COMPATIBILITY_CLASSES,",
      "  COMPATIBILITY_CLASS_METADATA,",
      "  COMPATIBILITY_CLASS_RELEASE_HEADLINE_ORDER,",
      "  compareCompatibilityClassesByPrecedence,",
      "  highestCompatibilityClass,",
      "  isCompatibilityClass,",
      "  sortCompatibilityClassesByPrecedence,",
      "  type CompatibilityClass,",
      `} from ${JSON.stringify(contractsRuntimePath)};`,
      "",
    ].join("\n"),
    "utf-8",
  );
}

function initializeGitRepository(root: string): void {
  runGit(root, ["init"]);
  runGit(root, ["config", "user.name", "ALS Upgrade Tests"]);
  runGit(root, ["config", "user.email", "als-upgrade-tests@local"]);
  runGit(root, ["add", "."]);
  runGit(root, ["commit", "--no-gpg-sign", "-m", "Initial test fixture"]);
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

function readGit(root: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`);
  }

  return result.stdout.trim();
}
