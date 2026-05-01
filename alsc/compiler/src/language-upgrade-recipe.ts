import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname, relative, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  defaultLanguageUpgradeTriggerForCategory,
  isLanguageUpgradeCheckName,
  LANGUAGE_UPGRADE_CHECK_NAMES,
  LANGUAGE_UPGRADE_GATE_ACCEPT_STATUSES,
  LANGUAGE_UPGRADE_OPERATOR_PROMPT_INTENTS,
  LANGUAGE_UPGRADE_RECIPE_CATEGORIES,
  LANGUAGE_UPGRADE_RECIPE_INSPECTION_SCHEMA_LITERAL,
  LANGUAGE_UPGRADE_RECIPE_SCHEMA_LITERAL,
  LANGUAGE_UPGRADE_RECIPE_STEP_TYPES,
  LANGUAGE_UPGRADE_RECIPE_TRIGGERS,
  type LanguageUpgradeCheckName,
  type LanguageUpgradeGateAcceptStatus,
  type LanguageUpgradeOperatorPromptIntent,
  type LanguageUpgradeRecipeCategory,
  type LanguageUpgradeRecipeStepType,
  type LanguageUpgradeRecipeTrigger,
} from "./contracts.ts";
import type {
  LanguageUpgradeRecipe,
  LanguageUpgradeRecipeAgentTaskStep,
  LanguageUpgradeRecipeGateStep,
  LanguageUpgradeRecipeInspectionIssue,
  LanguageUpgradeRecipeInspectionOutput,
  LanguageUpgradeRecipeOperatorPromptStep,
  LanguageUpgradeRecipeRecoveryContract,
  LanguageUpgradeRecipeScriptStep,
  LanguageUpgradeRecipeStep,
} from "./types.ts";

const nonEmptyString = z.string().trim().min(1, "must be a non-empty string");
const positiveInt = z.number().int().positive("must be a positive integer");

const rawRecoveryContractSchema = z.object({
  step_ids: z.array(nonEmptyString).min(1),
  error_codes: z.array(nonEmptyString).optional(),
}).strict();

const rawStepShared = {
  id: nonEmptyString,
  title: nonEmptyString,
  category: z.enum(LANGUAGE_UPGRADE_RECIPE_CATEGORIES),
  depends_on: z.array(nonEmptyString).default([]),
  preconditions: z.array(nonEmptyString).optional().default([]),
  postconditions: z.array(nonEmptyString).optional().default([]),
  trigger: z.enum(LANGUAGE_UPGRADE_RECIPE_TRIGGERS).optional(),
  recovers: rawRecoveryContractSchema.optional(),
} as const;

const rawScriptStepSchema = z.object({
  ...rawStepShared,
  type: z.literal("script"),
  path: nonEmptyString,
  args: z.array(nonEmptyString).optional(),
}).strict();

const rawAgentTaskStepSchema = z.object({
  ...rawStepShared,
  type: z.literal("agent-task"),
  path: nonEmptyString,
}).strict();

const rawGateStepSchema = z.object({
  ...rawStepShared,
  type: z.literal("gate"),
  path: nonEmptyString,
  provides: z.array(nonEmptyString).min(1),
  accept_statuses: z.array(z.enum(LANGUAGE_UPGRADE_GATE_ACCEPT_STATUSES)).optional(),
}).strict();

const rawOperatorPromptStepSchema = z.object({
  ...rawStepShared,
  type: z.literal("operator-prompt"),
  path: nonEmptyString,
  intent: z.enum(LANGUAGE_UPGRADE_OPERATOR_PROMPT_INTENTS),
}).strict();

const rawRecipeStepSchema = z.discriminatedUnion("type", [
  rawScriptStepSchema,
  rawAgentTaskStepSchema,
  rawGateStepSchema,
  rawOperatorPromptStepSchema,
]);

const rawRecipeSchema = z.object({
  schema: z.string(),
  from: z.object({
    als_version: positiveInt,
  }).strict(),
  to: z.object({
    als_version: positiveInt,
  }).strict(),
  summary: nonEmptyString,
  steps: z.array(rawRecipeStepSchema).min(1),
}).strict();

