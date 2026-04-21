# ALS Shape Language

ALS authored source is TypeScript.

The canonical entrypoints are:

- `.als/system.ts`
- `.als/modules/{module_id}/v{version}/module.ts`
- `.als/modules/{module_id}/v{version}/delamains/{name}/delamain.ts` for authored Delamain definitions referenced from the module bundle

Authored source must stay synchronous, deterministic, and declarative. Export plain ALS data. Do not use async work, I/O, env branching, time or random access, getters, setters, or functions inside exported ALS definitions.

Use `as const` on authored definitions so literal ids, enum values, and path fragments stay precise through the helper surface.

## Authoring Helpers

Use the typed helper surface from `.als/authoring.ts`:

```ts
export { defineSystem, defineModule, defineDelamain } from "../path/to/compiler/src/authoring/index.ts";
```

The helpers are identity functions. Their job is to give TypeScript a stable typed authoring surface.

## system.ts

`system.ts` declares the system identity plus the mounted module registry.

```ts
import { defineSystem } from "./authoring.ts";

export const system = defineSystem({
  als_version: 1,
  system_id: "reference-system",
  modules: {
    backlog: {
      path: "workspace/backlog",
      version: 1,
      description: "Track work items with status, ownership, and delivery context.",
      skills: ["backlog-module"],
    },
    people: {
      path: "workspace/people",
      version: 1,
      description: "Manage people records used across the system.",
      skills: ["people-module"],
    },
  },
} as const);

export default system;
```

Rules:

- `als_version` is the active ALS language version declared by `.als/system.ts`.
- `modules.{module_id}.path` is the mounted record root for that module.
- `modules.{module_id}.version` points at `.als/modules/{module_id}/v{version}`.
- `modules.{module_id}.description` is a required one-line summary for scanners and operators.
- `modules.{module_id}.skills` lists the active operator-facing skill ids for that mounted version.
- Active skill ids must stay globally unique across the system.
- Module mount paths must stay normalized, relative, and non-overlapping.

## module.ts

`module.ts` defines the authored module contract that record validation uses.

```ts
import { defineModule } from "../../../authoring.ts";

export const module = defineModule({
  dependencies: [{ module: "people" }],
  delamains: {
    "development-pipeline": {
      path: "delamains/development-pipeline/delamain.ts",
    },
  },
  entities: {
    item: {
      source_format: "markdown",
      path: "items/{id}.md",
      identity: {
        id_field: "id",
      },
      fields: {
        id: { type: "id", allow_null: false },
        title: { type: "string", allow_null: false },
        owner: {
          type: "ref",
          allow_null: false,
          target: { module: "people", entity: "person" },
        },
      },
      body: {
        title: {
          source: {
            kind: "field",
            field: "title",
          },
        },
        sections: [
          {
            name: "DESCRIPTION",
            allow_null: false,
            content: {
              mode: "freeform",
              blocks: {
                paragraph: {},
                bullet_list: {},
              },
            },
          },
        ],
      },
    },
  },
} as const);

export default module;
```

Rules:

- Every required module version bundle contains `module.ts`.
- `dependencies` names other modules whose entities may be referenced from this module.
- `delamains.{name}.path` is module-bundle-relative and points at an authored `delamain.ts`.
- `entities` defines the valid authored record contract for the mounted module path.

## Entity Source Formats

ALS supports two record source formats:

- `markdown`
- `jsonl`

### markdown entities

Markdown entities declare:

- `path`
- `identity`
- `fields`
- `body` for plain entities, or `body` plus `section_definitions` and `variants` for variant entities

Constraints:

- `path` must contain `{id}` and end in `.md`.
- `fields.id` must exist and must be `{ type: "id", allow_null: false }`.
- `identity.parent` may only target another markdown entity in the same module definition.

### jsonl entities

JSONL entities declare:

- `path`
- `rows`

Constraints:

- `path` must contain `{id}` and end in `.jsonl`.
- JSONL entities do not declare `identity`, `fields`, `body`, `discriminator`, `section_definitions`, or `variants`.

