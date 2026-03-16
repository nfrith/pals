# PALS Shape Language Reference

This is the complete format specification for `pals-module@1` shape files and `pals-system@1` system configuration. Use this reference when producing YAML output.

## system.yaml

Lives at `.pals/system.yaml`. Declares the system identity, root directories, and module registry.

```yaml
schema: pals-system@1
system_id: my-system                  # unique system identifier, kebab-case

roots:                                # top-level directories that hold module data
  - workspace
  - clients

modules:
  people:                             # module id, kebab-case
    root: workspace                   # which root this module lives under (must be in roots list)
    dir: people                       # directory name within the root
    version: 1                        # currently deployed shape version
    skill: .claude/skills/people/SKILL.md   # placeholder for future skill path
```

Rules:
- `system_id`: non-empty string, used in ref URIs
- `roots`: at least one, no duplicates, each must exist as a directory
- Module `root` must reference a declared root
- Module `dir` is the directory name under that root — the module's data lives at `{root}/{dir}/`
- No two modules may share the same `root`/`dir` combination
- Shape files are inferred at `.pals/modules/{module_id}/v{version}.yaml`

## Module shape YAML

Lives at `.pals/modules/{module_id}/v{version}.yaml`.

```yaml
schema: pals-module@1

dependencies:                         # other modules this one references
  - module: people                    # just the module id

entities:
  # ... entity definitions
```

Rules:
- `dependencies`: list modules whose entities are referenced by this module's ref fields. If a ref targets another module, that module must be listed here.
- `entities`: keyed by entity name (kebab-case lowercase)

## Entity definition

```yaml
entity-name:
  path: items/{id}.md                 # path template relative to module data dir

  identity:
    id_field: id                      # always "id"
    parent:                           # optional — only for nested entities
      entity: parent-entity-name      # must be another entity in this module
      ref_field: parent_ref           # field in this entity that refs the parent

  fields:
    # ... field definitions

  sections:
    # ... section definitions
```

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

### Field types

Every entity must declare an `id` field of type `id`. All fields have `required` (boolean) and `allow_null` (boolean) except `id` which is always `required: true, allow_null: false`.

#### id

```yaml
id:
  type: id
  required: true
  allow_null: false
```

Primary key. Must be a non-empty string. Must match the filename stem.

#### string

```yaml
title:
  type: string
  required: true
  allow_null: false
```

#### number

```yaml
budget:
  type: number
  required: true
  allow_null: true
```

#### date

```yaml
started_on:
  type: date
  required: true
  allow_null: false
```

Values must be `YYYY-MM-DD` format.

#### enum

```yaml
status:
  type: enum
  required: true
  allow_null: false
  allowed_values: [draft, active, completed]
```

Must include `allowed_values` — a list of at least one string.

#### ref

```yaml
owner_ref:
  type: ref
  required: true
  allow_null: true
  target:
    module: people          # target module id
    entity: person          # target entity name
```

Ref values in record frontmatter use the format: `"[display-label](pals://system_id/module/entity/ancestor/.../id)"`

The URI path encodes the full lineage: `pals://system_id/module/entity-type/entity-id` for root entities, or `pals://system_id/module/parent-type/parent-id/child-type/child-id` for nested entities.

- `target.module` can be this module or another module (if another, it must be in `dependencies`)

#### list

```yaml
tags:
  type: list
  required: true
  allow_null: true
  items:
    type: string
```

Items can be `type: string` or `type: ref` (with a `target`):

```yaml
people:
  type: list
  required: true
  allow_null: true
  items:
    type: ref
    target:
      module: people
      entity: person
```

### Section definitions

Sections define the markdown body structure of a record. They render as `## SECTION_NAME` headings in the file.

```yaml
sections:
  - name: DESCRIPTION
    required: true
    allow_null: false
    content:
      allowed_blocks: [paragraph, bullet_list, ordered_list]
      allow_subheadings: false
      allow_blockquotes: false
      allow_code_blocks: false
    guidance:
      include: what content belongs in this section
      exclude: what content does not belong in this section
```

Rules:
- `name`: rendered as `## NAME` in the markdown file (use UPPER_SNAKE_CASE)
- `required`: whether the section must be present
- `allow_null`: if true, the section can contain the literal word `null` instead of real content
- `content.allowed_blocks`: at least one of `paragraph`, `bullet_list`, `ordered_list`
- `content.allow_subheadings/allow_blockquotes/allow_code_blocks`: boolean flags for additional block types
- `guidance.include` / `guidance.exclude`: prose hints for what belongs (and what does not) in this section
- Sections must appear in the record in the same order they are declared in the shape
- No duplicate section names within an entity

## Naming conventions

- Module ids: `kebab-case` (`client-registry`, `backlog`)
- Entity names: `kebab-case` (`person`, `experiment`, `pull-request`)
- Field names: `snake_case` (`display_name`, `owner_ref`, `started_on`)
- Section names: `UPPER_SNAKE_CASE` (`PROFILE`, `SUCCESS_CRITERIA`)
- Record ids: any non-empty string, but must match filename stem

## What a record file looks like

A record is a markdown file with YAML frontmatter and headed sections:

```markdown
---
id: ITEM-001
title: Example item
status: active
owner_ref: "[jane](pals://my-system/people/person/PPL-001)"
---

# Item 001

## DESCRIPTION

This is the description content.

## NOTES

null
```

- The `# Title` heading after frontmatter is informal — the compiler does not validate it
- Each declared section appears as `## SECTION_NAME`
- Nullable sections with no content use the literal word `null`
