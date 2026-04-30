import type { LanguageUpgradeRecipe } from "../../compiler/src/types.ts";

export interface PlannedLanguageUpgradeHop {
  hop_id: string;
  recipe: LanguageUpgradeRecipe;
  recipe_path: string;
  bundle_root: string;
}

export interface LanguageUpgradeChainPlan {
  status: "pass" | "fail";
  current_als_version: number;
  target_als_version: number;
  hops: PlannedLanguageUpgradeHop[];
  error: string | null;
}

export function planLanguageUpgradeChain(input: {
  current_als_version: number;
  target_als_version: number;
  recipes: PlannedLanguageUpgradeHop[];
}): LanguageUpgradeChainPlan {
  const currentVersion = input.current_als_version;
  const targetVersion = input.target_als_version;

  if (targetVersion < currentVersion) {
    return {
      status: "fail",
      current_als_version: currentVersion,
      target_als_version: targetVersion,
      hops: [],
      error: `Target ALS version v${targetVersion} is behind current version v${currentVersion}. Rollback is not supported.`,
    };
  }

  if (targetVersion === currentVersion) {
    return {
      status: "pass",
      current_als_version: currentVersion,
      target_als_version: targetVersion,
      hops: [],
      error: null,
    };
  }

  const recipesByFrom = new Map<number, PlannedLanguageUpgradeHop[]>();
  for (const recipe of input.recipes) {
    const list = recipesByFrom.get(recipe.recipe.from.als_version) ?? [];
    list.push(recipe);
    recipesByFrom.set(recipe.recipe.from.als_version, list);
  }

  const hops: PlannedLanguageUpgradeHop[] = [];
  let versionCursor = currentVersion;

  while (versionCursor < targetVersion) {
    const candidates = (recipesByFrom.get(versionCursor) ?? [])
      .filter((entry) => entry.recipe.to.als_version <= targetVersion)
      .sort((left, right) => left.recipe.to.als_version - right.recipe.to.als_version);

    if (candidates.length === 0) {
      return {
        status: "fail",
        current_als_version: currentVersion,
        target_als_version: targetVersion,
        hops,
        error: `No language-upgrade-recipe starts at ALS v${versionCursor}.`,
      };
    }

    if (candidates.length > 1) {
      return {
        status: "fail",
        current_als_version: currentVersion,
        target_als_version: targetVersion,
        hops,
        error: `Multiple language-upgrade-recipes start at ALS v${versionCursor}; the chain is ambiguous.`,
      };
    }

    const [selected] = candidates;
    hops.push({
      ...selected,
      hop_id: buildHopId(selected.recipe.from.als_version, selected.recipe.to.als_version),
    });
    versionCursor = selected.recipe.to.als_version;
  }

  return {
    status: "pass",
    current_als_version: currentVersion,
    target_als_version: targetVersion,
    hops,
    error: null,
  };
}

export function buildHopId(fromAlsVersion: number, toAlsVersion: number): string {
  return `v${fromAlsVersion}-to-v${toAlsVersion}`;
}
