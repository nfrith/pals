# Markdown Path-Bound Entity Identity And Literal-Leaf Contract

## Status

Proposed

## Context

- ALS v1 currently supports `source_format: "markdown"` and `source_format: "jsonl"` only.
- The path-template parser already permits the current entity's `{id}` placeholder to appear in directory segments, but markdown validation and canonical URI construction still treat the filename stem as the current entity id.
- The concrete operator ask is markdown-only: grouped sibling records such as `"{id}/video-analysis.md"` and `"{id}/launch-session.md"` should validate without forcing `"{id}"` into the leaf filename.
- Proposed SDR 052 widened the problem into a broader single-record document family with `json` and `yaml`, but ALS-111's required surface is narrower and must not silently widen source formats or dispatcher/runtime scope.
- ALS-111 also needs explicit diagnostics and shape-time collision checks so grouped literal-leaf layouts fail for the right reasons instead of collapsing into generic `ID_FILENAME_MISMATCH` or `PARSE_ENTITY_INFER` outcomes.

## Decision

- For markdown entities, the current entity id comes from the current entity's `{id}` path binding wherever it appears in the entity path.
- `identity.id_field: "id"` and `fields.id: { type: "id" }` remain required for markdown entities. The frontmatter `id` value must equal the current entity's `{id}` path binding.
- Existing markdown shapes remain valid without reinterpretation:
  - `items/{id}.md`
  - `{id}/{id}.md`
  - nested lineage paths such as `programs/{program}/experiments/{id}/{id}.md`
- A markdown leaf segment that does not contain the current entity's `{id}` must be a fully literal filename ending in `.md`. This slice does not permit other placeholders in a non-`{id}` markdown leaf.
- Repeated `{id}` occurrences remain legal and must keep the existing repeated-binding rule: every occurrence of the current entity's `{id}` in the same path must bind to the same concrete value.
- Two markdown entity templates in the same module must not be able to collapse to the same grouped literal-leaf location. Shape validation must reject sibling templates whose parent-template shape plus literal leaf would let one concrete record path match more than one entity.
- No new `{code}` placeholder alias lands in this slice. The public placeholder vocabulary remains `{id}` for the current entity and `{entity_name}` for lineage bindings.
- Grouped sibling files do not imply a synthetic parent entity. If the shared folder itself needs fields, refs, or lifecycle, it must be modeled as an explicit entity in a separate change.
- `source_format` remains `markdown | jsonl` in this slice. JSON/YAML single-record formats and non-markdown dispatcher parity stay follow-up work.

## Normative Effect

- Required: every markdown entity path contains the current entity's `{id}` somewhere in the path.
- Required: the current markdown entity id comes from the current entity's `{id}` path binding, not from filename position.
- Required: the markdown record's `id` field equals that bound current-entity id.
- Required: if a markdown leaf omits the current entity's `{id}`, the full leaf filename is literal and stable.
- Required: grouped literal-leaf markdown templates that can collide with another entity template in the same module are rejected during shape validation with a dedicated contract error.
- Allowed: grouped markdown layouts such as `"{id}/video-analysis.md"` and `"{id}/launch-session.md"`.
- Allowed: existing flat, self-named-directory, and nested-lineage markdown layouts that already validate today.
- Allowed: repeated current-entity `{id}` bindings such as `"{id}/{id}.md"` when both occurrences bind to the same concrete id.
- Rejected: treating the markdown filename stem as the canonical current-entity identity rule when `{id}` appears elsewhere in the path.
- Rejected: non-literal placeholder-bearing markdown leaves that omit the current entity's `{id}`.
- Rejected: a second public placeholder alias such as `{code}` for the same current-entity identity slot.
- Rejected: implicit parent entities created only because grouped sibling records share one folder.

## Compiler Impact

- Update markdown identity validation in `alsc/compiler/src/validate.ts` so it compares frontmatter `id` against the current entity's `{id}` path binding instead of the filename stem.
- Update markdown canonical URI construction so the current entity segment uses the bound `{id}` value captured from the path template.
- Add or rename diagnostic codes in `alsc/compiler/src/diagnostics.ts` for the new failure classes this contract needs, including path-binding mismatch and grouped literal-leaf template collisions.
- Extend `alsc/compiler/src/schema.ts` shape validation with the literal-leaf rule and shape-time collision checks for grouped markdown templates.
- Keep JSONL parsing and identity rules unchanged in this slice.

## Docs and Fixture Impact

- Update the canonical shape-language reference so markdown identity is taught as path-bound rather than filename-stem-bound.
- Add positive fixtures for grouped markdown siblings, plus no-regression fixtures for flat and self-named-directory markdown paths.
- Add negative coverage for:
  - frontmatter `id` versus path-bound `{id}` mismatch
  - grouped markdown leaf collisions between entity templates
  - non-literal markdown leaves that omit the current entity's `{id}`
- Keep dispatcher/runtime docs unchanged in this slice because the job does not widen beyond markdown and does not add new runtime surfaces.

## Alternatives Considered

- Full SDR 052 single-record document-family widening.
- Rejected for ALS-111 because it silently expands the job into `json`/`yaml` format design and adjacent runtime questions that are not required to solve the current markdown failure.
- Filename-exception patch.
- Rejected because it preserves two competing identity rules and turns one desired layout into a validator escape hatch instead of a coherent contract.
- Parent-entity composition.
- Rejected because it forces authored semantics the operator did not ask for. Grouped sibling co-location alone should not require inventing a parent record.

## Non-Goals

- Adding `json` or `yaml` as new ALS v1 record formats in this slice.
- Making non-markdown records Delamain-dispatchable in this slice.
- Shipping a generic built-in template-to-template path mover in `/migrate`.

## Follow-Up

- If ALS later wants a unified single-record document family across markdown, JSON, and YAML, record that as a new SDR or an explicit supersession of the broader Proposed SDR 052 path rather than smuggling it into ALS-111 implementation.
