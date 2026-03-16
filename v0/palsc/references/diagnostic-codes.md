# Diagnostic Codes (Current Baseline)

## Scope

This registry defines stable diagnostic codes used by `palsc validate`.

## Code Format

Pattern: `PAL-<GROUP>-<NNN>`

Allowed groups:

1. `SCHEMA`
2. `RV-PARSE`
3. `RV-FM`
4. `RV-BODY`
5. `RV-ID`
6. `RV-REF`
7. `RV-MOD`

`NNN` is a zero-padded integer (`001`, `002`, ...).

## Allowed `phase` Values

Diagnostics emitted by `palsc validate` must use one of:

1. `parse`
2. `schema_frontmatter`
3. `schema_content`
4. `module_contract`
5. `record_frontmatter`
6. `record_body`
7. `identity`
8. `reference`
9. `module_consistency`

## Registry

| Code | Default Severity | Phase | Meaning |
| --- | --- | --- | --- |
| `PAL-SCHEMA-001` | error | `schema_frontmatter` | Missing required schema top-level key |
| `PAL-SCHEMA-002` | error | `schema_frontmatter` | Invalid `frontmatter_contract` field type |
| `PAL-SCHEMA-003` | error | `schema_frontmatter` | Invalid enum contract (`allowed` missing/empty/invalid) |
| `PAL-SCHEMA-004` | error | `schema_frontmatter` | Invalid ref contract shape |
| `PAL-SCHEMA-005` | error | `schema_frontmatter` | Invalid array `items` contract |
| `PAL-SCHEMA-006` | error | `schema_frontmatter` | Invalid `body_contract` values |
| `PAL-SCHEMA-007` | error | `schema_content` | Missing schema section contract key |
| `PAL-SCHEMA-008` | error | `schema_content` | Invalid section `value_type` |
| `PAL-SCHEMA-009` | error | `schema_content` | Duplicate section key in schema body |
| `PAL-SCHEMA-010` | error | `module_consistency` | Schema version mismatch against `MODULE.md` |
| `PAL-SCHEMA-011` | error | `module_contract` | Invalid `MODULE.md` top-level frontmatter key set |
| `PAL-SCHEMA-012` | error | `module_contract` | Invalid `entity_paths` contract shape, template grammar, or template-set overlap |
| `PAL-SCHEMA-013` | error | `module_contract` | Invalid `references.modules` contract shape |
| `PAL-SCHEMA-014` | error | `module_contract` | `MODULE.md` must be frontmatter-only (body not allowed) |
| `PAL-SCHEMA-015` | error | `schema_frontmatter` | Invalid `identity_contract` shape |
| `PAL-RV-PARSE-001` | error | `parse` | Frontmatter YAML parse failure |
| `PAL-RV-PARSE-002` | error | `parse` | Markdown section parse failure |
| `PAL-RV-PARSE-003` | error | `parse` | Could not infer entity from record path (zero or multiple entity-path template matches) |
| `PAL-RV-FM-001` | error | `record_frontmatter` | Missing declared frontmatter field |
| `PAL-RV-FM-002` | error | `record_frontmatter` | Unknown frontmatter field |
| `PAL-RV-FM-003` | error | `record_frontmatter` | Enum value not in allowed set |
| `PAL-RV-FM-004` | error | `record_frontmatter` | Field type mismatch |
| `PAL-RV-FM-005` | error | `record_frontmatter` | Invalid date format (expected `YYYY-MM-DD`) |
| `PAL-RV-FM-006` | error | `record_frontmatter` | Invalid ref link format |
| `PAL-RV-FM-007` | error | `record_frontmatter` | Invalid array item value |
| `PAL-RV-BODY-001` | error | `record_body` | Missing declared body section |
| `PAL-RV-BODY-002` | error | `record_body` | Unknown body section |
| `PAL-RV-BODY-003` | error | `record_body` | Explicit `null` not allowed for non-nullable section |
| `PAL-RV-BODY-004` | error | `record_body` | Section value does not match declared `value_type` |
| `PAL-RV-BODY-005` | error | `record_body` | Invalid empty marker usage |
| `PAL-RV-ID-001` | error | `identity` | Filename stem does not match frontmatter `id` |
| `PAL-RV-ID-002` | error | `identity` | Duplicate canonical identity in module scope |
| `PAL-RV-ID-003` | error | `identity` | Immutable `id` changed versus previous snapshot |
| `PAL-RV-REF-001` | error | `reference` | Ref URI is malformed |
| `PAL-RV-REF-002` | error | `reference` | Ref URI segments do not match declared contract |
| `PAL-RV-REF-003` | error | `reference` | Ref target does not resolve |
| `PAL-RV-REF-004` | error | `reference` | Resolved target entity does not match `target_entity` |
| `PAL-RV-REF-005` | warning | `reference` | Display label does not match target title/id |
| `PAL-RV-REF-006` | error | `reference` | Parent ref target URI is not a strict prefix of child canonical URI |
| `PAL-RV-MOD-001` | error | `module_consistency` | Record path does not match declared entity path template |
| `PAL-RV-MOD-002` | error | `module_consistency` | Nested path-parent and identity-contract parent consistency violation |
| `PAL-RV-MOD-003` | error | `module_consistency` | Ref namespace/scheme incompatible with module contract |

## Governance

1. Once released, code meaning is immutable.
2. New diagnostics must add new codes, never repurpose old codes.
3. Severity may change only with explicit versioned policy update.
