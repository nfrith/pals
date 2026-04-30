import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { stringify as stringifyYaml } from "yaml";

export interface LanguageUpgradeRecipeFixture {
  root: string;
  recipe_path: string;
}

export interface LanguageUpgradeRecipeFixtureInput {
  recipe: Record<string, unknown>;
  files?: Record<string, string>;
}

export function createValidLanguageUpgradeRecipeFixtureInput(): LanguageUpgradeRecipeFixtureInput {
  return {
    recipe: {
      schema: "als-language-upgrade-recipe@1",
      from: {
        als_version: 1,
      },
      to: {
        als_version: 2,
      },
      summary: "Rewrite ALS-managed language files and validate the cutover.",
      steps: [
        {
          id: "validate-source",
          title: "Validate the source system",
          type: "gate",
          category: "must-run",
          path: "gates/validate-source.sh",
          provides: ["validates-as-from-version"],
          depends_on: [],
        },
        {
          id: "rewrite-als",
          title: "Rewrite ALS-managed source",
          type: "script",
          category: "must-run",
          path: "scripts/rewrite-als.sh",
          depends_on: ["validate-source"],
          preconditions: ["als-version-matches-from", "validates-as-from-version"],
        },
        {
          id: "confirm-live-apply",
          title: "Confirm live apply",
          type: "operator-prompt",
          category: "must-run",
          intent: "confirm-live-apply",
          path: "operator-prompts/confirm-live-apply.md",
          depends_on: ["rewrite-als"],
        },
        {
          id: "validate-target",
          title: "Validate the upgraded system",
          type: "gate",
          category: "must-run",
          path: "gates/validate-target.sh",
          provides: ["validates-as-to-version"],
          depends_on: ["confirm-live-apply"],
          postconditions: ["validates-as-to-version"],
        },
        {
          id: "repair-invalid-records",
          title: "Repair invalid ALS-managed records",
          type: "agent-task",
          category: "recovery",
          trigger: "on-error",
          recovers: {
            step_ids: ["validate-target"],
            error_codes: ["als_validation_failed"],
          },
          path: "agent-tasks/repair-invalid-records.md",
          depends_on: ["rewrite-als"],
        },
      ],
    },
    files: {
      "scripts/rewrite-als.sh": "#!/usr/bin/env bash\nexit 0\n",
      "gates/validate-source.sh": "#!/usr/bin/env bash\nexit 0\n",
      "gates/validate-target.sh": "#!/usr/bin/env bash\nexit 0\n",
      "agent-tasks/repair-invalid-records.md": "# Repair invalid records\n\nFix the invalid ALS-managed records and stop when validation passes.\n",
      "operator-prompts/confirm-live-apply.md": "# Confirm live apply\n\nReady to apply the ALS v2 changes to your `.als/` directory?\n",
    },
  };
}

export async function withLanguageUpgradeRecipeFixture(
  label: string,
  input: LanguageUpgradeRecipeFixtureInput,
  run: (fixture: LanguageUpgradeRecipeFixture) => Promise<void> | void,
): Promise<void> {
  const fixture = await createLanguageUpgradeRecipeFixture(label, input);
  let runError: unknown = null;

  try {
    await run(fixture);
  } catch (error) {
    runError = error;
  }

  try {
    await rm(fixture.root, { recursive: true, force: true });
  } catch (cleanupError) {
    if (!runError) {
      throw cleanupError;
    }
  }

  if (runError) {
    throw runError;
  }
}

async function createLanguageUpgradeRecipeFixture(
  label: string,
  input: LanguageUpgradeRecipeFixtureInput,
): Promise<LanguageUpgradeRecipeFixture> {
  const safeLabel = label.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  const root = await mkdtemp(join(tmpdir(), `als-upgrade-recipe-${safeLabel}-${randomUUID()}-`));
  const recipePath = join(root, "recipe.yaml");

  await writeFile(recipePath, stringifyYaml(input.recipe), "utf-8");
  for (const [relativePath, contents] of Object.entries(input.files ?? {})) {
    const filePath = join(root, relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, "utf-8");
  }

  return {
    root,
    recipe_path: recipePath,
  };
}