## Field Types

Supported field types:

- `id`
- `string`
- `number`
- `date`
- `enum`
- `delamain`
- `ref`
- `file_path`
- `list`

`allow_null` remains part of the authored contract for every field type except `id`, which is always non-null.

### enum

```ts
status: {
  type: "enum",
  allow_null: false,
  allowed_values: ["draft", "active", "done"],
}
```

Allowed values must be non-empty and unique.

### ref

```ts
owner: {
  type: "ref",
  allow_null: false,
  target: {
    module: "people",
    entity: "person",
  },
}
```

Cross-module refs require a declared dependency on the target module.

### file_path

```ts
context_file: {
  type: "file_path",
  allow_null: true,
  base: "system_root",
}
```

Supported bases:

- `system_root`: normalized relative path from the ALS system root directory that contains `.als/system.ts`
- `host_absolute`: absolute host path

### list

```ts
tags: {
  type: "list",
  allow_null: true,
  items: {
    type: "enum",
    allowed_values: ["ops", "infra", "docs"],
  },
}
```

```ts
people: {
  type: "list",
  allow_null: true,
  items: {
    type: "ref",
    target: { module: "people", entity: "person" },
  },
}
```

```ts
sessions: {
  type: "list",
  allow_null: true,
  items: {
    type: "file_path",
    base: "system_root",
  },
}
```

Supported list item types for markdown frontmatter:

- `string`
- `enum`
- `ref`
- `file_path`

Supported list item types for JSONL row schemas:

- `string`
- `enum`

## Body Contracts

ALS body contracts remain declarative.

### title sources

Supported title sources:

- field source
- authored title (`kind: "authored"`)
- template source with `field` and `literal` parts

Example:

```ts
title: {
  source: {
    kind: "template",
    parts: [
      { kind: "field", field: "id" },
      { kind: "literal", value: ": " },
      { kind: "field", field: "title" },
    ],
  },
}
```

Title functions are not part of the contract in this pass.

### preamble and guidance

Body regions (preamble, sections, section_definitions values) support `guidance` with `include` and `exclude` strings. These tell agents what content belongs in each region:

```ts
{
  name: "DESCRIPTION",
  allow_null: false,
  content: {
    mode: "freeform",
    blocks: {
      paragraph: {},
      bullet_list: {},
    },
  },
  guidance: {
    include: "what this item is and why it exists",
    exclude: "status history, implementation details",
  },
}
```

`body.preamble` declares content between the `h1` title and the first declared `## section`:

```ts
body: {
  title: {
    source: { kind: "field", field: "title" },
  },
  preamble: {
    allow_null: true,
    content: {
      mode: "freeform",
      blocks: { paragraph: {} },
    },
  },
  sections: [/* ... */],
}
```

### content modes

Supported content modes:

- `freeform`
- `outline`

Freeform block types:

- `paragraph`
- `bullet_list`
- `ordered_list`
- `table`
- `heading`
- `blockquote`
- `code`

Outline content combines:

- optional `preamble`
- ordered `nodes`
- per-node freeform content

## Variant Entities

Variant markdown entities use:

- `discriminator`
- optional shared `body`
- `section_definitions`
- `variants`

Example:

```ts
item: {
  source_format: "markdown",
  path: "items/{id}.md",
  identity: { id_field: "id" },
  discriminator: "type",
  fields: {
    id: { type: "id", allow_null: false },
    title: { type: "string", allow_null: false },
    type: {
      type: "enum",
      allow_null: false,
      allowed_values: ["app", "research"],
    },
  },
  body: {
    title: {
      source: { kind: "field", field: "title" },
    },
    preamble: {
      allow_null: true,
      content: { mode: "freeform", blocks: { paragraph: {} } },
    },
  },
  section_definitions: {
    DESCRIPTION: {
      allow_null: false,
      content: { mode: "freeform", blocks: { paragraph: {}, bullet_list: {} } },
      guidance: {
        include: "what this item is and why it exists",
        exclude: "status history",
      },
    },
    ACTIVITY_LOG: {
      allow_null: false,
      content: { mode: "freeform", blocks: { bullet_list: {}, ordered_list: {} } },
      guidance: {
        include: "dated progress history",
        exclude: "evergreen requirements",
      },
    },
  },
  variants: {
    app: {
      fields: {
        status: {
          type: "enum",
          allow_null: false,
          allowed_values: ["draft", "active", "completed"],
        },
        delivery_track: {
          type: "enum",
          allow_null: false,
          allowed_values: ["net-new", "enhancement", "hardening"],
        },
      },
      sections: ["DESCRIPTION", "ACTIVITY_LOG"],
    },
    research: {
      fields: {
        status: {
          type: "enum",
          allow_null: false,
          allowed_values: ["draft", "findings-ready", "completed"],
        },
        research_question: { type: "string", allow_null: false },
      },
      sections: ["DESCRIPTION", "ACTIVITY_LOG"],
    },
  },
}
```

The discriminator chooses both the body contract (which sections appear) and the variant-local frontmatter. For `type: app`, the effective frontmatter is root fields (`id`, `title`, `type`) plus app fields (`status`, `delivery_track`). For `type: research`, it is root fields plus research fields (`status`, `research_question`).

Rules:

- The discriminator field must exist, be type `enum`, and be non-null.
- Variant keys must exactly match the discriminator enum values.
- Variant-local fields must not collide with root fields.
- Variant sections must reference declared `section_definitions`.
- Variant entities may omit `body` entirely when no shared title or preamble is needed.
- Markdown entities must not declare `rows`.

## Delamain Authoring

Authored Delamain definitions live in `delamain.ts` and are referenced from the module registry.

```ts
import { defineDelamain } from "../../../../../authoring.ts";

export const delamain = defineDelamain({
  phases: ["intake", "implementation", "closed"],
  states: {
    draft: {
      initial: true,
      phase: "intake",
      actor: "operator",
    },
    "in-dev": {
      phase: "implementation",
      actor: "agent",
      resumable: true,
      "session-field": "dev_session",
      path: "agents/in-dev.md",
    },
    completed: {
      phase: "closed",
      terminal: true,
    },
  },
  transitions: [
    { class: "advance", from: "draft", to: "in-dev" },
    { class: "exit", from: "in-dev", to: "completed" },
  ],
} as const);

export default delamain;
```

Rules:

- Delamain registry paths in `module.ts` are module-bundle-relative.
- Delamain-local agent asset paths inside `delamain.ts` are Delamain-bundle-relative.
- Delamain prompt assets stay filesystem assets beside the authored definition.
- Dispatcher template version is runtime asset metadata. It is not declared in `module.ts`, authored `delamain.ts`, `runtime-manifest.json`, or record frontmatter.
- For agent file format (frontmatter keys, body-as-prompt, sub-agents), see `delamain-agents.md`.

## Bundle Layout

Required authored layout:

```text
.als/
  system.ts
  authoring.ts
  modules/
    backlog/
      v1/
        module.ts
        skills/
          backlog-manage/
            SKILL.md
        delamains/
          development-pipeline/
            delamain.ts
            agents/
              in-dev.md
```

Rules:

- Version bundles remain contiguous from `v1` through the active version.
- Active skills are still declared in `.als/system.ts`, but canonical skill bundles live under `skills/{skill_id}/SKILL.md`.
- Every bundle `vK` where `K > 1` must contain `migrations/MANIFEST.md` plus at least one additional migration artifact.

## Deployment Note

Authored Delamains are TypeScript, but Claude deploy still writes a runtime `delamain.yaml` into `.claude/delamains/{name}/` beside `runtime-manifest.json` so existing dispatchers keep the same downstream contract.

## Detailed Rules

`shape-language.md` is the authoritative reference for ALS authored source. Runtime-specific details such as deployed dispatcher behavior, agent markdown frontmatter, and `.als/config.md` boot metadata are split into the neighboring `delamain-agents.md`, `delamain-dispatcher.md`, and `bootup-config.md` references.

