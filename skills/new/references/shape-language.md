# ALS Shape Language Reference

This is the complete format specification for ALS v1 shape files and system configuration. Use this reference when producing YAML output.

## system.yaml

Lives at `.als/system.yaml`. Declares the system identity and module registry.

```yaml
als_version: 1                      # active ALS language version for the whole system
system_id: my-system                  # unique system identifier used in ref URIs

modules:
  people:                             # module id, kebab-case
    path: workspace/people            # module mount path relative to the system root
    version: 1                        # currently deployed shape version
    skills:                           # live active skill ids for the active module version
      - people-module
```

Rules:
- `als_version`: required positive integer. One system validates against one ALS language version at a time.
- This compiler currently supports `als_version: 1` only.
- ALS language-version upgrades are whole-system cutovers. Long-lived mixed ALS versions inside one system are not part of the v1 contract.
- `system_id`: non-empty string, used in ref URIs
- Module ids must match `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`
- Module `path` is a normalized relative path from the system root made of one or more slash-separated slug segments
- Each `path` segment must match `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`
- Module `skills` is a required array of live active skill ids and may be empty
- Each skill id must match `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`
- Active skill ids must be globally unique across the live system
- Module paths cannot be absolute, contain empty segments, contain `.` or `..`, or contain hidden segments like `.als`
- The module's data lives at `{path}/`
- The module subtree may contain reserved non-record markdown files named `AGENTS.md` or `CLAUDE.md` at any depth
- Matching for reserved agent files is case-insensitive, including the `.md` extension
- Reserved agent files are ignored during ALS record validation and do not need entity path matches
- Reserved agent files are the only case-insensitive markdown filename exception in module discovery
- Other markdown record files must use lowercase `.md`; non-reserved files like `README.MD` are invalid
- JSONL record files must use lowercase `.jsonl`; files like `STREAM.JSONL` are invalid
- Other markdown and JSONL record files in the module subtree remain subject to normal ALS discovery and validation rules
- Validation fails cleanly if ALS cannot read a directory inside the module subtree during discovery
- The declared `path` must exist as a directory when validating
- No two modules may have identical or overlapping mount paths
- Module versions are directory bundles at `.als/modules/{module_id}/v{version}/`
- Active shape files are inferred at `.als/modules/{module_id}/v{version}/shape.yaml`
- A module declared at `version: N` must have contiguous bundle history from `v1` through `vN`
- Bundles above the active version may exist for staged future work and are ignored by default validation
- If `skills` is non-empty, the active bundle must contain `skills/{skill_id}/SKILL.md` for every listed skill id
- If `skills` is empty, the active bundle may omit `skills/` entirely
- Unlisted skill directories under the active bundle's `skills/` directory are invalid
- Extra files inside a listed skill directory are allowed
- Every bundle `vK` where `K > 1` must contain `migrations/MANIFEST.md` plus at least one additional migration artifact
- Authored ALS v1 source YAML does not include a top-level `schema` field.
- Validators reject stale authored `schema` fields so removed syntax does not linger in systems or prompts.

## Module version bundle

Lives at `.als/modules/{module_id}/v{version}/`.

```yaml
dependencies: []                      # required even when empty

delamains:
  development-pipeline:
    path: delamains/development-pipeline/delamain.yaml

entities:
  # ... entity definitions
```

With cross-module references:

```yaml
dependencies:                         # other modules this one references
  - module: people                    # just the module id

entities:
  # ... entity definitions
```

