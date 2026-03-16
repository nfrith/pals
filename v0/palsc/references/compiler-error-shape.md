# Compiler Error Shape (Current Baseline)

## Scope

This document defines the canonical machine-readable diagnostic format emitted by `palsc validate`.

## Output Envelope

```ts
type CompilerOutput = {
  status: "pass" | "fail" | "warn";
  module_id: string;
  module_path: string;
  module_version: number;
  schema_version: number;
  generated_at: string; // ISO-8601 timestamp
  diagnostics: CompilerDiagnostic[];
  summary: {
    files_checked: number;
    files_passed: number;
    files_failed: number;
    error_count: number;
    warning_count: number;
  };
};
```

## Diagnostic Shape

```ts
type CompilerPhase =
  | "parse"
  | "schema_frontmatter"
  | "schema_content"
  | "module_contract"
  | "record_frontmatter"
  | "record_body"
  | "identity"
  | "reference"
  | "module_consistency";

type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [k: string]: JSONValue };

type CompilerDiagnostic = {
  code: string; // defined in diagnostic-codes.md
  severity: "error" | "warning";
  phase: CompilerPhase;
  file: string; // repo-relative file path
  location: {
    line: number | null; // 1-based
    column: number | null; // 1-based
  };
  entity: string | null;
  field: string | null; // frontmatter field or section key
  message: string; // human-readable explanation
  expected: JSONValue; // expected contract/value
  actual: JSONValue; // observed contract/value
  hint: string | null; // optional next-fix suggestion
};
```

## Required Behavior

1. `code` must be stable and versioned through `diagnostic-codes.md`.
2. `phase` must match where validation failed.
3. `location` should be populated when the parser can determine position; otherwise `null`.
4. `expected` and `actual` must be structured values, not ad hoc prose.
5. `status` is computed from diagnostics:
   - `fail` if at least one `error`
   - `warn` if zero errors and at least one warning
   - `pass` if no diagnostics

## Example

```json
{
  "status": "fail",
  "module_id": "backlog",
  "module_path": "workspace/backlog",
  "module_version": 1,
  "schema_version": 1,
  "generated_at": "2026-03-05T10:10:22Z",
  "diagnostics": [
    {
      "code": "PAL-RV-FM-003",
      "severity": "error",
      "phase": "record_frontmatter",
      "file": "workspace/backlog/stories/STORY-0001.md",
      "location": { "line": 4, "column": 9 },
      "entity": "story",
      "field": "status",
      "message": "Enum value is not in allowed set",
      "expected": ["draft", "ready", "in-progress", "done"],
      "actual": "pending",
      "hint": "Set status to one of the allowed values in story schema."
    }
  ],
  "summary": {
    "files_checked": 8,
    "files_passed": 7,
    "files_failed": 1,
    "error_count": 1,
    "warning_count": 0
  }
}
```