### system.ts Detailed Rules

- `als_version` is required and must be a positive integer.
- ALS v1 currently supports `als_version: 1` only.
- ALS language-version upgrades remain whole-system cutovers. Mixed authored ALS versions inside one system are not part of the v1 contract.
- `system_id` is required and must be a non-empty string.
- Module ids must match `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`.
- Module mount paths are normalized relative paths from the ALS system root.
- Module mount paths must not be absolute, contain empty segments, contain `.` or `..`, or contain hidden segments such as `.als`.
- Module descriptions are required, must be trimmed, must stay on one line, and must be 120 characters or fewer.
- Validators reject missing module descriptions. ALS does not infer or default them from the module id.
- No two modules may have identical or overlapping mount paths.
- The declared module path must exist as a directory when validating.
- Active skill ids must be globally unique across the live system.
- If `skills` is non-empty, the active bundle must contain `skills/{skill_id}/SKILL.md` for every listed skill id.
- If `skills` is empty, the active bundle may omit `skills/` entirely.
- Unlisted skill directories under the active bundle's `skills/` directory are invalid.
- Bundles above the active version may exist for staged future work and are ignored by default validation.
- A module declared at `version: N` must have contiguous bundle history from `v1` through `vN`.

### module.ts Detailed Rules

- Every required module version bundle contains `module.ts`.
- `dependencies` is required. Use an empty array when the module has no cross-module refs.
- `delamains` is optional. Omit it when the module does not use Delamain-bound fields.
- `delamains.{name}.path` must resolve to a file inside the same active module version bundle.
- Delamain registry paths in `module.ts` are module-bundle-relative.
- Delamain-local asset paths inside authored `delamain.ts` remain Delamain-bundle-relative.
- If a `ref` targets another module, that target module must be listed in `dependencies`.
- Entity names must match `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`.
- Authored ALS v1 source does not include a top-level `schema` field. Validators reject stale `schema` keys so removed syntax does not linger in systems or prompts.

### Path Templates

Path templates use `{placeholder}` segments to map records to filesystem locations.

- `{id}` captures this entity's id.
- `{parent_entity_name}` captures an ancestor id using the ancestor entity name, not the ref field name.
- Every path must contain `{id}`.
- Markdown entities must end in `.md`.
- JSONL entities must end in `.jsonl`.
- Nested entities should include ancestor placeholders so lineage is encoded in the path.

Examples:

- Flat markdown: `items/{id}.md`
- Self-named directory: `items/{id}/{id}.md`
- Nested markdown: `programs/{program}/experiments/{id}/{id}.md`
- Deep nested markdown: `programs/{program}/experiments/{experiment}/runs/{id}.md`
- JSONL stream: `streams/{id}.jsonl`

### Detailed Field Rules

Markdown entities must declare an `id` field of type `id`. Every declared markdown field must appear explicitly in record frontmatter. `allow_null` controls whether the explicit value may be `null`; it does not allow omission.

There is no optional-field syntax in ALS v1. Omit the field entirely only by changing the authored contract.

#### id

```ts
id: { type: "id", allow_null: false }
```

- Primary key.
- Must be a non-empty string.
- Must match the filename stem.
- `allow_null: true` is invalid on `id`.

#### string

```ts
title: { type: "string", allow_null: false }
```

- Must be a string.
- Empty strings are rejected.

#### number

```ts
budget: { type: "number", allow_null: true }
```

- Must remain numeric.
- `NaN` and infinities are rejected in authored source.

#### date

```ts
started_on: { type: "date", allow_null: false }
```

- Values must use `YYYY-MM-DD`.
- Timestamp-like values remain `type: "string"` in ALS v1.

#### enum

- `allowed_values` is required.
- Allowed values must be non-empty unique strings.

#### delamain

```ts
status: {
  type: "delamain",
  allow_null: false,
  delamain: "development-pipeline",
}
```