Rules:
- Every required module version bundle contains `shape.yaml`
- The live active skill interface is declared in `.als/system.yaml`, but the canonical skill bundles live under `skills/{skill_id}/SKILL.md`
- Migration assets for `vK > 1` live under `migrations/` in the target bundle `vK`
- `dependencies` is required. Use an empty list when the module has no cross-module references.
- `delamains` is optional. Omit it when the module does not use Delamain-bound fields.
- `delamains` maps Delamain names to primary definition file paths relative to the active module version bundle.
- Delamain registry paths must resolve to files inside the same active module version bundle.
- Delamain registry paths in `shape.yaml` are module-bundle-relative. Delamain-local asset paths inside `delamain.yaml` are Delamain-bundle-relative.
- If a ref targets another module, that module must be listed in `dependencies`.
- `entities`: keyed by entity name matching `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`
- Authored ALS v1 shape files do not include a top-level `schema` field.
- Validators reject stale authored `schema` fields so removed syntax does not linger in systems or prompts.

## Entity definition

Entities have three supported shapes:

1. Markdown plain entities with a shared `fields` set and an explicit `body` contract
2. Markdown variant entities with root/base `fields`, a `discriminator`, an optional shared `body`, a `section_definitions` library, and per-variant `fields` + full ordered `sections`
3. JSONL entities with path-derived identity and a closed `rows.fields` schema

### Plain entity

```yaml
entity-name:
  source_format: markdown
  path: items/{id}.md                 # path template relative to module data dir

  identity:
    id_field: id                      # always "id"
    parent:                           # optional — only for nested entities
      entity: parent-entity-name      # must be another entity in this module
      ref_field: parent_ref           # field in this entity that refs the parent

  fields:
    # ... field definitions

  body:
    title:
      source:
        kind: field
        field: title

    preamble:
      allow_null: true
      content:
        mode: freeform
        blocks:
          paragraph: {}
      guidance:
        include: framing context before the main sections
        exclude: section-specific detail

    sections:
      # ... inline section definitions
```

### Variant entity

```yaml
entity-name:
  source_format: markdown
  path: items/{id}.md

  identity:
    id_field: id

  discriminator: type

  fields:                             # root/base fields present for every variant
    id:
      type: id
      allow_null: false
    title:
      type: string
      allow_null: false
    type:
      type: enum
      allow_null: false
      allowed_values: [app, research]

  body:                               # optional shared top-level body regions
    title:
      source:
        kind: field
        field: title
    preamble:
      allow_null: true
      content:
        mode: freeform
        blocks:
          paragraph: {}

  section_definitions:                # reusable h2 section definitions keyed by section name
    DESCRIPTION:
      allow_null: false
      content:
        mode: freeform
        blocks:
          paragraph: {}
      guidance:
        include: what this item is and why it exists
        exclude: status history
    ACTIVITY_LOG:
      allow_null: false
      content:
        mode: freeform
        blocks:
          bullet_list: {}
          ordered_list: {}
      guidance:
        include: dated progress history
        exclude: evergreen requirements

  variants:
    app:
      fields:                         # variant-local fields added to the root/base set
        status:
          type: enum
          allow_null: false
          allowed_values: [draft, active, completed]
        delivery_track:
          type: enum
          allow_null: false
          allowed_values: [net-new, enhancement, hardening]
        target_release:
          type: string
          allow_null: false
      sections: [DESCRIPTION, ACTIVITY_LOG]   # authoritative full h2 section order for app records

    research:
      fields:
        status:
          type: enum
          allow_null: false
          allowed_values: [draft, findings-ready, completed]
        research_question:
          type: string
          allow_null: false
      sections: [DESCRIPTION, ACTIVITY_LOG]
```

Rules:
- Every entity declares `source_format`.
- Plain entities declare their full body contract in `body`.
- Variant entities continue to use `section_definitions` plus each variant's `sections` list for authoritative `h2` section order.
- `variants.<variant>.fields` declare frontmatter fields, not section metadata. Once the discriminator resolves, the effective frontmatter contract is the root/base `fields` plus that variant's `fields`.
- Variant entities may also declare shared `body.title` and shared `body.preamble` at the entity root.
- Variant entities may omit `body` entirely when they do not declare a shared title or shared preamble.
- Markdown entities must use `.md` paths.
- Markdown entities must not declare `rows`.
- Markdown `identity.parent` targets must also be markdown entities.

