# Path-Bound Document Entity Identity And Source-Format Contract

## Status

Proposed

## Context

- ALS v1 currently supports `source_format: "markdown"` and `source_format: "jsonl"` only.
- Markdown identity is still taught and validated as a filename-stem rule, even though the path-template parser already supports `{id}` outside the filename segment.
- The operator's `youtube-launch-optimizer` layout needs three sibling entities co-located under the same per-project folder with fixed filenames and mixed formats:
  - `"{id}/video-analysis.json"`
  - `"{id}/launch-session.yaml"`
  - `"{id}/thumbnail-design.md"`
- JSONL already proves that ALS can have a non-markdown identity model, but JSONL is a row-stream contract, not a single-record document contract.
- ALS needs a widening that preserves exact path semantics, keeps JSONL distinct, and avoids special-case folder-id exceptions or synthetic parent entities used only to satisfy path grammar.

## Decision

- Expand `source_format` vocabulary to `markdown`, `json`, `yaml`, and `jsonl`.
- `markdown`, `json`, and `yaml` are single-record document formats. They share `path`, `identity`, and `fields`.
- `jsonl` remains the row-stream format with `rows.fields` and no document `identity` block.
- For every single-record document entity, the current entity id comes from the value bound to `{id}` in the entity path template, regardless of whether `{id}` appears in the filename segment or a parent-folder segment.
- `identity.id_field: "id"` remains required for single-record document entities. The record value at that field must equal the current entity's `{id}` binding.
- Fixed filenames are valid for single-record document entities as long as the path still contains `{id}` somewhere and the suffix matches the `source_format`.
- No new computed path-expression language lands in this pass. Grouped layouts are expressed with the existing `{id}` binding plus literal sibling filenames.
- Grouped sibling files do not implicitly create a parent entity. If the folder itself needs fields, refs, or lifecycle, it must be modeled as an explicit entity under a separate authored contract.
- `markdown` keeps markdown-only surfaces: `body`, `section_definitions`, and `variants`.
- `json` and `yaml` represent exactly one top-level object document per file in this pass. They do not declare `body`, `section_definitions`, `variants`, or `rows`.
- `identity.parent` widens from markdown-only to single-record document entities. The target must use `source_format: markdown`, `json`, or `yaml`.
- Current flat document shapes remain valid without reinterpretation. `items/{id}.md` keeps the same authored surface and now participates in the generalized path-bound identity rule as the special case where `{id}` is the filename stem.
- This change is additive within the current `als_version` as long as the old authored surfaces keep their current meaning and the new formats and grouped fixed-name layouts remain opt-in.

## Normative Effect

- Required: `markdown` entity paths end in `.md`.
- Required: `json` entity paths end in `.json`.
- Required: `yaml` entity paths end in `.yaml`.
- Required: `jsonl` entity paths end in `.jsonl`.
- Required: every single-record document entity path contains `{id}`.
- Required: the current entity id for `markdown`, `json`, and `yaml` comes from the `{id}` path binding, not from filename position.
- Required: every single-record document entity declares `identity.id_field: "id"` and a corresponding `fields.id` with `type: "id"`.
- Required: the record value at `identity.id_field` equals the current entity's `{id}` path binding.
- Required: `json` and `yaml` files contain exactly one top-level object document.
- Required: `json` and `yaml` entities use declared `fields` and must not declare `body`, `section_definitions`, `variants`, or `rows`.
- Required: `identity.parent` targets, when used, point only at single-record document entities.
- Allowed: grouped layouts that place `{id}` in a parent-folder segment and use literal sibling filenames under that folder.
- Allowed: modules that mix `markdown`, `json`, `yaml`, and `jsonl` entities.
- Allowed: flat paths such as `items/{id}.md` and nested paths such as `programs/{program}/experiments/{id}/{id}.md` without authored-shape changes.
- Allowed: document lineage across `markdown`, `json`, and `yaml` entities through `identity.parent`.
- Rejected: treating filename position as the canonical current-entity identity rule for single-record documents.
- Rejected: special-case exceptions that allow fixed filenames without a `{id}` binding somewhere in the path.
- Rejected: generic computed path expressions or placeholder namespaces beyond the current `{name}` template grammar in this pass.
- Rejected: implicit synthetic parent entities created only because sibling documents share a folder.
- Rejected: treating `json` as a synonym for `jsonl`.
- Rejected: `.yml` as an alternate YAML suffix in this pass.

## Compiler Impact

- Extend shape validation to admit `source_format: "json"` and `source_format: "yaml"` as single-record document formats.
- Replace filename-stem-only document-id validation with path-binding validation that compares the current entity's `{id}` binding to the declared `id` field across `markdown`, `json`, and `yaml`.
- Extend record discovery and parsing to load `.json` and `.yaml` documents and validate them against the same field semantics used for single-record documents.
- Extend canonical URI construction and duplicate-identity detection so `markdown`, `json`, and `yaml` use path-bound current identity consistently.
- Keep JSONL parsing, row-schema validation, and row-stream identity rules distinct from the single-record document family.
- Add diagnostics for unsupported suffixes, missing `{id}` bindings, record-id-versus-path mismatches, non-object JSON/YAML documents, and document-only versus JSONL-only surface misuse.

## Docs and Fixture Impact

- Update the canonical shape-language reference to describe the widened `source_format` vocabulary, the single-record document family, and path-bound current identity.
- Update `vocabulary.md` `### Module Data Record` so records are no longer described as markdown-only.
- Add a positive fixture modeled on the operator's `youtube-launch-optimizer` layout with grouped sibling files and mixed `.json`, `.yaml`, and `.md` records.
- Add a no-regression fixture proving existing flat markdown entities still validate unchanged.
- Add negative coverage for missing `{id}` in a grouped fixed-name document path, `{id}`/record `id` mismatch, unsupported `.yml`, non-object JSON/YAML documents, and duplicate canonical identities across grouped folders.
- If the operator later wants non-markdown Delamain-bound entities, that must be recorded as a separate follow-up widening for dispatcher/runtime docs and fixtures rather than implied by this SDR.

## Alternatives Considered

- Parent-owned composition contract.
- Rejected because it forces a first-class parent record into layouts that only need co-located sibling documents, expanding the language more than the authored use case requires.
- Filename-exception patch.
- Rejected because it preserves conflicting identity rules and hardcodes one filesystem pattern instead of settling a general document-identity contract.
- Record-field-only identity.
- Rejected because canonical identity, duplicate detection, and discovery should remain path-bound across document formats rather than depending on parse-order semantics.

## Non-Goals

- Non-markdown Delamain binding in this pass.
- Generic computed path expressions beyond the existing `{name}` template grammar.
- JSON arrays, scalar-root JSON documents, or multi-document YAML streams as entity records.

## Follow-Up

- If operators need `json` or `yaml` entities to carry Delamain status and become dispatchable work items, widen the work to `construct:dispatcher` in a follow-up and carry `source_format` plus document-reader metadata through the runtime manifest and watcher contracts.