- Must reference a Delamain name declared in the bundle `delamains` registry.
- Uses the referenced Delamain's state names as its legal persisted values.
- Must not also declare `allowed_values`.
- May appear at most once per effective entity schema. For plain entities, at most one `type: delamain` field on the entity. For variant entities, if root/base fields declare one, variants declare none; if root/base fields declare none, each variant may declare at most one.
- Invalid persisted Delamain state values are reported through the same invalid-value diagnostic family used for plain enums.

#### ref

- Ref values in record frontmatter use the format: `"[display-label](als://system_id/module/entity/id)"`
- The URI path encodes lineage: `als://system_id/module/entity-type/entity-id` for root entities, or `als://system_id/module/parent-type/parent-id/child-type/child-id` for nested entities.
- Use `ref` when the intended meaning is ALS entity identity. Use `file_path` when the intended meaning is a filesystem artifact.
- Refs may target markdown entities or JSONL entities. There are no row-level refs or row-level canonical URIs.
- Refs always target entity identity, not row identity.
- Cross-module refs require a declared dependency on the target module.
- `identity.parent` may only target another markdown entity in the same module definition.

#### file_path

- `file_path` values are plain strings, not markdown links.
- Supported bases are `system_root` and `host_absolute`.
- `file_path` values must be non-empty plain file paths, not URIs such as `https://...` or `file://...`.
- `system_root` means a normalized relative path from the ALS system root containing `.als/system.ts`. Values use `/` separators, must not begin with `/`, `\`, or a drive prefix such as `C:`, and must not contain `\`, `.`, `..`, or empty path segments.
- `host_absolute` means an absolute host path on the validator platform. Values must be normalized, must not contain empty, `.`, or `..` path segments after the root, and must not end with a directory separator.
- File-path targets must exist, be accessible enough for validation, and resolve to files rather than directories.
- File paths may point outside the declaring module subtree and may point to hidden paths including `.als/`.
- File paths do not participate in `dependencies` or ALS ref resolution.

#### list

- Markdown frontmatter supports `list<string>`, `list<enum>`, `list<ref>`, and `list<file_path>`.
- JSONL row schemas support `list<string>` and `list<enum>` only.
- `list<enum>` rejects duplicate members.
- Empty lists are allowed. `allow_null` only controls whether the field value may be `null`.

### JSONL Detailed Rules

Example JSONL entity:

```ts
metrics: {
  source_format: "jsonl",
  path: "streams/{id}.jsonl",
  rows: {
    fields: {
      observed_at: { type: "string", allow_null: false },
      metric: {
        type: "enum",
        allow_null: false,
        allowed_values: ["latency_ms", "error_rate"],
      },
      value: { type: "number", allow_null: false },
      tags: {
        type: "list",
        allow_null: false,
        items: {
          type: "enum",
          allowed_values: ["api-gateway", "baseline", "canary"],
        },
      },
    },
  },
}
```

- JSONL entities declare `path` plus `rows.fields`.
- JSONL entities do not declare `identity`, `fields`, `body`, `discriminator`, `section_definitions`, or `variants`.
- Empty JSONL files are valid.
- Every JSONL line must be one JSON object.
- Every JSONL line must satisfy the same declared row schema.
- Every declared JSONL row key must be present on every line.
- `allow_null: true` allows explicit `null`; it does not allow omission.
- Undeclared JSONL row keys are rejected.
- JSONL rows support only `string`, `number`, `date`, `enum`, `list<string>`, and `list<enum>` in ALS v1.

### Body Contract Detailed Rules

`body` is the explicit top-level markdown body contract for a record. It may declare:

- `title`
- `preamble`
- `sections` for plain entities

There are no invisible body zones. Every authored top-level body region must be declared.

#### Title sources

- `body.title` is optional.
- If `body.title` is declared, the record must contain exactly one `h1`.
- There is no implicit `title == id` rule.
- `source.kind` must be `field`, `authored`, or `template`.
- `field` sources must reference a declared non-null `id` or `string` field.
- `template.parts` must be a non-empty ordered list of `{ kind: "field" }` or `{ kind: "literal" }` entries.
- The rendered field or template value must match the authored `h1` text exactly.

#### Region definitions

`body.preamble`, inline `body.sections` entries, `section_definitions` values, and `outline.preamble` all share the same region-definition shape.

- `allow_null: true` allows the literal word `null` in place of authored markdown content.
- `content` is required.
- `guidance` is optional.
- If `guidance` is present, `include` and `exclude` are optional non-empty strings.
- Inline `body.sections` entries declare `name`, rendered as `## NAME`.
- Variant `section_definitions` keys are also rendered as `## SECTION_NAME`.
- Every declared section must appear in the record body.
- Sections must appear in declared order.
- Duplicate section names are invalid.

