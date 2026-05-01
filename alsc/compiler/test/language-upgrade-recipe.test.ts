import { expect, test } from "bun:test";
import { runCli } from "../src/cli.ts";
import {
  inspectLanguageUpgradeRecipe,
  topologicallySortLanguageUpgradeRecipeSteps,
} from "../src/language-upgrade-recipe.ts";
import {
  createValidLanguageUpgradeRecipeFixtureInput,
  withLanguageUpgradeRecipeFixture,
} from "./helpers/language-upgrade-fixture.ts";

function captureCli(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  let stdout = "";
  let stderr = "";
  const exitCode = runCli(args, {
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

test("language-upgrade-recipe inspection accepts the canonical authored surface", async () => {
  await withLanguageUpgradeRecipeFixture("upgrade-recipe-pass", createValidLanguageUpgradeRecipeFixtureInput(), ({ root }) => {
    const inspection = inspectLanguageUpgradeRecipe(root);

    expect(inspection.schema).toBe("als-language-upgrade-recipe-inspection@1");
    expect(inspection.status).toBe("pass");
    expect(inspection.errors).toEqual([]);
    expect(inspection.recipe?.schema).toBe("als-language-upgrade-recipe@1");
    expect(inspection.recipe?.steps).toHaveLength(5);
    expect(inspection.recipe?.steps.find((step) => step.id === "rewrite-als")?.trigger).toBe("auto");
    expect(inspection.recipe?.steps.find((step) => step.id === "validate-target")).toEqual(expect.objectContaining({
      type: "gate",
      accept_statuses: ["pass"],
      provides: ["validates-as-to-version"],
    }));
    expect(inspection.recipe?.steps.find((step) => step.id === "repair-invalid-records")).toEqual(expect.objectContaining({
      category: "recovery",
      recovers: {
        step_ids: ["validate-target"],
        error_codes: ["als_validation_failed"],
      },
    }));

    const orderedIds = topologicallySortLanguageUpgradeRecipeSteps(inspection.recipe!).map((step) => step.id);
    expect(orderedIds.indexOf("validate-source")).toBeLessThan(orderedIds.indexOf("rewrite-als"));
    expect(orderedIds.indexOf("rewrite-als")).toBeLessThan(orderedIds.indexOf("confirm-live-apply"));
  });
});

test("alsc upgrade-recipe inspect emits the public inspection output contract", async () => {
  await withLanguageUpgradeRecipeFixture("upgrade-recipe-cli-pass", createValidLanguageUpgradeRecipeFixtureInput(), ({ root }) => {
    const result = captureCli(["upgrade-recipe", "inspect", root]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const output = JSON.parse(result.stdout) as {
      schema: string;
      status: string;
      step_count: number;
    };
    expect(output.schema).toBe("als-language-upgrade-recipe-inspection@1");
    expect(output.status).toBe("pass");
    expect(output.step_count).toBe(5);
  });
});

test("inspection rejects duplicate step ids and dependency cycles", async () => {
  const fixtureInput = createValidLanguageUpgradeRecipeFixtureInput();
  const recipe = structuredClone(fixtureInput.recipe) as {
    steps: Array<Record<string, unknown>>;
  };
  recipe.steps[4] = {
    ...recipe.steps[4],
    id: "rewrite-als",
  };
  recipe.steps[0] = {
    ...recipe.steps[0],
    depends_on: ["validate-target"],
  };

  await withLanguageUpgradeRecipeFixture("upgrade-recipe-graph-fail", {
    ...fixtureInput,
    recipe,
  }, ({ root }) => {
    const inspection = inspectLanguageUpgradeRecipe(root);

    expect(inspection.status).toBe("fail");
    expect(inspection.errors.some((entry) => entry.code === "array.duplicate" && entry.path === "steps.4")).toBe(true);
    expect(inspection.errors.some((entry) => entry.code === "step.graph.cycle" && entry.path === "steps")).toBe(true);
  });
});

test("inspection rejects out-of-bundle asset paths and unsupported named checks", async () => {
  const fixtureInput = createValidLanguageUpgradeRecipeFixtureInput();
  const recipe = structuredClone(fixtureInput.recipe) as {
    steps: Array<Record<string, unknown>>;
  };
  recipe.steps[1] = {
    ...recipe.steps[1],
    path: "../scripts/rewrite-als.sh",
    preconditions: ["writes-confined-to-dot-als"],
  };

  await withLanguageUpgradeRecipeFixture("upgrade-recipe-boundary-fail", {
    ...fixtureInput,
    recipe,
  }, ({ root }) => {
    const inspection = inspectLanguageUpgradeRecipe(root);

    expect(inspection.status).toBe("fail");
    expect(inspection.errors.some((entry) => entry.code === "step.path.escapes_bundle")).toBe(true);
    expect(inspection.errors.some((entry) => entry.code === "step.check_name.unknown" && entry.path === "steps.1.preconditions.0")).toBe(true);
  });
});

test("inspection rejects forbidden operator-prompt content and invalid trigger defaults", async () => {
  const fixtureInput = createValidLanguageUpgradeRecipeFixtureInput();
  const recipe = structuredClone(fixtureInput.recipe) as {
    steps: Array<Record<string, unknown>>;
  };
  recipe.steps[2] = {
    ...recipe.steps[2],
    category: "optional",
    trigger: "auto",
  };

  await withLanguageUpgradeRecipeFixture("upgrade-recipe-prompt-fail", {
    recipe,
    files: {
      ...fixtureInput.files,
      "operator-prompts/confirm-live-apply.md": "# Decide the architecture\n\nChoose between a compat shim or a new structure before continuing.\n",
    },
  }, ({ root }) => {
    const inspection = inspectLanguageUpgradeRecipe(root);

    expect(inspection.status).toBe("fail");
    expect(inspection.errors.some((entry) => entry.code === "step.trigger.invalid_for_category" && entry.path === "steps.2.trigger")).toBe(true);
    expect(inspection.errors.some((entry) => entry.code === "operator_prompt.forbidden_architecture_choice")).toBe(true);
  });
});

test("inspection rejects recovery-category operator-prompt steps", async () => {
  const fixtureInput = createValidLanguageUpgradeRecipeFixtureInput();
  const recipe = structuredClone(fixtureInput.recipe) as {
    steps: Array<Record<string, unknown>>;
  };
  recipe.steps[2] = {
    ...recipe.steps[2],
    category: "recovery",
    trigger: "on-error",
    recovers: {
      step_ids: ["rewrite-als"],
      error_codes: ["script_failed"],
    },
  };

  await withLanguageUpgradeRecipeFixture("upgrade-recipe-recovery-prompt-fail", {
    ...fixtureInput,
    recipe,
  }, ({ root }) => {
    const inspection = inspectLanguageUpgradeRecipe(root);

    expect(inspection.status).toBe("fail");
    expect(inspection.errors.some((entry) => entry.code === "step.operator_prompt.recovery_forbidden")).toBe(true);
  });
});
