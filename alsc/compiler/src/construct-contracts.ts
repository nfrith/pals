export const CONSTRUCT_MANIFEST_SCHEMA_LITERAL = "als-construct-manifest@1" as const;
export const CONSTRUCT_ACTION_MANIFEST_SCHEMA_LITERAL = "als-construct-action-manifest@1" as const;

export const CONSTRUCT_MIGRATION_STRATEGIES = [
  "sequential",
] as const;

export const CONSTRUCT_LIFECYCLE_STRATEGIES = [
  "dispatcher-lifecycle",
  "process-lifecycle",
  "none",
] as const;

export const CONSTRUCT_OPERATOR_PROMPT_INTENTS = [
  "pick-construct-lifecycle",
  "confirm-construct-overwrite",
] as const;

export const CONSTRUCT_ACTION_KINDS = [
  "drain-then-restart",
  "kill-then-restart",
  "start-only",
] as const;

export const CONSTRUCT_FAILURE_STATES = [
  "lifecycle-drain-stalled",
  "lifecycle-stop-failed",
  "lifecycle-start-failed",
  "lifecycle-partial",
] as const;

export const CONSTRUCT_PROCESS_LOCATOR_KINDS = [
  "json-file-pid",
  "argv-substring",
] as const;

export const CONSTRUCT_DRAIN_SIGNAL_KINDS = [
  "json-file-write",
] as const;

export const CONSTRUCT_SOURCE_PATH_OWNERS = [
  "vendor",
  "operator",
] as const;

export const CONSTRUCT_RUNTIME_PATH_PLACEHOLDERS = [
  "$ALS_SYSTEM_ROOT",
  "$CLAUDE_PLUGIN_ROOT",
] as const;

export type ConstructManifestSchemaLiteral = typeof CONSTRUCT_MANIFEST_SCHEMA_LITERAL;
export type ConstructActionManifestSchemaLiteral = typeof CONSTRUCT_ACTION_MANIFEST_SCHEMA_LITERAL;
export type ConstructMigrationStrategyName = (typeof CONSTRUCT_MIGRATION_STRATEGIES)[number];
export type ConstructLifecycleStrategyName = (typeof CONSTRUCT_LIFECYCLE_STRATEGIES)[number];
export type ConstructOperatorPromptIntent = (typeof CONSTRUCT_OPERATOR_PROMPT_INTENTS)[number];
export type ConstructActionKind = (typeof CONSTRUCT_ACTION_KINDS)[number];
export type ConstructFailureState = (typeof CONSTRUCT_FAILURE_STATES)[number];
export type ConstructProcessLocatorKind = (typeof CONSTRUCT_PROCESS_LOCATOR_KINDS)[number];
export type ConstructDrainSignalKind = (typeof CONSTRUCT_DRAIN_SIGNAL_KINDS)[number];
export type ConstructSourcePathOwner = (typeof CONSTRUCT_SOURCE_PATH_OWNERS)[number];
export type ConstructRuntimePathPlaceholder = (typeof CONSTRUCT_RUNTIME_PATH_PLACEHOLDERS)[number];

export function isConstructMigrationStrategyName(value: unknown): value is ConstructMigrationStrategyName {
  return typeof value === "string"
    && CONSTRUCT_MIGRATION_STRATEGIES.includes(value as ConstructMigrationStrategyName);
}

export function isConstructLifecycleStrategyName(value: unknown): value is ConstructLifecycleStrategyName {
  return typeof value === "string"
    && CONSTRUCT_LIFECYCLE_STRATEGIES.includes(value as ConstructLifecycleStrategyName);
}

export function isConstructOperatorPromptIntent(value: unknown): value is ConstructOperatorPromptIntent {
  return typeof value === "string"
    && CONSTRUCT_OPERATOR_PROMPT_INTENTS.includes(value as ConstructOperatorPromptIntent);
}

export function isConstructActionKind(value: unknown): value is ConstructActionKind {
  return typeof value === "string"
    && CONSTRUCT_ACTION_KINDS.includes(value as ConstructActionKind);
}

export function isConstructFailureState(value: unknown): value is ConstructFailureState {
  return typeof value === "string"
    && CONSTRUCT_FAILURE_STATES.includes(value as ConstructFailureState);
}

export function isConstructProcessLocatorKind(value: unknown): value is ConstructProcessLocatorKind {
  return typeof value === "string"
    && CONSTRUCT_PROCESS_LOCATOR_KINDS.includes(value as ConstructProcessLocatorKind);
}

export function isConstructDrainSignalKind(value: unknown): value is ConstructDrainSignalKind {
  return typeof value === "string"
    && CONSTRUCT_DRAIN_SIGNAL_KINDS.includes(value as ConstructDrainSignalKind);
}

export function isConstructSourcePathOwner(value: unknown): value is ConstructSourcePathOwner {
  return typeof value === "string"
    && CONSTRUCT_SOURCE_PATH_OWNERS.includes(value as ConstructSourcePathOwner);
}

export function isConstructRuntimePathPlaceholder(value: unknown): value is ConstructRuntimePathPlaceholder {
  return typeof value === "string"
    && CONSTRUCT_RUNTIME_PATH_PLACEHOLDERS.includes(value as ConstructRuntimePathPlaceholder);
}