#### Variant-local frontmatter

The discriminator chooses both the body contract and the variant-local frontmatter contract.
The examples below are illustrative. They show the contract shape, not an exact mirror of any one fixture.

For `type: app`, the frontmatter contract is:

- root/base fields such as `id`, `title`, and `type`
- app fields such as variant-scoped `status`, `delivery_track`, and `target_release`

For `type: research`, the frontmatter contract is:

- root/base fields such as `id`, `title`, and `type`
- research fields such as variant-scoped `status` and `research_question`

Illustrative example records:

```yaml
---
id: ITEM-001
title: Ship backlog variants
type: app
status: active
delivery_track: enhancement
target_release: 2026-Q2
---
```

```yaml
---
id: ITEM-002
title: Evaluate backlog rollups
type: research
status: findings-ready
research_question: Should rollup buckets stay outside the compiler?
---
```

### JSONL entity

```yaml
entity-name:
  source_format: jsonl
  path: streams/{id}.jsonl

  rows:
    fields:
      observed_at:
        type: string
        allow_null: false
      metric:
        type: enum
        allow_null: false
        allowed_values: [latency_ms]
      value:
        type: number
        allow_null: false
      tags:
        type: list
        allow_null: false
        items:
          type: enum
          allowed_values: [api-gateway, baseline, canary]
```

Rules:
- JSONL entities must use `.jsonl` paths.
- JSONL entities do not declare `identity`.
- JSONL entity identity comes from matched path bindings, including `{id}`.
- JSONL entities must not declare markdown-only surfaces such as `fields`, `body`, `discriminator`, `section_definitions`, or `variants`.
- `rows.fields` is the authoritative per-line schema.
- Empty JSONL files are valid. This supports stream-like entities that may temporarily contain zero rows.
- Every JSONL line must be one JSON object.
- Every JSONL line must satisfy the same declared row schema.
- Every declared JSONL row key must be present on every line.
- `allow_null: true` allows explicit `null`; it does not allow omission.
- Undeclared JSONL row keys are rejected.
- JSONL rows support only `string`, `number`, `date`, `enum`, `list<string>`, and `list<enum>` in this pass.
- `date` remains `YYYY-MM-DD`. Timestamp values should use `type: string` in this pass.
- ALS refs can target JSONL entities, but there are no row-level refs or row-level canonical URIs.

### Path templates

Path templates use `{placeholder}` segments to map entities to filesystem paths.

- `{id}` captures this entity's id
- `{parent_entity_name}` captures an ancestor's id (use the entity name, not the field name)
- Every path must contain `{id}`
- Nested entities should include ancestor placeholders to encode lineage

Examples:
- Flat: `items/{id}.md`
- Self-named directory: `items/{id}/{id}.md`
- Nested: `programs/{program}/experiments/{id}/{id}.md`
- Deeply nested: `programs/{program}/experiments/{experiment}/runs/{id}.md`
- JSONL stream: `streams/{id}.jsonl`

### Field types

Markdown entities must declare an `id` field of type `id`. Every declared markdown field must appear in record frontmatter. `allow_null` controls whether the explicit value may be `null`; it does not allow omission.

There is no mechanism to declare optional fields.

#### id

```yaml
id:
  type: id
  allow_null: false
```

Primary key. Must be a non-empty string. Must match the filename stem.
The compiler rejects `allow_null: true` on `id`.

#### string

```yaml
title:
  type: string
  allow_null: false
```

#### number

```yaml
budget:
  type: number
  allow_null: true
```

#### date

```yaml
started_on:
  type: date
  allow_null: false
```

Values must be `YYYY-MM-DD` format.

#### enum

```yaml
status:
  type: enum
  allow_null: false
  allowed_values: [draft, active, completed]
```

Must include `allowed_values` — a list of at least one unique string.

#### delamain

