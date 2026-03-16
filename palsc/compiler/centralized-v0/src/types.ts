export type DiagnosticSeverity = "error" | "warning";

export type ValidationPhase =
  | "system_config"
  | "module_shape"
  | "parse"
  | "record_frontmatter"
  | "record_body"
  | "identity"
  | "reference"
  | "module_consistency";

export interface CompilerDiagnostic {
  code: string;
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
  error_count: number;
  warning_count: number;
}

export interface ModuleValidationReport {
  status: "pass" | "warn" | "fail";
  module_id: string;
  module_path: string;
  module_version: number;
  shape_schema: string | null;
  diagnostics: CompilerDiagnostic[];
  summary: ModuleValidationSummary;
}

export interface SystemValidationOutput {
  status: "pass" | "warn" | "fail";
  system_path: string;
  generated_at: string;
  system_diagnostics: CompilerDiagnostic[];
  modules: ModuleValidationReport[];
  summary: {
    modules_checked: number;
    modules_failed: number;
    files_checked: number;
    files_passed: number;
    files_failed: number;
    error_count: number;
    warning_count: number;
  };
}
