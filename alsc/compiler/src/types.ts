import type {
  AlsUpgradeAssistance,
  AlsUpgradeMode,
  LanguageUpgradeCheckName,
  LanguageUpgradeGateAcceptStatus,
  LanguageUpgradeOperatorPromptIntent,
  LanguageUpgradeRecipeCategory,
  LanguageUpgradeRecipeInspectionSchemaLiteral,
  LanguageUpgradeRecipeSchemaLiteral,
  LanguageUpgradeRecipeStepType,
  LanguageUpgradeRecipeTrigger,
  LanguageUpgradeRecipeVerificationSchemaLiteral,
} from "./contracts.ts";

export type DiagnosticSeverity = "error" | "warning";

export interface DeprecationDiagnosticPayload {
  contract: string;
  value: string;
  since: string;
  removed_in: string;
  replacement: string | null;
}

export type ValidationPhase =
  | "system_config"
  | "module_shape"
  | "parse"
  | "record_frontmatter"
  | "record_rows"
  | "record_body"
  | "identity"
  | "reference"
  | "module_consistency";

export interface CompilerDiagnostic {
  code: string;
  reason: string | null;
  severity: DiagnosticSeverity;
  phase: ValidationPhase;
  file: string;
  location: {
    line: number | null;
    column: number | null;
  };
  module_id: string | null;
  entity: string | null;
  field: string | null;
  message: string;
  expected: unknown;
  actual: unknown;
  hint: string | null;
  deprecation: DeprecationDiagnosticPayload | null;
}

export interface ModuleValidationSummary {
  files_checked: number;
  files_passed: number;
  files_failed: number;
  files_ignored: number;
  error_count: number;
  warning_count: number;
}

export interface ModuleValidationReport {
  status: "pass" | "warn" | "fail";
  module_id: string;
  module_path: string;
  module_version: number;
  diagnostics: CompilerDiagnostic[];
  summary: ModuleValidationSummary;
}

export interface SystemValidationOutput {
  schema: string;
  als_version: number | null;
  compiler_contract: {
    supported_als_versions: number[];
    upgrade_mode: AlsUpgradeMode;
    upgrade_assistance: AlsUpgradeAssistance;
  };
  status: "pass" | "warn" | "fail";
  system_path: string;
  generated_at: string;
  module_filter: string | null;
  system_diagnostics: CompilerDiagnostic[];
  modules: ModuleValidationReport[];
  summary: {
    modules_checked: number;
    modules_failed: number;
    files_checked: number;
    files_passed: number;
    files_failed: number;
    files_ignored: number;
    error_count: number;
    warning_count: number;
  };
}

export interface ClaudeSkillProjectionPlan {
  module_id: string;
  module_version: number;
  skill_id: string;
  source_dir: string;
  target_dir: string;
}

export interface ClaudeSkillProjectionCollision {
  module_id: string;
  skill_id: string;
  source_dir: string;
  target_dir: string;
  target_kind: "file" | "directory";
}

export interface ClaudeDelamainProjectionPlan {
  module_id: string;
  module_version: number;
  delamain_name: string;
  source_dir: string;
  target_dir: string;
}

export interface ClaudeDelamainProjectionCollision {
  module_id: string;
  delamain_name: string;
  source_dir: string;
  target_dir: string;
  target_kind: "file" | "directory";
}

export interface ClaudeSystemFilePlan {
  kind: "generated_claude_guidance";
  target_path: string;
}

export interface ClaudeDelamainNameConflict {
  delamain_name: string;
  // This list always contains at least two distinct module ids when emitted.
  module_ids: string[];
  target_dir: string;
}

export interface ClaudeSkillDeployWarning {
  code: "delamain_dispatcher_node_modules_missing";
  message: string;
  module_id: string;
  delamain_name: string;
  target_dir: string;
  target_path: string;
}

