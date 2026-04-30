export const ALS_VERSION_V1 = 1 as const;
export const SUPPORTED_ALS_VERSIONS = [ALS_VERSION_V1] as const;

export const VALIDATION_OUTPUT_SCHEMA_LITERAL = "als-validation-output@1" as const;
export const DEPLOY_OUTPUT_SCHEMA_LITERAL = "als-claude-deploy-output@4" as const;
export const LANGUAGE_UPGRADE_RECIPE_SCHEMA_LITERAL = "als-language-upgrade-recipe@1" as const;
export const LANGUAGE_UPGRADE_RECIPE_INSPECTION_SCHEMA_LITERAL = "als-language-upgrade-recipe-inspection@1" as const;
export const LANGUAGE_UPGRADE_RECIPE_VERIFICATION_SCHEMA_LITERAL = "als-language-upgrade-recipe-verification@1" as const;

export const LANGUAGE_UPGRADE_RECIPE_STEP_TYPES = [
  "script",
  "agent-task",
  "gate",
  "operator-prompt",
] as const;

export const LANGUAGE_UPGRADE_RECIPE_CATEGORIES = [
  "must-run",
  "recommended",
  "optional",
  "recovery",
] as const;

export const LANGUAGE_UPGRADE_RECIPE_TRIGGERS = [
  "auto",
  "manual",
  "on-error",
] as const;

export const LANGUAGE_UPGRADE_GATE_ACCEPT_STATUSES = [
  "pass",
  "warn",
] as const;

export const LANGUAGE_UPGRADE_OPERATOR_PROMPT_INTENTS = [
  "confirm-live-apply",
  "acknowledge-future-obligation",
  "operator-owned-data-choice",
] as const;

export const LANGUAGE_UPGRADE_CHECK_NAMES = [
  "als-version-matches-from",
  "als-version-matches-to",
  "validates-as-from-version",
  "validates-as-to-version",
] as const;

export const COMPATIBILITY_CLASSES = [
  "docs_only",
  "refresh_required",
  "additive",
  "migration_required",
  "breaking_without_path",
] as const;

export const COMPATIBILITY_CLASS_RELEASE_HEADLINE_ORDER = [
  "breaking_without_path",
  "migration_required",
  "refresh_required",
  "additive",
  "docs_only",
] as const;

export interface EnumValueDeprecation {
  since: string;
  removed_in: string;
  replacement: string | null;
}

// One system targets one ALS version at a time. Upgrades rewrite the system before
// the next compiler run becomes authoritative.
export const ALS_UPGRADE_MODE = "whole-system-cutover" as const;
// Official upgrades may combine deterministic rewrites with supervised agent guidance.
export const ALS_UPGRADE_ASSISTANCE = "hybrid-assisted" as const;

export type SupportedAlsVersion = (typeof SUPPORTED_ALS_VERSIONS)[number];
export type AlsUpgradeMode = typeof ALS_UPGRADE_MODE;
export type AlsUpgradeAssistance = typeof ALS_UPGRADE_ASSISTANCE;
export type CompatibilityClass = (typeof COMPATIBILITY_CLASSES)[number];
export type LanguageUpgradeRecipeSchemaLiteral = typeof LANGUAGE_UPGRADE_RECIPE_SCHEMA_LITERAL;
export type LanguageUpgradeRecipeInspectionSchemaLiteral = typeof LANGUAGE_UPGRADE_RECIPE_INSPECTION_SCHEMA_LITERAL;
export type LanguageUpgradeRecipeVerificationSchemaLiteral = typeof LANGUAGE_UPGRADE_RECIPE_VERIFICATION_SCHEMA_LITERAL;
export type LanguageUpgradeRecipeStepType = (typeof LANGUAGE_UPGRADE_RECIPE_STEP_TYPES)[number];
export type LanguageUpgradeRecipeCategory = (typeof LANGUAGE_UPGRADE_RECIPE_CATEGORIES)[number];
export type LanguageUpgradeRecipeTrigger = (typeof LANGUAGE_UPGRADE_RECIPE_TRIGGERS)[number];
export type LanguageUpgradeGateAcceptStatus = (typeof LANGUAGE_UPGRADE_GATE_ACCEPT_STATUSES)[number];
export type LanguageUpgradeOperatorPromptIntent = (typeof LANGUAGE_UPGRADE_OPERATOR_PROMPT_INTENTS)[number];
export type LanguageUpgradeCheckName = (typeof LANGUAGE_UPGRADE_CHECK_NAMES)[number];

interface CompatibilityClassMetadataShape {
  description: string;
  operator_action_required: boolean;
  release_headline_precedence: number;
}

interface LanguageUpgradeRecipeCategoryMetadataShape {
  description: string;
  default_trigger: LanguageUpgradeRecipeTrigger;
  operator_decision: "required" | "default_opt_out" | "default_opt_in" | "failure_only";
}

