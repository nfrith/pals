export const ALS_VERSION_V1 = 1 as const;
export const SUPPORTED_ALS_VERSIONS = [ALS_VERSION_V1] as const;

export const VALIDATION_OUTPUT_SCHEMA_LITERAL = "als-validation-output@1" as const;
export const DEPLOY_OUTPUT_SCHEMA_LITERAL = "als-claude-deploy-output@2" as const;

// One system targets one ALS version at a time. Upgrades rewrite the system before
// the next compiler run becomes authoritative.
export const ALS_UPGRADE_MODE = "whole-system-cutover" as const;
// Official upgrades may combine deterministic rewrites with supervised agent guidance.
export const ALS_UPGRADE_ASSISTANCE = "hybrid-assisted" as const;

export type SupportedAlsVersion = (typeof SUPPORTED_ALS_VERSIONS)[number];
export type AlsUpgradeMode = typeof ALS_UPGRADE_MODE;
export type AlsUpgradeAssistance = typeof ALS_UPGRADE_ASSISTANCE;

export function isSupportedAlsVersion(value: number): value is SupportedAlsVersion {
  return SUPPORTED_ALS_VERSIONS.includes(value as SupportedAlsVersion);
}
