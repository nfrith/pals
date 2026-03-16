# Schema Frontmatter Definition (Current Baseline)

## Scope

This document defines the allowed frontmatter shape for PALS schema files:

1. `workspace/<module>/.schema/<entity>.md`
2. `.claude/skills/<module-skill>/vN/schemas/<entity>.md`

## Canonical Type Model

```ts
type SchemaFileFrontmatter = {
  entity: EntityName;
  schema_version: PositiveInteger;
  identity_contract: {
    local_id_field: "id";
    parent_ref_field?: FieldName;
  };
  frontmatter_contract: Record<FieldName, FieldContract>;
  body_contract: {
    source: "markdown";
    section_contract_model: "inline";
  };
};

type FieldContract =
  | { type: "id"; nullable: false }
  | { type: "string"; nullable: boolean }
  | { type: "number"; nullable: boolean }
  | { type: "date"; nullable: boolean }
  | { type: "enum"; nullable: boolean; allowed: [string, ...string[]] }
  | {
      type: "ref";
      nullable: boolean;
      uri_scheme: "pals";
      namespace: string;
      module: string;
      target_entity: string;
    }
  | { type: "array"; nullable: boolean; items: ArrayItemContract };

type ArrayItemContract =
  | { type: "string" }
  | {
      type: "ref";
      uri_scheme: "pals";
      namespace: string;
      module: string;
      target_entity: string;
    };
```

## Canonical YAML Shape

```yaml
---
entity: <entity-name>
schema_version: <positive-integer>
identity_contract:
  local_id_field: id
  # optional for child entities
  parent_ref_field: <field-name>
frontmatter_contract:
  id:
    type: id
    nullable: false
  <field-name>:
    type: <id|string|number|date|enum|ref|array>
    nullable: <true|false>
    # enum only
    allowed: [<value>, ...]
    # ref only
    uri_scheme: pals
    namespace: <namespace>
    module: <module-id>
    target_entity: <entity-name>
    # array only
    items:
      type: <string|ref>
      # ref item only
      uri_scheme: pals
      namespace: <namespace>
      module: <module-id>
      target_entity: <entity-name>
body_contract:
  source: markdown
  section_contract_model: inline
---
```

## Compiler Enforcement Rules

1. Top-level frontmatter keys must be exactly: `entity`, `schema_version`, `identity_contract`, `frontmatter_contract`, `body_contract`.
2. `entity` must be a lowercase kebab-case identifier string matching `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`.
3. `schema_version` must be a positive integer.
4. `identity_contract` must be an object with key `local_id_field` and optional key `parent_ref_field`.
5. `identity_contract.local_id_field` must be literal `id`.
6. If `identity_contract.parent_ref_field` is present, it must be a non-empty identifier string.
7. `frontmatter_contract` must be a non-empty object keyed by field name.
8. Every field contract must include `type` and `nullable`.
9. Allowed field `type` values are only: `id`, `string`, `number`, `date`, `enum`, `ref`, `array`.
10. `enum` fields must include non-empty `allowed` with unique string values.
11. `ref` fields must include: `uri_scheme`, `namespace`, `module`, `target_entity`.
12. `ref.uri_scheme` must be `pals`.
13. `array` fields must include `items`.
14. Array item contracts support only `string` and `ref` in the current baseline.
15. `id` must be declared in `frontmatter_contract` with `type: id` and `nullable: false`.
16. If `identity_contract.parent_ref_field` is present, it must refer to a declared `frontmatter_contract` field with `type: ref` and `nullable: false`.
17. `body_contract.source` must be `markdown`.
18. `body_contract.section_contract_model` must be `inline`.
19. `schema_version` in each schema file must match module `MODULE.md` `schema_version` for the deployed version.
20. All deployed schema files in a module must share the same `schema_version`.

## Boundary

This file defines only schema-file frontmatter shape. Record validation semantics are defined in `palsc/references/record-validation.md`.
Declared frontmatter fields are always required to be present on records; `nullable` controls whether the value may be explicit `null`.
Logical URI construction is defined by `identity_contract`; ref values still use the canonical markdown-link form.
Canonical entity names are lowercase kebab-case and must match `MODULE.md` `entity_paths` keys exactly.

## Explicitly Not Supported (Current Baseline)

1. Per-entity schema_version divergence inside one deployed module version.
2. Non-markdown body sources.
3. Non-inline body section contract models.
4. Optional-presence field semantics (`nullable: true` does not make a field omittable).
5. Arbitrary identity field names (`local_id_field` is fixed to `id` in the current baseline).
