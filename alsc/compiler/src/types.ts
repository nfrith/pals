import type { AlsUpgradeAssistance, AlsUpgradeMode } from "./contracts.ts";

export type DiagnosticSeverity = "error" | "warning";

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

export interface ClaudeDelamainNameConflict {
  delamain_name: string;
  // This list always contains at least two distinct module ids when emitted.
  module_ids: string[];
  target_dir: string;
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
  planned_skill_count: number;
  written_skill_count: number;
  planned_skills: ClaudeSkillProjectionPlan[];
  existing_skill_targets: ClaudeSkillProjectionCollision[];
  planned_delamain_count: number;
  written_delamain_count: number;
  planned_delamains: ClaudeDelamainProjectionPlan[];
  existing_delamain_targets: ClaudeDelamainProjectionCollision[];
  delamain_name_conflicts: ClaudeDelamainNameConflict[];
  error: string | null;
}
