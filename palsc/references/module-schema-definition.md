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
9. Every `entity_paths` value must be a non-empty relative path pattern string.
10. `references` must be an object with key `modules`.
11. `references.modules` must be an array (empty array allowed).
12. Each `references.modules` item must include only:
    - `namespace` (non-empty string)
    - `module_id` (non-empty string)
13. Self-reference is not allowed in `references.modules` (`namespace` + `module_id` equal to this module).
14. `references.modules` must be deduplicated by `(namespace, module_id)`.
15. `references.modules` must be sorted by `namespace`, then `module_id`.
16. `entity_paths` keys are the canonical entity names used by schema `entity` and logical URI entity tags.

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