type RawRecipe = z.infer<typeof rawRecipeSchema>;
type RawRecipeStep = z.infer<typeof rawRecipeStepSchema>;

interface AssetPathInspection {
  resolved_path: string | null;
  relative_path: string | null;
}

interface ParsedStepMap {
  step_by_id: Map<string, LanguageUpgradeRecipeStep>;
  ordered_steps: LanguageUpgradeRecipeStep[];
}

const OPERATOR_PROMPT_FORBIDDEN_PATTERNS: Array<{
  code: string;
  message: string;
  regex: RegExp;
}> = [
  {
    code: "operator_prompt.forbidden_architecture_choice",
    message: "Operator prompts must not ask the operator to choose the migration architecture.",
    regex: /\bcompat(?:ibility)? shim\b|\blegacy structure\b|\bnew structure\b|\barchitecture\b/i,
  },
  {
    code: "operator_prompt.forbidden_escape_hatch",
    message: "Operator prompts must not offer escape hatches or skip-the-rewrite options.",
    regex: /\bskip\b|\bbypass\b|\bleave as[- ]is\b|\bdo not rewrite\b/i,
  },
  {
    code: "operator_prompt.forbidden_out_of_scope_mutation",
    message: "Operator prompts must not ask the operator to mutate ALS-managed files outside .als/.",
    regex: /\.claude\/|(?:^|[^a-z])CHANGELOG(?:\.md)?\b|plugin tree|nfrith-repos\/als/i,
  },
];

export function resolveLanguageUpgradeRecipePath(inputPath = process.cwd()): string {
  const candidate = resolve(inputPath);
  return basename(candidate) === "recipe.yaml"
    ? candidate
    : resolve(candidate, "recipe.yaml");
}

export function inspectLanguageUpgradeRecipe(inputPath = process.cwd()): LanguageUpgradeRecipeInspectionOutput {
  const recipePath = resolveLanguageUpgradeRecipePath(inputPath);
  const bundleRoot = resolve(recipePath, "..");

  if (!existsSync(recipePath)) {
    return buildInspectionFailure(recipePath, bundleRoot, [
      issue(
        "recipe.path.missing",
        "recipe_path",
        "Language upgrade recipe must resolve to an existing recipe.yaml file.",
        "existing recipe.yaml file",
        recipePath,
      ),
    ]);
  }

  try {
    if (!statSync(recipePath).isFile()) {
      return buildInspectionFailure(recipePath, bundleRoot, [
        issue(
          "recipe.path.not_file",
          "recipe_path",
          "Language upgrade recipe path must resolve to a file.",
          "file",
          "directory",
        ),
      ]);
    }
  } catch (error) {
    return buildInspectionFailure(recipePath, bundleRoot, [
      issue(
        "recipe.path.unreadable",
        "recipe_path",
        `Could not stat recipe file: ${formatError(error)}`,
        "readable file",
        null,
      ),
    ]);
  }

  let rawSource: string;
  try {
    rawSource = readFileSync(recipePath, "utf-8");
  } catch (error) {
    return buildInspectionFailure(recipePath, bundleRoot, [
      issue(
        "recipe.read.failed",
        "recipe_path",
        `Could not read recipe file: ${formatError(error)}`,
        "readable UTF-8 file",
        null,
      ),
    ]);
  }

  let parsedYaml: unknown;
  try {
    parsedYaml = parseYaml(rawSource);
  } catch (error) {
    return buildInspectionFailure(recipePath, bundleRoot, [
      issue(
        "recipe.parse.failed",
        "recipe",
        `Failed to parse recipe YAML: ${formatError(error)}`,
        "valid YAML",
        null,
      ),
    ]);
  }

  const rawRecipe = rawRecipeSchema.safeParse(parsedYaml);
  if (!rawRecipe.success) {
    return buildInspectionFailure(
      recipePath,
      bundleRoot,
      rawRecipe.error.issues.map((entry) => issue(
        "recipe.shape.invalid",
        renderZodPath(entry.path),
        entry.message,
        null,
        null,
      )),
    );
  }

  const errors: LanguageUpgradeRecipeInspectionIssue[] = [];
  const warnings: LanguageUpgradeRecipeInspectionIssue[] = [];

  validateSupportedRecipeSchema(rawRecipe.data.schema, errors);
  validateDuplicateStrings(rawRecipe.data.steps.map((step) => step.id), "steps", "step ids", errors);

  const parsedSteps = parseSteps(rawRecipe.data, bundleRoot, errors, warnings);
  validateStepGraph(parsedSteps.ordered_steps, errors);
  validateRecoveryContracts(parsedSteps.step_by_id, parsedSteps.ordered_steps, errors);

  const recipe: LanguageUpgradeRecipe = {
    schema: LANGUAGE_UPGRADE_RECIPE_SCHEMA_LITERAL,
    from: rawRecipe.data.from,
    to: rawRecipe.data.to,
    summary: rawRecipe.data.summary,
    steps: parsedSteps.ordered_steps,
  };

  return finalizeInspection(recipePath, bundleRoot, errors, warnings, recipe);
}

