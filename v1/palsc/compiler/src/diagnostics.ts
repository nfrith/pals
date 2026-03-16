import type { CompilerDiagnostic, DiagnosticSeverity, ValidationPhase } from "./types.ts";

export const codes = {
  SYSTEM_INVALID: "PAL-CV-SYS-001",
  SYSTEM_FILTER_UNKNOWN: "PAL-CV-SYS-002",
  SHAPE_INVALID: "PAL-CV-SHAPE-001",
  SHAPE_REGISTRY_MISMATCH: "PAL-CV-SHAPE-002",
  SHAPE_CONTRACT_INVALID: "PAL-CV-SHAPE-003",
  BODY_CONSTRAINT_VIOLATION: "PAL-CV-BODY-001",
  BODY_ORDER_MISMATCH: "PAL-CV-BODY-002",

  PARSE_FRONTMATTER: "PAL-RV-PARSE-001",
  PARSE_ENTITY_INFER: "PAL-RV-PARSE-003",

  FM_MISSING_FIELD: "PAL-RV-FM-001",
  FM_UNKNOWN_FIELD: "PAL-RV-FM-002",
  FM_ENUM_INVALID: "PAL-RV-FM-003",
  FM_TYPE_MISMATCH: "PAL-RV-FM-004",
  FM_DATE_FORMAT: "PAL-RV-FM-005",
  FM_REF_FORMAT: "PAL-RV-FM-006",
  FM_ARRAY_ITEM: "PAL-RV-FM-007",

  BODY_MISSING_SECTION: "PAL-RV-BODY-001",
  BODY_UNKNOWN_SECTION: "PAL-RV-BODY-002",
  BODY_NULL_NOT_ALLOWED: "PAL-RV-BODY-003",
  BODY_EMPTY_MARKER: "PAL-RV-BODY-005",

  ID_FILENAME_MISMATCH: "PAL-RV-ID-001",
  ID_DUPLICATE: "PAL-RV-ID-002",

  REF_MALFORMED: "PAL-RV-REF-001",
  REF_CONTRACT_MISMATCH: "PAL-RV-REF-002",
  REF_UNRESOLVED: "PAL-RV-REF-003",
  REF_ENTITY_MISMATCH: "PAL-RV-REF-004",
  REF_PARENT_PREFIX: "PAL-RV-REF-006",

  MOD_PATH_MISMATCH: "PAL-RV-MOD-001",
  MOD_PARENT_CONSISTENCY: "PAL-RV-MOD-002",
} as const;

export function diag(
  code: string,
  severity: DiagnosticSeverity,
  phase: ValidationPhase,
  file: string,
  message: string,
  opts: {
    module_id?: string;
    entity?: string;
    field?: string;
    expected?: unknown;
    actual?: unknown;
    hint?: string;
    line?: number;
    column?: number;
  } = {},
): CompilerDiagnostic {
  return {
    code,
    severity,
    phase,
    file,
    location: {
      line: opts.line ?? null,
      column: opts.column ?? null,
    },
    module_id: opts.module_id ?? null,
    entity: opts.entity ?? null,
    field: opts.field ?? null,
    message,
    expected: opts.expected ?? null,
    actual: opts.actual ?? null,
    hint: opts.hint ?? null,
  };
}

export function computeStatus(diagnostics: CompilerDiagnostic[]): "pass" | "warn" | "fail" {
  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  if (hasErrors) return "fail";
  const hasWarnings = diagnostics.some((diagnostic) => diagnostic.severity === "warning");
  return hasWarnings ? "warn" : "pass";
}