```yaml
delamains:
  development-pipeline:
    path: delamains/development-pipeline/delamain.yaml

entities:
  work-item:
    fields:
      status:
        type: delamain
        allow_null: false
        delamain: development-pipeline
```

Must declare `delamain` and reference a Delamain name declared in the module bundle's `delamains` registry.

A `type: delamain` field:

- uses the referenced Delamain's declared state names as its legal persisted values
- does not also declare `allowed_values`
- remains a frontmatter field like any other field, but its current-value set comes from the Delamain bundle instead of inline enum values
- may appear at most once per effective entity schema
- for plain entities, that means at most one `type: delamain` field on the entity
- for variant entities, root/base fields may declare at most one `type: delamain` field; if root/base fields declare one, variants declare none
- for variant entities whose root/base fields declare no `type: delamain` field, each variant may declare at most one `type: delamain` field in that variant's effective schema
- invalid persisted Delamain state values are reported through the same frontmatter invalid-value diagnostic family used for plain enums

#### ref

```yaml
owner_ref:
  type: ref
  allow_null: true
  target:
    module: people          # target module id
    entity: person          # target entity name
```

Ref values in record frontmatter use the format: `"[display-label](als://system_id/module/entity/ancestor/.../id)"`

The URI path encodes the full lineage: `als://system_id/module/entity-type/entity-id` for root entities, or `als://system_id/module/parent-type/parent-id/child-type/child-id` for nested entities.

- `target.module` can be this module or another module (if another, it must be in `dependencies`)
- Refs may target markdown entities or JSONL entities. Refs always target entity identity, not row identity.

#### file_path

```yaml
context_file:
  type: file_path
  allow_null: true
  base: system_root
```

`file_path` values are plain YAML strings. They do not use markdown-link syntax.
They must be non-empty plain file paths, not URIs such as `https://...` or `file://...`.

Allowed `base` values:

- `system_root`: normalized relative path from the ALS system root directory that contains `.als/system.yaml`
- `host_absolute`: absolute file path on the validator host platform

`system_root` values:

- use `/` separators
- must not begin with `/`, `\`, or a drive prefix such as `C:`
- must not contain `\`, `.`, `..`, or empty path segments

`host_absolute` values:

- must be absolute paths on the validator host platform
- must be normalized absolute paths
- must not contain empty, `.`, or `..` path segments after the root
- must not end with a directory separator

All `file_path` targets:

- must exist at validation time
- must be accessible enough for validation to confirm they are files
- must resolve to files, not directories
- may point outside the declaring module subtree
- may point to hidden paths and `.als/...`
- do not participate in `dependencies` or ALS ref resolution

Use `ref` when the intended meaning is ALS entity identity. Use `file_path` when the intended meaning is a filesystem artifact.

#### list

```yaml
tags:
  type: list
  allow_null: true
  items:
    type: string
```

Items can be `type: string`, `type: ref` (with a `target`), `type: enum` (with `allowed_values`), or `type: file_path` (with `base`):

```yaml
people:
  type: list
  allow_null: true
  items:
    type: ref
    target:
      module: people
      entity: person
```

```yaml
sessions:
  type: list
  allow_null: true
  items:
    type: file_path
    base: system_root
```

```yaml
folders:
  type: list
  allow_null: false
  items:
    type: enum
    allowed_values: [lotf, aitw, claude-cowork]
```

- `list<enum>` validates each item as a string enum member.
- `list<enum>` rejects duplicate members.
- `list<string>`, `list<ref>`, and `list<file_path>` do not enforce uniqueness.
- Empty lists are allowed. `allow_null` only controls whether the field value may be `null`.

### Delamain bundles

Delamain bundles live under `.als/modules/{module_id}/v{version}/delamains/{name}/`.

The primary definition file is a YAML file, typically `delamain.yaml`, referenced from the module bundle's `delamains` registry.

Example:

```yaml
phases: [intake, planning, implementation, closed]