export function topologicallySortLanguageUpgradeRecipeSteps(
  recipe: LanguageUpgradeRecipe,
): LanguageUpgradeRecipeStep[] {
  const stepById = new Map(recipe.steps.map((step) => [step.id, step]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const step of recipe.steps) {
    inDegree.set(step.id, 0);
    adjacency.set(step.id, []);
  }

  for (const step of recipe.steps) {
    for (const dependency of step.depends_on) {
      if (!stepById.has(dependency)) {
        throw new Error(`Step '${step.id}' depends on unknown step '${dependency}'.`);
      }

      adjacency.get(dependency)!.push(step.id);
      inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
    }
  }

  const queue = recipe.steps
    .filter((step) => (inDegree.get(step.id) ?? 0) === 0)
    .map((step) => step.id);
  const sorted: LanguageUpgradeRecipeStep[] = [];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    sorted.push(stepById.get(currentId)!);

    for (const nextId of adjacency.get(currentId) ?? []) {
      const nextInDegree = (inDegree.get(nextId) ?? 0) - 1;
      inDegree.set(nextId, nextInDegree);
      if (nextInDegree === 0) {
        queue.push(nextId);
      }
    }
  }

  if (sorted.length !== recipe.steps.length) {
    throw new Error("Language upgrade recipe step graph contains a cycle.");
  }

  return sorted;
}