type EnumContractValues = readonly string[];
type EnumValueDeprecationMap<TValues extends EnumContractValues> = Partial<
  Record<TValues[number], EnumValueDeprecation>
>;

export interface CompilerEnumDeprecationDefinition {
  values: readonly string[];
  deprecations: Readonly<Record<string, EnumValueDeprecation | undefined>>;
}

const COMPILER_ENUM_DEPRECATION_FIXTURES_ENV = "ALS_COMPILER_ENUM_DEPRECATION_FIXTURES_JSON";

export const COMPATIBILITY_CLASS_METADATA = {
  docs_only: {
    description: "Docs or wording changed with no contract or runtime impact.",
    operator_action_required: false,
    release_headline_precedence: 4,
  },
  refresh_required: {
    description: "Bundled operator surface changed and the operator must rerun deploy or an installer skill.",
    operator_action_required: true,
    release_headline_precedence: 2,
  },
  additive: {
    description: "New capability landed and existing authored systems stay valid.",
    operator_action_required: false,
    release_headline_precedence: 3,
  },
  migration_required: {
    description: "Authored source or live data must change and a guided path ships with the release.",
    operator_action_required: true,
    release_headline_precedence: 1,
  },
  breaking_without_path: {
    description: "Existing systems can break and no guided path ships.",
    operator_action_required: true,
    release_headline_precedence: 0,
  },
} as const satisfies Record<CompatibilityClass, CompatibilityClassMetadataShape>;

export const COMPATIBILITY_CLASS_DEPRECATIONS = {} as const satisfies EnumValueDeprecationMap<
  typeof COMPATIBILITY_CLASSES
>;

export type CompatibilityClassMetadata = (typeof COMPATIBILITY_CLASS_METADATA)[CompatibilityClass];

export const LANGUAGE_UPGRADE_RECIPE_CATEGORY_METADATA = {
  "must-run": {
    description: "Always execute unless an earlier hard failure halts the journey.",
    default_trigger: "auto",
    operator_decision: "required",
  },
  recommended: {
    description: "Execute by default, but allow an explicit operator opt-out.",
    default_trigger: "auto",
    operator_decision: "default_opt_out",
  },
  optional: {
    description: "Skip by default and run only through an explicit operator opt-in.",
    default_trigger: "manual",
    operator_decision: "default_opt_in",
  },
  recovery: {
    description: "Run only after a declared earlier step failure.",
    default_trigger: "on-error",
    operator_decision: "failure_only",
  },
} as const satisfies Record<LanguageUpgradeRecipeCategory, LanguageUpgradeRecipeCategoryMetadataShape>;

export type LanguageUpgradeRecipeCategoryMetadata =
  (typeof LANGUAGE_UPGRADE_RECIPE_CATEGORY_METADATA)[LanguageUpgradeRecipeCategory];

const COMPILER_ENUM_DEPRECATION_CONTRACTS = new Map<string, CompilerEnumDeprecationDefinition>([
  [
    "compatibility_classes",
    {
      values: COMPATIBILITY_CLASSES,
      deprecations: COMPATIBILITY_CLASS_DEPRECATIONS,
    },
  ],
]);

export type CompilerEnumDeprecationContract = string;

export interface CompilerEnumValueDeprecation extends EnumValueDeprecation {
  contract: CompilerEnumDeprecationContract;
  value: string;
}

const compatibilityClassPrecedence = new Map<CompatibilityClass, number>(
  COMPATIBILITY_CLASS_RELEASE_HEADLINE_ORDER.map((value, index) => [value, index]),
);
let compilerEnumDeprecationContractsHydratedFromEnv = false;

function enumContractValuesMatch(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function isEnumValueDeprecationShape(value: unknown): value is EnumValueDeprecation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<EnumValueDeprecation>;
  return typeof candidate.since === "string"
    && typeof candidate.removed_in === "string"
    && (typeof candidate.replacement === "string" || candidate.replacement === null);
}

function isCompilerEnumDeprecationDefinitionShape(
  value: unknown,
): value is CompilerEnumDeprecationDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<CompilerEnumDeprecationDefinition>;
  if (!Array.isArray(candidate.values) || !candidate.values.every((entry) => typeof entry === "string")) {
    return false;
  }

  if (!candidate.deprecations || typeof candidate.deprecations !== "object" || Array.isArray(candidate.deprecations)) {
    return false;
  }

  return Object.values(candidate.deprecations).every(
    (entry) => entry === undefined || isEnumValueDeprecationShape(entry),
  );
}

