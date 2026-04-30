import type { LanguageUpgradeRecipeStep } from "../../compiler/src/types.ts";
import type { LanguageUpgradeChainPlan, PlannedLanguageUpgradeHop } from "./plan-chain.ts";

export interface LanguageUpgradePreflightHopSummary {
  hop_id: string;
  recipe_path: string;
  from_als_version: number;
  to_als_version: number;
  summary: string;
  step_counts: {
    total: number;
    must_run: number;
    recommended: number;
    optional: number;
    recovery: number;
    operator_prompt: number;
  };
}

export interface LanguageUpgradePreflightSummary {
  current_als_version: number;
  target_als_version: number;
  hop_count: number;
  hops: LanguageUpgradePreflightHopSummary[];
}

export function buildLanguageUpgradePreflightSummary(
  plan: LanguageUpgradeChainPlan,
): LanguageUpgradePreflightSummary {
  return {
    current_als_version: plan.current_als_version,
    target_als_version: plan.target_als_version,
    hop_count: plan.hops.length,
    hops: plan.hops.map(summarizeHop),
  };
}

function summarizeHop(hop: PlannedLanguageUpgradeHop): LanguageUpgradePreflightHopSummary {
  const stepCounts = countSteps(hop.recipe.steps);
  return {
    hop_id: hop.hop_id,
    recipe_path: hop.recipe_path,
    from_als_version: hop.recipe.from.als_version,
    to_als_version: hop.recipe.to.als_version,
    summary: hop.recipe.summary,
    step_counts: stepCounts,
  };
}

function countSteps(steps: LanguageUpgradeRecipeStep[]): LanguageUpgradePreflightHopSummary["step_counts"] {
  return {
    total: steps.length,
    must_run: steps.filter((step) => step.category === "must-run").length,
    recommended: steps.filter((step) => step.category === "recommended").length,
    optional: steps.filter((step) => step.category === "optional").length,
    recovery: steps.filter((step) => step.category === "recovery").length,
    operator_prompt: steps.filter((step) => step.type === "operator-prompt").length,
  };
}