function parseSteps(
  rawRecipe: RawRecipe,
  bundleRoot: string,
  errors: LanguageUpgradeRecipeInspectionIssue[],
  warnings: LanguageUpgradeRecipeInspectionIssue[],
): ParsedStepMap {
  const orderedSteps: LanguageUpgradeRecipeStep[] = [];
  const stepById = new Map<string, LanguageUpgradeRecipeStep>();

  for (const [index, rawStep] of rawRecipe.steps.entries()) {
    const stepPath = `steps.${index}`;
    validateDuplicateStrings(rawStep.depends_on, `${stepPath}.depends_on`, "dependencies", errors);
    validateDuplicateStrings(rawStep.preconditions, `${stepPath}.preconditions`, "preconditions", errors);
    validateDuplicateStrings(rawStep.postconditions, `${stepPath}.postconditions`, "postconditions", errors);

    const trigger = rawStep.trigger ?? defaultLanguageUpgradeTriggerForCategory(rawStep.category);
    validateCategoryTriggerConsistency(rawStep.category, trigger, `${stepPath}.trigger`, errors);
    validateKnownChecks(rawStep.preconditions, `${stepPath}.preconditions`, errors);
    validateKnownChecks(rawStep.postconditions, `${stepPath}.postconditions`, errors);

    if (rawStep.category === "recovery") {
      if (!rawStep.recovers) {
        errors.push(issue(
          "step.recovery_contract.missing",
          `${stepPath}.recovers`,
          "Recovery steps must declare their recovery routing contract.",
          "recovers",
          null,
        ));
      }
    } else if (rawStep.recovers) {
      errors.push(issue(
        "step.recovery_contract.unexpected",
        `${stepPath}.recovers`,
        "Only recovery steps may declare recovers.",
        null,
        rawStep.recovers,
      ));
    }

    if (rawStep.type === "operator-prompt" && rawStep.category === "recovery") {
      errors.push(issue(
        "step.operator_prompt.recovery_forbidden",
        `${stepPath}.category`,
        "Operator-prompt steps may not use category 'recovery'. All operator prompts must be discoverable during preflight.",
        "must-run | recommended | optional",
        rawStep.category,
      ));
    }

    const pathInspection = inspectAssetPath(rawStep.path, bundleRoot, expectedAssetDirectory(rawStep.type), `${stepPath}.path`, errors);
    if (!pathInspection.relative_path) {
      continue;
    }

    if (rawStep.type === "script") {
      const step: LanguageUpgradeRecipeScriptStep = {
        id: rawStep.id,
        title: rawStep.title,
        type: rawStep.type,
        category: rawStep.category,
        depends_on: [...rawStep.depends_on],
        preconditions: rawStep.preconditions as LanguageUpgradeCheckName[],
        postconditions: rawStep.postconditions as LanguageUpgradeCheckName[],
        trigger,
        path: pathInspection.relative_path,
        args: [...(rawStep.args ?? [])],
        recovers: normalizeRecoveryContract(rawStep.recovers),
      };
      orderedSteps.push(step);
      stepById.set(step.id, step);
      continue;
    }

    if (rawStep.type === "agent-task") {
      if (extname(pathInspection.relative_path).toLowerCase() !== ".md") {
        errors.push(issue(
          "step.agent_task.path.invalid_extension",
          `${stepPath}.path`,
          "Agent-task steps must point to markdown assets under agent-tasks/.",
          "markdown file",
          rawStep.path,
        ));
      }

      const step: LanguageUpgradeRecipeAgentTaskStep = {
        id: rawStep.id,
        title: rawStep.title,
        type: rawStep.type,
        category: rawStep.category,
        depends_on: [...rawStep.depends_on],
        preconditions: rawStep.preconditions as LanguageUpgradeCheckName[],
        postconditions: rawStep.postconditions as LanguageUpgradeCheckName[],
        trigger,
        path: pathInspection.relative_path,
        recovers: normalizeRecoveryContract(rawStep.recovers),
      };
      orderedSteps.push(step);
      stepById.set(step.id, step);
      continue;
    }

    if (rawStep.type === "gate") {
      validateDuplicateStrings(rawStep.provides, `${stepPath}.provides`, "provided checks", errors);
      validateKnownChecks(rawStep.provides, `${stepPath}.provides`, errors);
      validateDuplicateStrings(rawStep.accept_statuses ?? [], `${stepPath}.accept_statuses`, "accepted statuses", errors);

      const step: LanguageUpgradeRecipeGateStep = {
        id: rawStep.id,
        title: rawStep.title,
        type: rawStep.type,
        category: rawStep.category,
        depends_on: [...rawStep.depends_on],
        preconditions: rawStep.preconditions as LanguageUpgradeCheckName[],
        postconditions: rawStep.postconditions as LanguageUpgradeCheckName[],
        trigger,
        path: pathInspection.relative_path,
        provides: rawStep.provides as LanguageUpgradeCheckName[],
        accept_statuses: [...(rawStep.accept_statuses ?? ["pass"])] as LanguageUpgradeGateAcceptStatus[],
        recovers: normalizeRecoveryContract(rawStep.recovers),
      };
      orderedSteps.push(step);
      stepById.set(step.id, step);
      continue;
    }

    if (extname(pathInspection.relative_path).toLowerCase() !== ".md") {
      errors.push(issue(
        "step.operator_prompt.path.invalid_extension",
        `${stepPath}.path`,
        "Operator-prompt steps must point to markdown assets under operator-prompts/.",
        "markdown file",
        rawStep.path,
      ));
    }

    lintOperatorPromptMarkdown(pathInspection.resolved_path, `${stepPath}.path`, errors, warnings);
    const step: LanguageUpgradeRecipeOperatorPromptStep = {
      id: rawStep.id,
      title: rawStep.title,
      type: rawStep.type,
      category: rawStep.category,
      depends_on: [...rawStep.depends_on],
      preconditions: rawStep.preconditions as LanguageUpgradeCheckName[],
      postconditions: rawStep.postconditions as LanguageUpgradeCheckName[],
      trigger,
      path: pathInspection.relative_path,
      intent: rawStep.intent as LanguageUpgradeOperatorPromptIntent,
      recovers: normalizeRecoveryContract(rawStep.recovers),
    };
    orderedSteps.push(step);
    stepById.set(step.id, step);
  }

  return {
    step_by_id: stepById,
    ordered_steps: orderedSteps,
  };
}

