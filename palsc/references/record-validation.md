# Record Validation Specification (Current Baseline)

## Scope

This document defines how to validate a data record file (for example `workspace/backlog/stories/STORY-0001.md`) against module schemas.

Schema-file shape is defined separately in:

1. `palsc/references/frontmatter-schema-definition.md`
2. `palsc/references/content-schema-definition.md`
3. `palsc/references/module-schema-definition.md`

## Inputs

```ts
type RecordValidationInput = {
  module_path: string; // workspace/<module_id>
  module_contract_path: string; // workspace/<module_id>/MODULE.md
  schema_dir_path: string; // workspace/<module_id>/.schema or skill vN/schemas
  record_path: string; // one concrete record file
  optional_previous_snapshot_path?: string; // used for immutability checks
};
```

## Validation Pipeline (Execution Order)

Run phases in this exact order:

1. Preload module context.
2. Parse record.
3. Validate frontmatter against `frontmatter_contract`.
4. Validate body sections against inline section contracts.
5. Validate identity invariants.
6. Validate references.
7. Validate module-level consistency.

The compiler should collect as many diagnostics as possible per file. If parsing fails, downstream phases for that file are skipped.

## Phase 1: Preload Module Context

1. Parse `MODULE.md` and validate it against `palsc/references/module-schema-definition.md`.
2. Load `module_id`, `namespace`, `uri_scheme`, `module_version`, `schema_version`, entity paths, and `references.modules`.
3. Load all schema files from schema dir.
4. Build an entity schema registry keyed by `entity`.
5. Build an ID index for reference resolution:
   - key: `(namespace, module_id, entity, id)`
   - value: absolute record path

## Phase 2: Parse Record

1. Parse YAML frontmatter.
2. Parse markdown body sections (`##` headings).
3. Infer target entity from `record_path` using module entity paths.
4. Match section headings literally against schema section names:
   - case-sensitive
   - whitespace-sensitive
   - punctuation-sensitive
   - examples:
     - schema `SUCCESS_CRITERIA` requires record `## SUCCESS_CRITERIA`
     - record `## Success Criteria` is not equivalent
5. Parse ref values as markdown links:
   - form: `[display](pals://<namespace>/<module>/<id>)`
   - canonical truth is URI target, not display label

## Phase 3: Frontmatter Contract Validation

Given `schema.frontmatter_contract`, validate:

1. Declared field presence:
   - every field declared in the contract must exist in record frontmatter.
2. Unknown fields:
   - any frontmatter field not declared in contract is a validation error.
3. Nullability semantics:
   - `nullable: false` fields must be non-null and pass type checks.
   - `nullable: true` fields must still be present and may be explicit `null` or pass type checks.
4. Type checks by declared `type` (for non-null values):
   - `id`: non-empty string
   - `string`: string scalar
   - `number`: numeric scalar
   - `date`: `YYYY-MM-DD`
   - `enum`: string and member of `allowed`
   - `ref`: markdown link string with URI target matching contract (`uri_scheme`, `namespace`, `module`, `target_entity`)
   - `array`: YAML sequence; each item validates against `items`
5. Array item checks:
   - `items.type: string` -> each item is string
   - `items.type: ref` -> each item is valid ref link matching declared ref contract

## Phase 4: Body Contract Validation

Given inline section contracts in schema body, validate:

1. Declared section presence:
   - every section declared in schema body must exist in the record body.
2. Unknown sections:
   - record sections not declared in schema are validation errors.
3. Null semantics:
   - explicit empty marker is literal `null`
   - `nullable: true` allows explicit `null`
   - `nullable: false` rejects explicit `null`
4. Value-type checks (for non-null values):
   - `markdown_string`: non-list prose content
   - `markdown_list`: list-only content
   - `markdown_string_or_list`: prose or list content
5. Missing vs explicit empty:
   - omitted declared section is an error
   - explicit `null` is not equivalent to missing

## Phase 5: Identity Invariant Validation

Validate module identity invariants:

1. Frontmatter `id` exists and is non-empty.
2. Filename stem equals frontmatter `id`.
3. Duplicate `id` within module scope is forbidden.
4. ID immutability:
   - if `optional_previous_snapshot_path` is provided, record ID for same logical record path must not change unless running explicit migration workflow.

## Phase 6: Reference Validation

For every `ref` or `array<ref>` value:

1. URI parses as `pals://<namespace>/<module>/<id>`.
2. URI segments are non-empty.
3. URI segments match declared ref contract.
4. Target record exists in ID index.
5. Target record entity matches `target_entity` contract.
6. Display label is soft-validated only (warning level):
   - mismatch between display label and target title/id is warning, not error.

## Phase 7: Module-Level Consistency Validation

1. Record must match one declared entity path template in `MODULE.md`.
2. Entity inferred from path must have a matching schema `entity`.
3. For nested hierarchies, path-parent consistency and ref-parent consistency must both hold.
4. Module namespace and URI scheme in refs must be compatible with module contract rules.

## Output Contract

Record validation emits diagnostics using:

1. `palsc/references/compiler-error-shape.md`
2. `palsc/references/diagnostic-codes.md`

If any diagnostic has severity `error`, record validation status is `fail`.
