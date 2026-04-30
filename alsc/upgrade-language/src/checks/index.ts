import type { LanguageUpgradeCheckName } from "../../../compiler/src/contracts.ts";
import type { LanguageUpgradeRecipe } from "../../../compiler/src/types.ts";

export interface LanguageUpgradeSystemInspection {
  als_version: number | null;
  status: "pass" | "warn" | "fail";
}

export interface LanguageUpgradeCheckResult {
  ok: boolean;
  diagnostic?: string;
}

export interface LanguageUpgradeCheckContext {
  recipe: LanguageUpgradeRecipe;
  get_system_inspection(): Promise<LanguageUpgradeSystemInspection> | LanguageUpgradeSystemInspection;
}

export interface LanguageUpgradeCheckDefinition {
  name: LanguageUpgradeCheckName;
  description: string;
  run(context: LanguageUpgradeCheckContext): Promise<LanguageUpgradeCheckResult> | LanguageUpgradeCheckResult;
}

async function expectInspectedVersion(
  context: LanguageUpgradeCheckContext,
  expectedVersion: number,
  expectedStatus: "pass" | "warn" | "fail" | null,
): Promise<LanguageUpgradeCheckResult> {
  const inspection = await context.get_system_inspection();
  if (inspection.als_version !== expectedVersion) {
    return {
      ok: false,
      diagnostic: `Expected ALS version v${expectedVersion}, received ${inspection.als_version === null ? "<missing>" : `v${inspection.als_version}`}.`,
    };
  }

  if (expectedStatus && inspection.status !== expectedStatus && !(expectedStatus === "pass" && inspection.status === "warn")) {
    return {
      ok: false,
      diagnostic: `Expected validation status '${expectedStatus}', received '${inspection.status}'.`,
    };
  }

  if (inspection.status === "fail") {
    return {
      ok: false,
      diagnostic: "System validation failed.",
    };
  }

  return { ok: true };
}

export const LANGUAGE_UPGRADE_CHECK_REGISTRY = new Map<LanguageUpgradeCheckName, LanguageUpgradeCheckDefinition>([
  [
    "als-version-matches-from",
    {
      name: "als-version-matches-from",
      description: "Current ALS version equals recipe.from.als_version.",
      run(context) {
        return expectInspectedVersion(context, context.recipe.from.als_version, null);
      },
    },
  ],
  [
    "als-version-matches-to",
    {
      name: "als-version-matches-to",
      description: "Current ALS version equals recipe.to.als_version.",
      run(context) {
        return expectInspectedVersion(context, context.recipe.to.als_version, null);
      },
    },
  ],
  [
    "validates-as-from-version",
    {
      name: "validates-as-from-version",
      description: "System validates and still reports recipe.from.als_version.",
      run(context) {
        return expectInspectedVersion(context, context.recipe.from.als_version, "pass");
      },
    },
  ],
  [
    "validates-as-to-version",
    {
      name: "validates-as-to-version",
      description: "System validates and reports recipe.to.als_version.",
      run(context) {
        return expectInspectedVersion(context, context.recipe.to.als_version, "pass");
      },
    },
  ],
]);

export async function runLanguageUpgradeCheck(
  name: LanguageUpgradeCheckName,
  context: LanguageUpgradeCheckContext,
): Promise<LanguageUpgradeCheckResult> {
  const definition = LANGUAGE_UPGRADE_CHECK_REGISTRY.get(name);
  if (!definition) {
    return {
      ok: false,
      diagnostic: `Unknown language upgrade check '${name}'.`,
    };
  }

  return definition.run(context);
}