function normalizeRecoveryContract(
  value: RawRecipeStep["recovers"],
): LanguageUpgradeRecipeRecoveryContract | undefined {
  if (!value) {
    return undefined;
  }

  return {
    step_ids: [...value.step_ids],
    error_codes: [...(value.error_codes ?? [])],
  };
}

function validateSupportedRecipeSchema(
  schema: string,
  errors: LanguageUpgradeRecipeInspectionIssue[],
): void {
  if (schema === LANGUAGE_UPGRADE_RECIPE_SCHEMA_LITERAL) {
    return;
  }

  errors.push(issue(
    "recipe.schema.unsupported",
    "schema",
    "Language upgrade recipes fail closed on unsupported authored schema literals.",
    LANGUAGE_UPGRADE_RECIPE_SCHEMA_LITERAL,
    schema,
  ));
}

function validateCategoryTriggerConsistency(
  category: LanguageUpgradeRecipeCategory,
  trigger: LanguageUpgradeRecipeTrigger,
  path: string,
  errors: LanguageUpgradeRecipeInspectionIssue[],
): void {
  const expected = defaultLanguageUpgradeTriggerForCategory(category);
  if (trigger === expected) {
    return;
  }

  errors.push(issue(
    "step.trigger.invalid_for_category",
    path,
    `Category '${category}' must use trigger '${expected}'.`,
    expected,
    trigger,
  ));
}

function validateKnownChecks(
  values: string[],
  path: string,
  errors: LanguageUpgradeRecipeInspectionIssue[],
): void {
  for (const [index, value] of values.entries()) {
    if (isLanguageUpgradeCheckName(value)) {
      continue;
    }

    errors.push(issue(
      "step.check_name.unknown",
      `${path}.${index}`,
      "Preconditions, postconditions, and gate-provided checks must come from the engine-owned registry.",
      [...LANGUAGE_UPGRADE_CHECK_NAMES],
      value,
    ));
  }
}

