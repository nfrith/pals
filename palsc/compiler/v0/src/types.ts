// Internal model types for the shape compiler.
// SHAPE.yaml is parsed into these types, and the validator operates on them.

export interface ShapeModule {
  module_id: string;
  namespace: string;
  version: number;
  refs: ExternalModuleRef[];
  entities: Map<string, ShapeEntity>;
}

export interface ExternalModuleRef {
  namespace: string;
  module_id: string;
}

export interface ShapeEntity {
  name: string;
  path_template: string;
  parent?: { entity: string; via_field: string };
  fields: Map<string, ShapeField>;
  body_sections: Map<string, ShapeBodySection>;
}

// Discriminated union for field types, mirrors the spec's FieldContract
export type ShapeField =
  | { kind: "id" }
  | { kind: "string"; nullable: boolean }
  | { kind: "number"; nullable: boolean }
  | { kind: "date"; nullable: boolean }
  | { kind: "enum"; nullable: boolean; allowed: string[] }
  | { kind: "ref"; nullable: boolean; target_module?: string; target_entity: string; is_array: false }
  | { kind: "ref_array"; nullable: boolean; target_module?: string; target_entity: string }
  | { kind: "string_array"; nullable: boolean };

export type BodyValueType = "markdown_string" | "markdown_list" | "markdown_string_or_list";

export interface ShapeBodySection {
  name: string;
  value_type: BodyValueType;
  nullable: boolean;
}

// Diagnostic output types, per compiler-error-shape.md
export type DiagnosticSeverity = "error" | "warning";

export type CompilerPhase =
  | "parse"
  | "schema_frontmatter"
  | "schema_content"
  | "module_contract"
  | "record_frontmatter"
  | "record_body"
  | "identity"
  | "reference"
  | "module_consistency";

export interface CompilerDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  phase: CompilerPhase;
  file: string;
  location: { line: number | null; column: number | null };
  entity: string | null;
  field: string | null;
  message: string;
  expected: unknown;
  actual: unknown;
  hint: string | null;
}

export interface CompilerOutput {
  status: "pass" | "fail" | "warn";
  module_id: string;
  module_path: string;
  module_version: number;
  schema_version: number;
  generated_at: string;
  diagnostics: CompilerDiagnostic[];
  summary: {
    files_checked: number;
    files_passed: number;
    files_failed: number;
    error_count: number;
    warning_count: number;
  };
}

// Parsed record (intermediate representation after gray-matter + remark)
export interface ParsedRecord {
  file_path: string;
  relative_path: string;
  frontmatter: Record<string, unknown>;
  body_raw: string;
  body_sections: Map<string, string>;
  entity_name: string | null;
  placeholder_bindings: Map<string, string>;
}
