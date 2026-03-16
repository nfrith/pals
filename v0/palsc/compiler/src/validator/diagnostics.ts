// Diagnostic codes and helpers, per diagnostic-codes.md.

import type { CompilerDiagnostic, CompilerPhase, DiagnosticSeverity } from "../types.js";

// Diagnostic builder — creates a diagnostic with sensible defaults.
export function diag(
  code: string,
  severity: DiagnosticSeverity,
  phase: CompilerPhase,
  file: string,
  message: string,
  opts: {
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
    location: { line: opts.line ?? null, column: opts.column ?? null },
    entity: opts.entity ?? null,
    field: opts.field ?? null,
    message,
    expected: opts.expected ?? null,
    actual: opts.actual ?? null,
    hint: opts.hint ?? null,
  };
}

// Code constants from diagnostic-codes.md
export const codes = {
  // Parse phase
  PARSE_FRONTMATTER: "PAL-RV-PARSE-001",
  PARSE_SECTIONS: "PAL-RV-PARSE-002",
  PARSE_ENTITY_INFER: "PAL-RV-PARSE-003",

  // Record frontmatter
  FM_MISSING_FIELD: "PAL-RV-FM-001",
  FM_UNKNOWN_FIELD: "PAL-RV-FM-002",
  FM_ENUM_INVALID: "PAL-RV-FM-003",
  FM_TYPE_MISMATCH: "PAL-RV-FM-004",
  FM_DATE_FORMAT: "PAL-RV-FM-005",
  FM_REF_FORMAT: "PAL-RV-FM-006",
  FM_ARRAY_ITEM: "PAL-RV-FM-007",

  // Record body
  BODY_MISSING_SECTION: "PAL-RV-BODY-001",
  BODY_UNKNOWN_SECTION: "PAL-RV-BODY-002",
  BODY_NULL_NOT_ALLOWED: "PAL-RV-BODY-003",
  BODY_VALUE_TYPE: "PAL-RV-BODY-004",
  BODY_EMPTY_MARKER: "PAL-RV-BODY-005",

  // Identity
  ID_FILENAME_MISMATCH: "PAL-RV-ID-001",
  ID_DUPLICATE: "PAL-RV-ID-002",

  // Reference
  REF_MALFORMED: "PAL-RV-REF-001",
  REF_CONTRACT_MISMATCH: "PAL-RV-REF-002",
  REF_UNRESOLVED: "PAL-RV-REF-003",
  REF_ENTITY_MISMATCH: "PAL-RV-REF-004",
  REF_LABEL_MISMATCH: "PAL-RV-REF-005",
  REF_PARENT_PREFIX: "PAL-RV-REF-006",

  // Module consistency
  MOD_PATH_MISMATCH: "PAL-RV-MOD-001",
  MOD_PARENT_CONSISTENCY: "PAL-RV-MOD-002",
  MOD_NAMESPACE: "PAL-RV-MOD-003",
} as const;