function inspectAssetPath(
  assetPath: string,
  bundleRoot: string,
  expectedDirectory: string,
  issuePath: string,
  errors: LanguageUpgradeRecipeInspectionIssue[],
): AssetPathInspection {
  if (looksLikeMarkdownLink(assetPath)) {
    errors.push(issue(
      "step.path.markdown_link",
      issuePath,
      "Recipe asset paths must be plain relative file paths, not markdown links.",
      "relative file path",
      assetPath,
    ));
    return { resolved_path: null, relative_path: null };
  }

  if (looksLikeUri(assetPath)) {
    errors.push(issue(
      "step.path.uri",
      issuePath,
      "Recipe asset paths must not use URI syntax.",
      "relative file path",
      assetPath,
    ));
    return { resolved_path: null, relative_path: null };
  }

  const resolvedPath = resolve(bundleRoot, assetPath);
  const relativePath = normalizeRelativePath(relative(bundleRoot, resolvedPath));
  if (relativePath === "" || relativePath.startsWith("..")) {
    errors.push(issue(
      "step.path.escapes_bundle",
      issuePath,
      "Recipe asset paths must stay inside the hop bundle.",
      expectedDirectory,
      assetPath,
    ));
    return { resolved_path: null, relative_path: null };
  }

  if (!(relativePath === expectedDirectory || relativePath.startsWith(`${expectedDirectory}/`))) {
    errors.push(issue(
      "step.path.wrong_directory",
      issuePath,
      `Recipe asset paths for this step type must live under '${expectedDirectory}/'.`,
      `${expectedDirectory}/...`,
      assetPath,
    ));
  }

  if (!existsSync(resolvedPath)) {
    errors.push(issue(
      "step.path.missing",
      issuePath,
      "Recipe asset path must resolve to an existing file inside the hop bundle.",
      "existing file",
      assetPath,
    ));
    return { resolved_path: null, relative_path: relativePath };
  }

  try {
    if (!statSync(resolvedPath).isFile()) {
      errors.push(issue(
        "step.path.not_file",
        issuePath,
        "Recipe asset path must resolve to a file.",
        "file",
        "directory",
      ));
      return { resolved_path: null, relative_path: relativePath };
    }
  } catch (error) {
    errors.push(issue(
      "step.path.unreadable",
      issuePath,
      `Could not inspect recipe asset path: ${formatError(error)}`,
      "readable file",
      assetPath,
    ));
    return { resolved_path: null, relative_path: relativePath };
  }

  return {
    resolved_path: resolvedPath,
    relative_path: relativePath,
  };
}

function lintOperatorPromptMarkdown(
  filePath: string | null,
  issuePath: string,
  errors: LanguageUpgradeRecipeInspectionIssue[],
  warnings: LanguageUpgradeRecipeInspectionIssue[],
): void {
  if (!filePath) {
    return;
  }

  let source: string;
  try {
    source = readFileSync(filePath, "utf-8");
  } catch (error) {
    errors.push(issue(
      "operator_prompt.read.failed",
      issuePath,
      `Could not read operator-prompt markdown: ${formatError(error)}`,
      "readable markdown file",
      null,
    ));
    return;
  }

  if (source.trim().length === 0) {
    warnings.push(issue(
      "operator_prompt.empty",
      issuePath,
      "Operator-prompt markdown should include the text shown to the operator.",
      "non-empty markdown content",
      "",
    ));
  }

  for (const pattern of OPERATOR_PROMPT_FORBIDDEN_PATTERNS) {
    if (!pattern.regex.test(source)) {
      continue;
    }

    errors.push(issue(
      pattern.code,
      issuePath,
      pattern.message,
      "prompt content limited to the accepted operator-prompt intents",
      filePath,
    ));
  }
}

function validateStepGraph(
  steps: LanguageUpgradeRecipeStep[],
  errors: LanguageUpgradeRecipeInspectionIssue[],
): void {
  const stepIds = new Set(steps.map((step) => step.id));
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const step of steps) {
    adjacency.set(step.id, []);
    inDegree.set(step.id, 0);
  }

  for (const step of steps) {
    for (const [index, dependency] of step.depends_on.entries()) {
      if (!stepIds.has(dependency)) {
        errors.push(issue(
          "step.depends_on.unknown",
          `steps.${step.id}.depends_on.${index}`,
          `Dependency '${dependency}' does not resolve to another step id in this recipe.`,
          Array.from(stepIds),
          dependency,
        ));
        continue;
      }

      if (dependency === step.id) {
        errors.push(issue(
          "step.depends_on.self_reference",
          `steps.${step.id}.depends_on.${index}`,
          "Steps may not depend on themselves.",
          "different step id",
          dependency,
        ));
        continue;
      }

      adjacency.get(dependency)!.push(step.id);
      inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
    }
  }

  const queue = steps
    .filter((step) => (inDegree.get(step.id) ?? 0) === 0)
    .map((step) => step.id);
  let visitedCount = 0;

  while (queue.length > 0) {
    const current = queue.shift()!;
    visitedCount += 1;

    for (const next of adjacency.get(current) ?? []) {
      const nextInDegree = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, nextInDegree);
      if (nextInDegree === 0) {
        queue.push(next);
      }
    }
  }

  if (visitedCount !== steps.length) {
    errors.push(issue(
      "step.graph.cycle",
      "steps",
      "Recipe steps must form an acyclic dependency graph.",
      "acyclic DAG",
      "cycle detected",
    ));
  }
}