export interface ClaudeSkillDeployOutput {
  schema: string;
  status: "pass" | "fail";
  system_path: string;
  generated_at: string;
  validation_status: "pass" | "warn" | "fail";
  module_filter: string | null;
  dry_run: boolean;
  require_empty_targets: boolean;
  planned_system_file_count: number;
  written_system_file_count: number;
  planned_system_files: ClaudeSystemFilePlan[];
  planned_skill_count: number;
  written_skill_count: number;
  planned_skills: ClaudeSkillProjectionPlan[];
  existing_skill_targets: ClaudeSkillProjectionCollision[];
  planned_delamain_count: number;
  written_delamain_count: number;
  planned_delamains: ClaudeDelamainProjectionPlan[];
  existing_delamain_targets: ClaudeDelamainProjectionCollision[];
  delamain_name_conflicts: ClaudeDelamainNameConflict[];
  warnings: ClaudeSkillDeployWarning[];
  error: string | null;
}

export interface LanguageUpgradeRecipeVersionRef {
  als_version: number;
}

export interface LanguageUpgradeRecipeRecoveryContract {
  step_ids: string[];
  error_codes: string[];
}

export interface LanguageUpgradeRecipeStepBase {
  id: string;
  title: string;
  type: LanguageUpgradeRecipeStepType;
  category: LanguageUpgradeRecipeCategory;
  depends_on: string[];
  preconditions: LanguageUpgradeCheckName[];
  postconditions: LanguageUpgradeCheckName[];
  trigger: LanguageUpgradeRecipeTrigger;
  recovers?: LanguageUpgradeRecipeRecoveryContract;
}

export interface LanguageUpgradeRecipeScriptStep extends LanguageUpgradeRecipeStepBase {
  type: "script";
  path: string;
  args: string[];
}

export interface LanguageUpgradeRecipeAgentTaskStep extends LanguageUpgradeRecipeStepBase {
  type: "agent-task";
  path: string;
}

export interface LanguageUpgradeRecipeGateStep extends LanguageUpgradeRecipeStepBase {
  type: "gate";
  path: string;
  provides: LanguageUpgradeCheckName[];
  accept_statuses: LanguageUpgradeGateAcceptStatus[];
}

export interface LanguageUpgradeRecipeOperatorPromptStep extends LanguageUpgradeRecipeStepBase {
  type: "operator-prompt";
  path: string;
  intent: LanguageUpgradeOperatorPromptIntent;
}

export type LanguageUpgradeRecipeStep =
  | LanguageUpgradeRecipeScriptStep
  | LanguageUpgradeRecipeAgentTaskStep
  | LanguageUpgradeRecipeGateStep
  | LanguageUpgradeRecipeOperatorPromptStep;

export interface LanguageUpgradeRecipe {
  schema: LanguageUpgradeRecipeSchemaLiteral;
  from: LanguageUpgradeRecipeVersionRef;
  to: LanguageUpgradeRecipeVersionRef;
  summary: string;
  steps: LanguageUpgradeRecipeStep[];
}

export interface LanguageUpgradeRecipeInspectionIssue {
  code: string;
  path: string;
  message: string;
  expected: unknown;
  actual: unknown;
}

export interface LanguageUpgradeRecipeInspectionOutput {
  schema: LanguageUpgradeRecipeInspectionSchemaLiteral;
  status: "pass" | "fail";
  recipe_path: string;
  bundle_root: string;
  exists: boolean;
  errors: LanguageUpgradeRecipeInspectionIssue[];
  warnings: LanguageUpgradeRecipeInspectionIssue[];
  recipe: LanguageUpgradeRecipe | null;
  step_count: number;
}

export type LanguageUpgradeRecipeVerificationStepStatus =
  | "completed"
  | "failed"
  | "skipped"
  | "paused"
  | "recovered";

export interface LanguageUpgradeRecipeVerificationStepResult {
  hop_id: string;
  step_id: string;
  status: LanguageUpgradeRecipeVerificationStepStatus;
  attempt_count: number;
  error_code: string | null;
  diagnostic: string | null;
}

export interface LanguageUpgradeRecipeVerificationMismatch {
  type: "missing" | "unexpected" | "content_mismatch";
  path: string;
  expected: string | null;
  actual: string | null;
}

export interface LanguageUpgradeRecipeVerificationOutput {
  schema: LanguageUpgradeRecipeVerificationSchemaLiteral;
  status: "pass" | "fail";
  generated_at: string;
  recipe_path: string;
  from_fixture_path: string;
  expected_fixture_path: string;
  actual_fixture_path: string;
  mismatches: LanguageUpgradeRecipeVerificationMismatch[];
  step_results: LanguageUpgradeRecipeVerificationStepResult[];
  error: string | null;
}
