import type {
  ConstructActionManifest,
  ConstructActionProcessLocator,
  ConstructActionStartContract,
  ConstructManifest,
} from "../../compiler/src/construct-upgrade.ts";
import type { ConstructFailureState, ConstructOperatorPromptIntent } from "../../compiler/src/construct-contracts.ts";

export interface ConstructUpgradePromptOption {
  value: string;
  label: string;
  description: string;
}

export interface ConstructUpgradePrompt {
  key: string;
  construct: string;
  instance_id: string;
  display_name: string;
  intent: ConstructOperatorPromptIntent;
  markdown: string;
  options: ConstructUpgradePromptOption[];
}

export interface ConstructUpgradeValidationMetadata {
  requires_claude_deploy: boolean;
  touched_paths: string[];
}

export interface ConstructUpgradeTelemetryEvent {
  type: string;
  timestamp: string;
  construct: string;
  message: string;
  data: Record<string, unknown>;
}

export interface ConstructUpgradePreflightResult {
  construct: string;
  current_version: number | null;
  target_version: number;
  needs_upgrade: boolean;
  prompts: ConstructUpgradePrompt[];
  validation: ConstructUpgradeValidationMetadata | null;
  telemetry: ConstructUpgradeTelemetryEvent[];
}

export interface ConstructUpgradeExecuteResult {
  construct: string;
  current_version: number | null;
  target_version: number;
  needs_upgrade: boolean;
  staged_paths: string[];
  action_manifest: ConstructActionManifest | null;
  validation: ConstructUpgradeValidationMetadata | null;
  telemetry: ConstructUpgradeTelemetryEvent[];
}

export interface ConstructUpgradeRuntimeRecord {
  applied_version: number;
  updated_at: string;
}

export interface ConstructUpgradeRuntimeState {
  schema: "als-construct-upgrade-runtime-state@1";
  system_root: string;
  constructs: Record<string, ConstructUpgradeRuntimeRecord>;
  updated_at: string;
}

export interface DelamainDispatcherInstance {
  instance_id: string;
  display_name: string;
  dispatcher_root: string;
  relative_dispatcher_root: string;
}

export interface ConstructBundleDefinition {
  root: string;
  manifest: ConstructManifest;
}

export interface ConstructVersionFingerprint {
  version: number;
  hashes: Record<string, string>;
}

export interface SequentialMigrationContext {
  system_root: string;
  target_root: string;
  construct_name: string;
  instance_id: string | null;
  from_version: number;
  to_version: number;
}

export interface SequentialMigrationStep {
  from_version: number;
  to_version: number;
  script_path: string;
}

export interface ConstructActionRunnerOptions {
  system_root: string;
  plugin_root: string;
  poll_ms?: number;
  drain_ack_timeout_ms?: number;
  stop_timeout_ms?: number;
  start_timeout_ms?: number;
  dispatcher_heartbeat_stale_threshold_ms?: number;
}

export interface ConstructActionRunnerFailure {
  action_index: number;
  action_kind: string;
  precise_failure_state: Exclude<ConstructFailureState, "lifecycle-partial">;
  overall_failure_state: ConstructFailureState;
  message: string;
}

export interface ConstructActionRunnerResult {
  success: boolean;
  completed_action_count: number;
  total_action_count: number;
  failure: ConstructActionRunnerFailure | null;
}

export interface ProcessConstructDefinition {
  construct: "statusline" | "dashboard";
  bundle_root: string;
  start: ConstructActionStartContract;
  process_locator: ConstructActionProcessLocator;
}
