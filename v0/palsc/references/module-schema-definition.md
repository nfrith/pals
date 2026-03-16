# Module Contract Schema Definition (Current Baseline)

## Scope

This document defines the allowed shape for module contract files:

1. `workspace/<module_id>/MODULE.md`

`MODULE.md` is frontmatter-only in the current baseline.

## Canonical Type Model

```ts
type ModuleContractFrontmatter = {
  module_id: string;
  namespace: string;
  uri_scheme: "pals";
  module_version: PositiveInteger;
  schema_version: PositiveInteger;
  entity_paths: Record<EntityName, RelativePathPattern>;
  references: {
    modules: ExternalModuleRef[];
  };
};

type EntityName = string; // lowercase kebab-case
type RelativePathPattern = string; // semantic path template, see rules below

type ExternalModuleRef = {
  namespace: string;
  module_id: string;
};
```

## Canonical YAML Shape

```yaml
---
module_id: <module-id>
namespace: <namespace>
uri_scheme: pals
module_version: <positive-integer>
schema_version: <positive-integer>
entity_paths:
  <entity-name>: <relative-path-pattern>
  # examples:
  # epic: epics/<EPIC-ID>.md
  # experiment: programs/<PROGRAM-ID>/experiments/<EXPERIMENT-ID>/<EXPERIMENT-ID>.md
references:
  modules:
    - namespace: <namespace>
      module_id: <module-id>
---
```

## Entity Path Template Language

`entity_paths` values are semantic relative path templates evaluated against normalized module-relative paths using `/` separators.

Entity-name grammar:

1. Entity names must match `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`.
2. The same entity-name grammar is used by schema frontmatter `entity` and logical URI entity tags.

Canonical placeholder mapping:

1. For entity `<entity-name>`, the canonical placeholder token is `<UPPERCASE(entity-name)-ID>`.
2. Examples:
   - `epic` -> `<EPIC-ID>`
   - `build-step` -> `<BUILD-STEP-ID>`
   - `transaction-id` -> `<TRANSACTION-ID-ID>`
3. Reverse mapping is:
   - remove surrounding `<` and `>`
   - remove the final `-ID` suffix only
   - lowercase the remaining token
4. This round-trip assumes entity names are lowercase-normalized under the grammar above.

Template syntax:

1. A template is a `/`-separated relative path.
2. Each segment is either:
   - a literal segment such as `programs`
   - a segment containing exactly one canonical placeholder token with optional literal affixes, such as `<PROGRAM-ID>` or `<EPIC-ID>.md`
3. A placeholder matches a non-empty string that does not contain `/`.
4. Literal text matches exactly and case-sensitively.
5. Each segment may contain at most one placeholder.
6. For entity `<entity-name>`, the terminal filename segment must be exactly `<SELF-PLACEHOLDER>.md`.
7. If the same placeholder appears more than once in one template, all occurrences must bind the same value when matching a concrete path.
8. Every placeholder token used in any template must correspond to a declared entity key in the same module.

Invalid template forms in the current baseline:

1. absolute paths
2. empty segments
3. `.` or `..` segments
4. trailing `/`
5. stray `<` or `>` characters that do not form one complete placeholder token
6. empty placeholders such as `<>`
7. glob syntax (`*`, `**`, `?`)
8. regex syntax
9. alternation
10. optional segments
11. multiple placeholders in one segment

## Compiler Enforcement Rules

1. `MODULE.md` must be frontmatter-only (no markdown body content after closing `---`).
2. Top-level frontmatter keys must be exactly:
   - `module_id`
   - `namespace`
   - `uri_scheme`
   - `module_version`
   - `schema_version`
   - `entity_paths`
   - `references`
3. `module_id` must be a non-empty identifier string.
4. `namespace` must be a non-empty identifier string.
5. `uri_scheme` must be `pals`.
6. `module_version` must be a positive integer.
7. `schema_version` must be a positive integer.
8. `entity_paths` must be a non-empty object keyed by entity name.
9. Every `entity_paths` key must satisfy the entity-name grammar above.
10. Every `entity_paths` value must be a valid relative path template under the rules above.
11. For each entity key, the corresponding template terminal filename segment must be exactly that entity's canonical placeholder token plus `.md`.
12. The `entity_paths` template set for one module must be pairwise non-overlapping.
13. `references` must be an object with key `modules`.
14. `references.modules` must be an array (empty array allowed).
15. Each `references.modules` item must include only:
    - `namespace` (non-empty string)
    - `module_id` (non-empty string)
16. Self-reference is not allowed in `references.modules` (`namespace` + `module_id` equal to this module).
17. `references.modules` must be deduplicated by `(namespace, module_id)`.
18. `references.modules` must be sorted by `namespace`, then `module_id`.
19. `entity_paths` keys are the canonical entity names used by schema `entity` and logical URI entity tags.
20. Invalid `entity_paths` grammar, placeholder tokens, terminal self-placeholder shape, or template-set overlap emit `PAL-SCHEMA-012`.

## Boundary

This file defines only module-contract file shape.

1. Per-record validation semantics are defined in `palsc/references/record-validation.md`.
2. Entity schema file frontmatter shape is defined in `palsc/references/frontmatter-schema-definition.md`.
3. Entity schema body shape is defined in `palsc/references/content-schema-definition.md`.
4. Module skill filesystem/router shape is defined in `palsc/references/module-skill-definition.md`.
5. `entity_paths` governs filesystem layout; logical identity and URI construction are defined by schema `identity_contract`.

## Explicitly Not Supported (Current Baseline)

1. Markdown body sections in `MODULE.md`.
2. Undeclared top-level keys in module contract frontmatter.
3. Self-dependency declarations in `references.modules`.
4. Arbitrary placeholder names in `entity_paths`.
5. Glob or regex semantics in `entity_paths`.