states:
  draft:
    initial: true
    phase: intake
    actor: operator
  planning:
    phase: planning
    actor: agent
    resumable: true
    session-field: planner_session
    path: agents/planning.md
  in-dev:
    phase: implementation
    actor: agent
    resumable: true
    session-field: dev_session
    path: agents/in-dev.md
    sub-agent: sub-agents/developer.md
  completed:
    phase: closed
    terminal: true

transitions:
  - class: advance
    from: draft
    to: planning
  - class: advance
    from: planning
    to: in-dev
  - class: exit
    from: in-dev
    to: completed
```

Rules:

- Delamain primary definition files declare ordered `phases`, authoritative `states`, and explicit `transitions`.
- Each Delamain primary definition file has exactly one `initial: true` state.
- Every state declares `phase`.
- Every declared phase must contain at least one state.
- The initial state must be in the first declared phase.
- Terminal states must be in the last declared phase.
- Non-terminal states declare `actor: operator | agent`.
- Terminal states do not declare `actor`.
- Transitions declare `class: advance | rework | exit`, `from`, and `to`.
- `advance` and `rework` use a single-state `from`.
- `exit` uses a single-state `from` or a non-empty list-valued `from`.
- Self-loop transitions are rejected.
- Every state must be reachable from the initial state.
- Terminal states must not have outgoing transitions.
- Every non-terminal state must have at least one outgoing transition.
- Every non-terminal state must have a path to at least one terminal state.
- Delamain-local asset paths such as state `path` and `sub-agent` resolve relative to the directory containing the Delamain primary definition file, not relative to the module bundle root.
- Resolved Delamain-local asset paths must remain inside the same active module version bundle.
- `actor: agent` states declare exactly one `path` plus explicit boolean `resumable`.
- If `resumable: true`, the state declares exactly one `session-field`.
- If `resumable: false`, the state does not declare `session-field`.
- `session-field` names become implicit nullable string frontmatter fields on entities bound to that Delamain.
- A Delamain-declared `session-field` name must not collide with any explicit entity field name or any other implicit Delamain session field name materialized on the same effective entity schema.
- `sub-agent` is optional and only valid on `actor: agent` states.

### JSONL row field types

JSONL `rows.fields` reuse a strict subset of the field types above:

- allowed: `string`, `number`, `date`, `enum`, `list<string>`, `list<enum>`
- rejected in JSONL rows: `id`, `ref`, `file_path`, nested objects, nested lists, and heterogeneous unions
- `allow_null` works the same way as markdown frontmatter fields, but the row key must still be present on every line
- JSONL `list<enum>` rejects duplicate members just like markdown frontmatter `list<enum>`

### Body regions

`body` is the explicit top-level body contract for a record. It may declare:

- `title`: the record `h1`
- `preamble`: top-level content between the `h1` and the first declared `h2`, or before the first `h2` when no title is declared
- `sections`: the ordered `h2` regions for plain entities

Every authored top-level body region must be declared. There are no invisible body zones.
For plain entities, `body.sections` must be a non-empty ordered list.

#### Title region

Field-bound title:

```yaml
body:
  title:
    source:
      kind: field
      field: title
```

Authored title:

```yaml
body:
  title:
    source:
      kind: authored
```

Templated title:

```yaml
body:
  title:
    source:
      kind: template
      parts:
        - kind: field
          field: id
        - kind: literal
          value: " "
        - kind: field
          field: title
```

Rules:
- `body.title` is optional.
- If `body.title` is declared, the record must contain exactly one `h1`.
- There is no implicit `title == id` rule.
- `source.kind` must be one of `field`, `authored`, or `template`.
- `field` sources must reference a declared field of type `id` or `string` with `allow_null: false`.
- `authored` means the `h1` text is authored directly in the record body and is not matched to a field.
- `template.parts` must be a non-empty ordered list.
- Template parts must be either:
  - `{ kind: field, field: <field_name> }`
  - `{ kind: literal, value: <string> }`
- Field parts use the same field restrictions as `source.kind: field`.
- The rendered field or template value must match the authored `h1` text exactly.

#### Region definitions

`body.preamble`, inline `body.sections` entries, `section_definitions` values, and `outline.preamble` all use the same region-definition shape.

```yaml
preamble:
  allow_null: false
  content:
    mode: freeform
    blocks:
      paragraph: {}
  guidance:
    include: what belongs here
    exclude: what does not belong here
