# Entity Source Formats And JSONL Language

## Status

Accepted

## Context

- ALS v1 currently treats discovered entities as markdown records with YAML frontmatter plus a markdown body.
- The current shape language and validator assume markdown entity paths and markdown parsing as the only record model.
- Real systems may need first-class entities whose native authored form is not markdown, such as homogeneous JSONL data streams.
- Modeling those files only as `file_path` artifacts would lose ALS entity identity, ref semantics, and schema validation.
- Bridging JSONL into the markdown model through ad hoc headers or markdown wrappers would mix two languages instead of giving each one its own strict contract.
- The first pass should prefer the strictest teachable rules over flexible heterogeneous data-file behavior.

## Decision

- Every entity declares `source_format`.
- Allowed `source_format` values in this pass are `markdown` and `jsonl`.
- `source_format: markdown` keeps the current ALS markdown entity model.
- Markdown entities continue to use declared `fields`, plain or variant body contracts, YAML frontmatter, and markdown body validation.
- `source_format: jsonl` introduces a separate JSONL entity model.
- Markdown entity paths must end in `.md`.
- JSONL entity paths must end in `.jsonl`.
- JSONL entities do not use markdown frontmatter.
- JSONL entities do not use markdown body regions.
- JSONL entity identity and lineage are derived exclusively from matched path-template bindings.
- JSONL entities do not declare `identity`.
- This pass does not add entity-local metadata headers for JSONL entities.
- JSONL entities declare `rows.fields` as the authoritative per-line schema.
- JSONL row field shapes reuse ALS primitive field semantics for `string`, `number`, `date`, `enum`, `list<string>`, and `list<enum>`.
- JSONL row schemas do not support `id`, `ref`, `file_path`, nested objects, nested lists, or heterogeneous unions in this pass.
- JSONL entities must not declare markdown-only surfaces such as `fields`, `body`, `discriminator`, `section_definitions`, or `variants`.
- JSONL row nullability uses the existing `allow_null` mechanism. A nullable row field still must be present on every line and may use explicit `null`.
- `date` remains `YYYY-MM-DD` only in JSONL rows. Timestamp-bearing values remain `string` in this pass.
- Every JSONL line must be exactly one JSON object that validates against the same declared row schema.
- Empty JSONL entity files are valid in this pass, including stream-like entities that currently contain zero rows.
- JSONL row schemas are closed-world in this pass: every declared key is required and undeclared keys are rejected.
- ALS refs continue to target entities, not row numbers or byte offsets.
- Markdown entities may reference JSONL entities through the normal ALS `ref` contract because refs target canonical ALS identity, not storage representation.
- Markdown `identity.parent` remains a markdown-only lineage construct in this pass and must not target a JSONL entity.
- This pass does not add bridge syntax between markdown and JSONL beyond normal entity refs.

## Normative Effect

- Required: every entity declares `source_format`.
- Required: markdown entities use `.md` paths.
- Required: JSONL entities use `.jsonl` paths.
- Required: JSONL entity identity comes from path bindings, including the `{id}` binding.
- Required: JSONL entities must not declare `identity`.
- Required: JSONL entities declare one authoritative row schema at `rows.fields`.
- Required: JSONL entities must not declare markdown-only surfaces such as `fields`, `body`, `discriminator`, `section_definitions`, or `variants`.
- Required: every JSONL line is one JSON object.
- Required: every JSONL line satisfies the same declared row schema.
- Required: every declared JSONL row key is present on every line.
- Required: `allow_null` permits explicit `null`; it does not permit key omission.
- Required: undeclared JSONL row keys are rejected.
- Required: markdown `identity.parent` targets must be markdown entities.
- Allowed: modules that contain both markdown and JSONL entities.
- Allowed: markdown refs that target JSONL entities.
- Allowed: timestamp strings modeled as `type: string` in JSONL rows.
- Allowed: JSONL entities whose rows use only the supported scalar and list primitives from this decision.
- Allowed: empty JSONL entity files, including stream-like entities with zero rows.
- Rejected: heterogeneous JSONL files where different lines use fundamentally different schemas.
- Rejected: row-level refs, row-level file paths, row-level entity identity, or row-addressable ALS refs.
- Rejected: JSONL entity-local metadata headers in this pass.
- Rejected: treating JSONL as markdown body content or wrapping JSONL entities in markdown just to fit the current record model.
- Rejected: implicit `markdown` as the only visibly modeled entity format once multi-format entities exist.

## Compiler Impact

- Extend shape parsing so every entity declares `source_format`.
- Extend shape validation to enforce `.md` or `.jsonl` path suffixes based on `source_format`.
- Split entity loading by `source_format` instead of assuming every discovered record is markdown.
- Preserve the current markdown parse and validation flow for `source_format: markdown`.
- Add a JSONL parse and validation flow that reads the file as text.
- Add a JSONL parse and validation flow that derives entity identity from path bindings.
- Add a JSONL parse and validation flow that parses each line as one JSON object.
- Add a JSONL parse and validation flow that validates every line against one closed row schema.
- Keep valid JSONL rows available for row-schema validation even when other lines in the same file fail JSON parsing.
- Add diagnostics for source-format/path mismatch, invalid JSONL lines, non-object JSONL lines, missing required row keys, and undeclared row keys.
- Keep canonical ref generation and unresolved-ref checking entity-scoped across both formats.
- Do not add row indexing, row refs, or per-row canonical URIs in this pass.

## Docs and Fixture Impact

- Update the canonical shape-language reference to document `source_format`, markdown-vs-JSONL entity shapes, JSONL row-schema syntax, and JSONL identity-from-path behavior.
- Add a design-reference fixture with one markdown entity.
- Add a design-reference fixture with one JSONL entity.
- Add a design-reference fixture with one markdown record that references the JSONL entity by normal ALS ref.
- Add one negative design-reference artifact showing a heterogeneous JSONL file outside the validated module subtree.
- Add positive tests for markdown entities and JSONL entities coexisting in one module, JSONL path-bound identity, empty JSONL entities, and markdown refs to JSONL entities.
- Add negative tests for missing `source_format`, `.md`/`.jsonl` suffix mismatches, malformed JSONL lines, non-object JSONL lines, missing required keys, undeclared keys, and heterogeneous row shapes.

## Alternatives Considered

- Model JSONL only as `file_path`.
- Rejected because `file_path` is a filesystem-artifact contract, not an ALS entity-identity contract.
- Add markdown wrappers or metadata headers around JSONL entities.
- Rejected because that bridges JSONL back into the markdown model instead of giving JSONL its own strict language.
- Allow heterogeneous JSONL rows with per-line schema variation.
- Rejected because the first pass should enforce one teachable schema per entity file.
- Keep `markdown` implicit and require explicit format only for new JSONL entities.
- Rejected because once ALS supports multiple entity formats, the format should be explicit at the entity contract surface.
