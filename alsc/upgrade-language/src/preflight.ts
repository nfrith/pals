import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  LANGUAGE_UPGRADE_RECIPE_SCHEMA_LITERAL,
  type LanguageUpgradeOperatorPromptIntent,
} from "../../compiler/src/contracts.ts";
import type { LanguageUpgradeRecipeStep } from "../../compiler/src/types.ts";
import type { LanguageUpgradeChainPlan, PlannedLanguageUpgradeHop } from "./plan-chain.ts";

export interface LanguageUpgradeSelectionOptions {
  enabled_optional_step_ids?: string[];
  skipped_recommended_step_ids?: string[];
}

export interface LanguageUpgradePreflightPromptOption {
  value: string;
  label: string;
  description: string;
}

export interface LanguageUpgradePreflightPrompt {
  key: string;
  hop_id: string;
  step_id: string;
  intent: LanguageUpgradeOperatorPromptIntent;
  markdown: string;
  options: LanguageUpgradePreflightPromptOption[];
}

export interface LanguageUpgradePreflightServices {
  read_text_file?(filePath: string): Promise<string> | string;
}

export interface LanguageUpgradePreflightResult {
  summary: LanguageUpgradePreflightSummary;
  prompts: LanguageUpgradePreflightPrompt[];
}

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

export async function preflightLanguageUpgradeChain(input: {
  current_als_version: number;
  target_als_version: number;
  hops: PlannedLanguageUpgradeHop[];
  options?: LanguageUpgradeSelectionOptions;
  services?: LanguageUpgradePreflightServices;
}): Promise<LanguageUpgradePreflightResult> {
  validateSupportedRecipeSchemas(input.hops);
  validateExecutablePromptContract(input.hops);

  const summary = buildLanguageUpgradePreflightSummary({
    status: "pass",
    current_als_version: input.current_als_version,
    target_als_version: input.target_als_version,
    hops: input.hops,
    error: null,
  });
  const options = {
    enabled_optional_step_ids: [...(input.options?.enabled_optional_step_ids ?? [])],
    skipped_recommended_step_ids: [...(input.options?.skipped_recommended_step_ids ?? [])],
  };
  const readTextFile = input.services?.read_text_file ?? defaultReadTextFile;
  const prompts: LanguageUpgradePreflightPrompt[] = [];

  for (const hop of input.hops) {
    const orderedSteps = sortRecipeSteps(hop.recipe.steps);
    const stepStatuses = new Map<string, "completed" | "skipped">();

    while (true) {
      const nextStep = orderedSteps.find((step) =>
        step.category !== "recovery"
        && !stepStatuses.has(step.id)
        && dependenciesSatisfied(stepStatuses, step.depends_on)
      );

      if (!nextStep) {
        break;
      }

      if (shouldSkipStep(nextStep, options)) {
        stepStatuses.set(nextStep.id, "skipped");
        continue;
      }

      if (nextStep.type === "operator-prompt") {
        prompts.push({
          key: `${hop.hop_id}:${nextStep.id}`,
          hop_id: hop.hop_id,
          step_id: nextStep.id,
          intent: nextStep.intent,
          markdown: await readTextFile(resolve(hop.bundle_root, nextStep.path)),
          options: [],
        });
      }

      stepStatuses.set(nextStep.id, "completed");
    }
  }

  return {
    summary,
    prompts,
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

function validateSupportedRecipeSchemas(hops: PlannedLanguageUpgradeHop[]): void {
  for (const hop of hops) {
    if (hop.recipe.schema !== LANGUAGE_UPGRADE_RECIPE_SCHEMA_LITERAL) {
      throw new Error(
        `Unsupported language-upgrade-recipe schema '${hop.recipe.schema}'. Fail closed.`,
      );
    }
  }
}

function validateExecutablePromptContract(hops: PlannedLanguageUpgradeHop[]): void {
  for (const hop of hops) {
    for (const step of hop.recipe.steps) {
      if (step.type === "operator-prompt" && step.category === "recovery") {
        throw new Error(
          `Language upgrade hop '${hop.hop_id}' step '${step.id}' may not use operator-prompt with category 'recovery'.`,
        );
      }
    }
  }
}

function shouldSkipStep(
  step: LanguageUpgradeRecipeStep,
  options: Required<LanguageUpgradeSelectionOptions>,
): boolean {
  if (step.category === "optional") {
    return !options.enabled_optional_step_ids.includes(step.id);
  }

  if (step.category === "recommended") {
    return options.skipped_recommended_step_ids.includes(step.id);
  }

  return false;
}

function dependenciesSatisfied(
  stepStatuses: Map<string, "completed" | "skipped">,
  dependencyIds: string[],
): boolean {
  return dependencyIds.every((dependencyId) => stepStatuses.get(dependencyId) === "completed");
}

function sortRecipeSteps(steps: LanguageUpgradeRecipeStep[]): LanguageUpgradeRecipeStep[] {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const step of steps) {
    inDegree.set(step.id, 0);
    adjacency.set(step.id, []);
  }

  for (const step of steps) {
    for (const dependency of step.depends_on) {
      if (!byId.has(dependency)) {
        continue;
      }
      adjacency.get(dependency)!.push(step.id);
      inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
    }
  }

  const queue = steps.filter((step) => (inDegree.get(step.id) ?? 0) === 0).map((step) => step.id);
  const ordered: LanguageUpgradeRecipeStep[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    ordered.push(byId.get(current)!);
    for (const next of adjacency.get(current) ?? []) {
      const nextInDegree = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, nextInDegree);
      if (nextInDegree === 0) {
        queue.push(next);
      }
    }
  }

  return ordered.length === steps.length ? ordered : [...steps];
}

function defaultReadTextFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf-8");
}
