export const ALS_VERSION_V1 = 1 as const;
export const SUPPORTED_ALS_VERSIONS = [ALS_VERSION_V1] as const;

export const VALIDATION_OUTPUT_SCHEMA_LITERAL = "als-validation-output@1" as const;
export const DEPLOY_OUTPUT_SCHEMA_LITERAL = "als-claude-deploy-output@4" as const;

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

// One system targets one ALS version at a time. Upgrades rewrite the system before
// the next compiler run becomes authoritative.
export const ALS_UPGRADE_MODE = "whole-system-cutover" as const;
// Official upgrades may combine deterministic rewrites with supervised agent guidance.
export const ALS_UPGRADE_ASSISTANCE = "hybrid-assisted" as const;

export type SupportedAlsVersion = (typeof SUPPORTED_ALS_VERSIONS)[number];
export type AlsUpgradeMode = typeof ALS_UPGRADE_MODE;
export type AlsUpgradeAssistance = typeof ALS_UPGRADE_ASSISTANCE;
export type CompatibilityClass = (typeof COMPATIBILITY_CLASSES)[number];

interface CompatibilityClassMetadataShape {
  description: string;
  operator_action_required: boolean;
  release_headline_precedence: number;
}

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

export type CompatibilityClassMetadata = (typeof COMPATIBILITY_CLASS_METADATA)[CompatibilityClass];

const compatibilityClassPrecedence = new Map<CompatibilityClass, number>(
  COMPATIBILITY_CLASS_RELEASE_HEADLINE_ORDER.map((value, index) => [value, index]),
);

export function isSupportedAlsVersion(value: number): value is SupportedAlsVersion {
  return SUPPORTED_ALS_VERSIONS.includes(value as SupportedAlsVersion);
}

export function isCompatibilityClass(value: string): value is CompatibilityClass {
  return COMPATIBILITY_CLASSES.includes(value as CompatibilityClass);
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