#### Content contracts

Every non-title body region declares a `content` contract with exactly one mode:

- `mode: "freeform"`
- `mode: "outline"`

##### Freeform content

Example:

```ts
content: {
  mode: "freeform",
  blocks: {
    paragraph: { min_count: 1 },
    bullet_list: { max_items: 8 },
    table: { syntax: "gfm" },
    heading: { min_depth: 3, max_depth: 4 },
    blockquote: {},
    code: { require_language: true },
  },
}
```

`{}` means the block type is allowed with no extra constraints.

- `blocks` must declare at least one block type.
- Supported block types are `paragraph`, `bullet_list`, `ordered_list`, `table`, `heading`, `blockquote`, and `code`.
- Supported block options are:
  - `paragraph.min_count` / `paragraph.max_count`
  - `blockquote.min_count` / `blockquote.max_count`
  - `bullet_list.min_items` / `bullet_list.max_items`
  - `ordered_list.min_items` / `ordered_list.max_items`
  - `table.syntax`
  - `heading.min_depth` / `heading.max_depth`
  - `code.require_language`
- Raw HTML is rejected everywhere in ALS bodies.
- Reference-style links and reference-style images are rejected.
- Markdown definition nodes are rejected.
- Thematic breaks are rejected.
- `table.syntax` is required and must currently be `gfm`.
- ALS table support is GitHub Flavored Markdown pipe tables only: one header row, one delimiter row, zero or more body rows, inline markdown only inside cells, no multiline cell blocks, no headerless tables, no row/column spans. HTML tables are not part of v1.
- Phrasing-level validation is only partially enforced by the compiler in current v1. The compiler rejects raw HTML and reference-style syntax, but does not exhaustively validate every inline node.
- Authored records currently use this inline markdown subset: plain text, strong, emphasis, inlineCode, inline links, inline images, hard line breaks.
- In top-level `body.preamble` and top-level `body.sections` regions, structural heading depth is `2`, so freeform `heading` content can only match `h3` or deeper.

##### Outline content

Example:

```ts
content: {
  mode: "outline",
  preamble: {
    allow_null: false,
    content: {
      mode: "freeform",
      blocks: { paragraph: { min_count: 1 } },
    },
  },
  nodes: [
    {
      heading: { depth: 3, text: "Detection" },
      content: {
        mode: "freeform",
        blocks: { bullet_list: {} },
      },
    },
    {
      heading: { depth: 3, text: "Recovery Lead Notes" },
      content: {
        mode: "freeform",
        blocks: { blockquote: {} },
      },
    },
  ],
}
```

Use `outline` when the heading tree itself is part of the schema contract. Use `freeform` when headings are allowed but their exact labels and order are not declared.

- `outline.preamble` is optional and uses the same region-definition shape as `body.preamble`.
- `nodes` must be a non-empty ordered list.
- Each node must declare `heading.depth`, `heading.text`, and `content`.
- `heading.depth` is explicit and exact.
- ALS v1 outline nodes are ordered, required, and exact.
- ALS v1 outline does not define optional nodes, repeated nodes, or other cardinality syntax.
- `node.content` currently uses `mode: "freeform"`.
- If a node's freeform content allows headings, those headings must be deeper than that node's declared `heading.depth`.