```

```yaml
- name: DESCRIPTION
  allow_null: false
  content:
    mode: freeform
    blocks:
      paragraph: {}
  guidance:
    include: what belongs here
    exclude: what does not belong here
```

Rules:
- `allow_null`: if true, the region may contain the literal word `null` instead of authored Markdown content.
- `content`: required content contract.
- `guidance`: optional authoring hints.
- If `guidance` is present, `include` and `exclude` are optional non-empty strings.
- Inline `body.sections` entries must declare `name`, rendered as `## NAME` in the markdown file.
- `section_definitions` keys are section names for variant entities and render as `## SECTION_NAME`.
- Every declared section must appear in the record body.
- Sections must appear in the same order they are declared by the shape.
- No duplicate section names within an entity.

#### Content contracts

Every non-title body region declares a `content` contract with exactly one mode:

- `mode: freeform`
- `mode: outline`

##### Freeform content

```yaml
content:
  mode: freeform
  blocks:
    paragraph:
      min_count: 1
    bullet_list:
      max_items: 8
    table:
      syntax: gfm
    heading:
      min_depth: 3
      max_depth: 4
    blockquote: {}
    code:
      require_language: true
```

Rules:
- `blocks` must declare at least one block type.
- Supported block types in the current v1 body contract are:
  - `paragraph`
  - `bullet_list`
  - `ordered_list`
  - `table`
  - `heading`
  - `blockquote`
  - `code`
- `{}` means the block type is allowed with no extra constraints.
- Supported block options in the current v1 body contract are:
  - `paragraph.min_count` / `paragraph.max_count`
  - `blockquote.min_count` / `blockquote.max_count`
  - `bullet_list.min_items` / `bullet_list.max_items`
  - `ordered_list.min_items` / `ordered_list.max_items`
  - `table.syntax`
  - `heading.min_depth` / `heading.max_depth`
  - `code.require_language`
- Phrasing-level validation is only partially enforced by the compiler in current v1.
- The compiler intentionally rejects raw HTML and reference-style syntax, but it does not exhaustively validate every other inline node.
- Authored records in current v1 currently use this inline markdown subset:
  - plain text
  - `strong`
  - `emphasis`
  - `inlineCode`
  - inline links
  - inline images
  - hard line breaks
- Reference-style links and reference-style images are not supported in current v1.
- Markdown `definition` nodes are not supported in current v1.
- Raw HTML is not allowed anywhere in ALS v1 record bodies, including inside paragraphs, headings, and other phrasing content.
- Thematic breaks such as `---`, `***`, and `___` are not supported in current v1.
- `table.syntax` is required and must currently be `gfm`.
- ALS v1 table support currently means GitHub Flavored Markdown pipe tables.
- Current GFM table limits are part of the ALS v1 contract:
  - one header row
  - one delimiter row
  - zero or more body rows
  - inline markdown only inside cells
  - no multiline cell blocks
  - no headerless tables
  - no row spans or column spans
- HTML tables and other markdown table dialects are not part of the current v1 body contract.
- In top-level `body.preamble` and top-level `body.sections[*]` regions, structural heading depth is `2`: `h1` is reserved for the declared title and `h2` is reserved for declared sections.
- Because of that structural depth, freeform `heading` content in those top-level regions can only match `h3` or deeper.

##### Outline content