function hydrateCompilerEnumDeprecationContractsFromEnv(): void {
  if (compilerEnumDeprecationContractsHydratedFromEnv) {
    return;
  }

  compilerEnumDeprecationContractsHydratedFromEnv = true;
  const serializedDefinitions = process.env[COMPILER_ENUM_DEPRECATION_FIXTURES_ENV];
  if (!serializedDefinitions) {
    return;
  }

  let parsedDefinitions: unknown;
  try {
    parsedDefinitions = JSON.parse(serializedDefinitions);
  } catch {
    return;
  }

  if (!parsedDefinitions || typeof parsedDefinitions !== "object" || Array.isArray(parsedDefinitions)) {
    return;
  }

  for (const [contract, definition] of Object.entries(parsedDefinitions as Record<string, unknown>)) {
    if (!isCompilerEnumDeprecationDefinitionShape(definition)) {
      continue;
    }

    registerCompilerEnumDeprecationContract(contract, definition);
  }
}

// Test fixtures register synthetic contracts through this seam so production source
// only ships the real compiler-owned registry entries.
export function registerCompilerEnumDeprecationContract(
  contract: string,
  definition: CompilerEnumDeprecationDefinition,
): void {
  COMPILER_ENUM_DEPRECATION_CONTRACTS.set(contract, {
    values: [...definition.values],
    deprecations: { ...definition.deprecations },
  });
}

export function unregisterCompilerEnumDeprecationContract(contract: string): void {
  if (contract === "compatibility_classes") {
    return;
  }

  COMPILER_ENUM_DEPRECATION_CONTRACTS.delete(contract);
}

export function isSupportedAlsVersion(value: number): value is SupportedAlsVersion {
  return SUPPORTED_ALS_VERSIONS.includes(value as SupportedAlsVersion);
}

export function isCompatibilityClass(value: string): value is CompatibilityClass {
  return COMPATIBILITY_CLASSES.includes(value as CompatibilityClass);
}

export function isLanguageUpgradeRecipeStepType(value: string): value is LanguageUpgradeRecipeStepType {
  return LANGUAGE_UPGRADE_RECIPE_STEP_TYPES.includes(value as LanguageUpgradeRecipeStepType);
}

export function isLanguageUpgradeRecipeCategory(value: string): value is LanguageUpgradeRecipeCategory {
  return LANGUAGE_UPGRADE_RECIPE_CATEGORIES.includes(value as LanguageUpgradeRecipeCategory);
}

export function isLanguageUpgradeRecipeTrigger(value: string): value is LanguageUpgradeRecipeTrigger {
  return LANGUAGE_UPGRADE_RECIPE_TRIGGERS.includes(value as LanguageUpgradeRecipeTrigger);
}

export function isLanguageUpgradeGateAcceptStatus(value: string): value is LanguageUpgradeGateAcceptStatus {
  return LANGUAGE_UPGRADE_GATE_ACCEPT_STATUSES.includes(value as LanguageUpgradeGateAcceptStatus);
}

export function isLanguageUpgradeOperatorPromptIntent(value: string): value is LanguageUpgradeOperatorPromptIntent {
  return LANGUAGE_UPGRADE_OPERATOR_PROMPT_INTENTS.includes(value as LanguageUpgradeOperatorPromptIntent);
}

export function isLanguageUpgradeCheckName(value: string): value is LanguageUpgradeCheckName {
  return LANGUAGE_UPGRADE_CHECK_NAMES.includes(value as LanguageUpgradeCheckName);
}

export function defaultLanguageUpgradeTriggerForCategory(
  category: LanguageUpgradeRecipeCategory,
): LanguageUpgradeRecipeTrigger {
  return LANGUAGE_UPGRADE_RECIPE_CATEGORY_METADATA[category].default_trigger;
}

export function compareCompatibilityClassesByPrecedence(
  left: CompatibilityClass,
  right: CompatibilityClass,
): number {
  return (compatibilityClassPrecedence.get(left) ?? Number.MAX_SAFE_INTEGER)
    - (compatibilityClassPrecedence.get(right) ?? Number.MAX_SAFE_INTEGER);
}

export function sortCompatibilityClassesByPrecedence(
  classes: Iterable<CompatibilityClass>,
): CompatibilityClass[] {
  return Array.from(new Set(classes)).sort(compareCompatibilityClassesByPrecedence);
}

export function highestCompatibilityClass(
  classes: Iterable<CompatibilityClass>,
): CompatibilityClass | null {
  const [highest] = sortCompatibilityClassesByPrecedence(classes);
  return highest ?? null;
}

export function findCompilerEnumValueDeprecation(
  allowedValues: readonly string[],
  value: string,
): CompilerEnumValueDeprecation | null {
  hydrateCompilerEnumDeprecationContractsFromEnv();

  for (const [contract, definition] of COMPILER_ENUM_DEPRECATION_CONTRACTS.entries()) {
    if (!enumContractValuesMatch(definition.values, allowedValues)) {
      continue;
    }

    const deprecation = definition.deprecations[value];
    if (!deprecation) {
      continue;
    }

    return {
      contract,
      value,
      ...deprecation,
    };
  }

  return null;
}