function validateRecoveryContracts(
  stepById: Map<string, LanguageUpgradeRecipeStep>,
  steps: LanguageUpgradeRecipeStep[],
  errors: LanguageUpgradeRecipeInspectionIssue[],
): void {
  for (const step of steps) {
    if (!step.recovers) {
      continue;
    }

    validateDuplicateStrings(step.recovers.step_ids, `steps.${step.id}.recovers.step_ids`, "recovery step ids", errors);
    validateDuplicateStrings(step.recovers.error_codes, `steps.${step.id}.recovers.error_codes`, "recovery error codes", errors);

    for (const [index, recoveredStepId] of step.recovers.step_ids.entries()) {
      if (!stepById.has(recoveredStepId)) {
        errors.push(issue(
          "step.recovers.unknown_step",
          `steps.${step.id}.recovers.step_ids.${index}`,
          `Recovery routing target '${recoveredStepId}' does not resolve to a known step id.`,
          Array.from(stepById.keys()),
          recoveredStepId,
        ));
        continue;
      }

      if (recoveredStepId === step.id) {
        errors.push(issue(
          "step.recovers.self_reference",
          `steps.${step.id}.recovers.step_ids.${index}`,
          "Recovery steps must target earlier non-self steps.",
          "different step id",
          recoveredStepId,
        ));
      }
    }
  }
}

function validateDuplicateStrings(
  values: readonly string[],
  path: string,
  label: string,
  errors: LanguageUpgradeRecipeInspectionIssue[],
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (!seen.has(value)) {
      seen.add(value);
      continue;
    }

    errors.push(issue(
      "array.duplicate",
      `${path}.${index}`,
      `${label} must not contain duplicates.`,
      "unique values",
      value,
    ));
  }
}

function expectedAssetDirectory(stepType: LanguageUpgradeRecipeStepType): string {
  switch (stepType) {
    case "script":
      return "scripts";
    case "agent-task":
      return "agent-tasks";
    case "gate":
      return "gates";
    case "operator-prompt":
      return "operator-prompts";
  }
}

function normalizeRelativePath(value: string): string {
  return value.split(sep).join("/");
}

function looksLikeUri(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function looksLikeMarkdownLink(value: string): boolean {
  return /^\[[^\]]+\]\([^)]+\)$/.test(value.trim());
}

function renderZodPath(path: Array<string | number>): string {
  return path.length === 0 ? "recipe" : path.join(".");
}

function buildInspectionFailure(
  recipePath: string,
  bundleRoot: string,
  errors: LanguageUpgradeRecipeInspectionIssue[],
): LanguageUpgradeRecipeInspectionOutput {
  return finalizeInspection(recipePath, bundleRoot, errors, [], null);
}

function finalizeInspection(
  recipePath: string,
  bundleRoot: string,
  errors: LanguageUpgradeRecipeInspectionIssue[],
  warnings: LanguageUpgradeRecipeInspectionIssue[],
  recipe: LanguageUpgradeRecipe | null,
): LanguageUpgradeRecipeInspectionOutput {
  return {
    schema: LANGUAGE_UPGRADE_RECIPE_INSPECTION_SCHEMA_LITERAL,
    status: errors.length > 0 ? "fail" : "pass",
    recipe_path: recipePath,
    bundle_root: bundleRoot,
    exists: existsSync(recipePath),
    errors,
    warnings,
    recipe,
    step_count: recipe?.steps.length ?? 0,
  };
}

function issue(
  code: string,
  path: string,
  message: string,
  expected: unknown,
  actual: unknown,
): LanguageUpgradeRecipeInspectionIssue {
  return {
    code,
    path,
    message,
    expected,
    actual,
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