```yaml
content:
  mode: outline
  preamble:
    allow_null: false
    content:
      mode: freeform
      blocks:
        paragraph:
          min_count: 1
  nodes:
    - heading:
        depth: 3
        text: Detection
      content:
        mode: freeform
        blocks:
          bullet_list: {}
    - heading:
        depth: 3
        text: Recovery Lead Notes
      content:
        mode: freeform
        blocks:
          blockquote: {}
```

Rules:
- `outline.preamble` is optional.
- `outline.preamble` uses the same exact region-definition shape as `body.preamble`.
- `nodes` must be a non-empty ordered list.
- Each node must declare:
  - `heading.depth`
  - `heading.text`
  - `content`
- `heading.depth` is explicit and exact.
- In current v1, outline nodes are ordered, required, and exact.
- In current v1, outline does not define optional nodes, repeated nodes, or other cardinality syntax.
- `node.content` currently uses `mode: freeform`.
- If a node's freeform content allows headings, those headings must be deeper than that node's declared `heading.depth`.
- Use `outline` when the heading tree itself is part of the schema contract.
- Use `freeform` when headings are allowed but their exact labels and order are not declared by the schema.

### Variant section definitions

Variant entities define reusable `h2` section contracts in `section_definitions` and then reference them by name from each variant.

```yaml
section_definitions:
  DESCRIPTION:
    allow_null: false
    content:
      mode: freeform
      blocks:
        paragraph: {}
    guidance:
      include: what this item is and why it exists
      exclude: historical updates

variants:
  app:
    fields:
      status:
        type: enum
        allow_null: false
        allowed_values: [draft, active, completed]
    sections: [DESCRIPTION, ACTIVITY_LOG]
```

Rules:
- `discriminator` must point to a root/base field that is `type: enum` and `allow_null: false`.
- Variant keys form a bijection with the discriminator enum values: every enum value needs a variant, and extra variant keys are invalid.
- Variant-local field names cannot collide with root/base field names.
- When the discriminator resolves successfully, only the selected variant's frontmatter fields are added to the root/base field contract for that record.
- Every section name referenced by a variant must exist in `section_definitions`.
- A variant's `sections` list is the authoritative full `h2` section order for records of that variant.
- Shared `body.title` and shared `body.preamble`, when declared, apply to every variant of the entity.
- If the discriminator is missing, non-string, or invalid, the compiler emits `PAL-RV-FM-008`, validates only root/base fields, emits `PAL-RV-BODY-004` for the body, and does not guess variant-specific fields or body sections.

## Naming rules and conventions

- Module ids, entity names, and skill ids are compiler-enforced single-segment slugs matching `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`
- Module mount paths are slash-separated slug segments using that same segment regex
- Field names are compiler-enforced and must match `^[a-z][a-z0-9_]*$`
- `system_id` can be any non-empty string; `kebab-case` is recommended but not enforced
- Section names can be any non-empty string; `UPPER_SNAKE_CASE` is recommended
- Record ids: any non-empty string, but must match filename stem
- Authoring workflows should default skill ids to `<module-id>-<base-skill-name>`
- When the base phrase already repeats the module name, normalize it to one leading module prefix rather than doubling it

## What a record file looks like

A record is a markdown file with YAML frontmatter, a validated body title when declared, optional declared preamble content, and headed sections:

```markdown
---
id: ITEM-001
title: Example item
type: app
status: active
owner_ref: "[jane](als://my-system/people/person/PPL-001)"
---

# Example item

Short framing paragraph before the declared sections.

## DESCRIPTION

This is the description content.

## ACTIVITY_LOG

- 2026-03-17: Created the example record.
```

- If `body.title` is declared, the `# Title` heading after frontmatter is validated according to `title.source`
- Each declared frontmatter field must appear explicitly, using YAML `null` when `allow_null: true` and no value is available
- If `body.preamble` is declared, authored content before the first declared `##` belongs to that preamble region
- Each declared section appears as `## SECTION_NAME` in the order declared by the shape
- Nullable body regions with no content use the literal word `null`
- Empty string is not a valid value for `type: string` fields