### Variant Entity Detailed Rules

- `discriminator` must point to a root/base field that is `type: "enum"` and `allow_null: false`.
- Variant keys form a bijection with the discriminator enum values.
- Variant-local field names must not collide with root/base field names.
- Once the discriminator resolves, the effective frontmatter contract is the root/base `fields` plus that variant's `fields`.
- Every section name referenced by a variant must exist in `section_definitions`.
- A variant's `sections` list is the authoritative full `h2` order for that variant.
- Shared `body.title` and shared `body.preamble`, when declared, apply to every variant of the entity.
- If the discriminator is missing, non-string, or invalid, the compiler validates only root/base fields and emits the unresolved-variant body diagnostic instead of guessing variant-specific fields or sections.

### Delamain State Machine Rules

- Delamain primary definition files declare ordered `phases`, authoritative `states`, and explicit `transitions`.
- Each Delamain definition has exactly one `initial: true` state.
- Every state declares `phase`.
- Every declared phase must contain at least one state.
- The initial state must be in the first declared phase.
- Terminal states must be in the last declared phase.
- Non-terminal states declare `actor: "operator" | "agent"`.
- Terminal states do not declare `actor`.
- Delamain does not require operator-owned non-terminal states; fully autonomous lifecycles are allowed.
- `advance` and `rework` use a single-state `from`.
- `exit` uses a single-state `from` or a non-empty list-valued `from`.
- Self-loop transitions are rejected.
- Every state must be reachable from the initial state.
- Terminal states must not have outgoing transitions.
- Every non-terminal state must have at least one outgoing transition and a path to at least one terminal state.
- `actor: "agent"` states declare exactly one `path` plus explicit boolean `resumable`.
- `provider` is required on `actor: "agent"` states and must be `anthropic` or `openai`.
- If `resumable: true`, the state declares exactly one `session-field`.
- If `resumable: false`, the state does not declare `session-field`.
- Delamain-declared session-field names become implicit nullable string frontmatter fields on bound entities.
- A Delamain session-field must not collide with any explicit entity field name or any other implicit session field materialized on the same effective entity schema.
- Delamain-local prompt asset paths such as `path` and `sub-agent` resolve relative to the Delamain bundle root and must stay inside the same active module version bundle.

### Naming And Record Conventions

- Module ids, entity names, and skill ids are single-segment kebab-case slugs matching `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`.
- Module mount paths are slash-separated slug segments using that same segment regex.
- Field names must match `^[a-z][a-z0-9_]*$`.
- `system_id` may be any non-empty string, though kebab-case is recommended.
- Section names may be any non-empty string; `UPPER_SNAKE_CASE` is recommended.
- Record ids may be any non-empty string but must match the filename stem.
- Authoring workflows should default skill ids to `<module-id>-<base-skill-name>`. When the base phrase already repeats the module name, normalize to one leading module prefix.
- `AGENTS.md` and `CLAUDE.md` at any depth in the module subtree are reserved non-record files, matched case-insensitively (including the `.md` extension), and ignored during record validation.
- Other markdown record files must use lowercase `.md`; `README.MD` is invalid. JSONL record files must use lowercase `.jsonl`.

### Record Layout

A markdown record consists of:

- YAML frontmatter that satisfies the effective field contract
- a validated body title when `body.title` is declared
- optional declared preamble content
- declared `##` sections in authored order

If `body.title` is declared, the `# Title` heading after frontmatter is validated according to `title.source`. Nullable body regions with no content use the literal word `null`.

## What a Record File Looks Like

A markdown record with YAML frontmatter, validated body title, optional preamble, and declared sections:

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

- Each declared frontmatter field must appear explicitly, using YAML `null` when `allow_null: true` and no value is available.
- If `body.preamble` is declared, authored content before the first declared `##` belongs to that preamble region.
- Each declared section appears as `## SECTION_NAME` in the order declared by the shape.
- Empty string is not a valid value for `type: string` fields.
