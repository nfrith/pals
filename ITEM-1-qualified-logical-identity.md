# Item 1 Decision Record: Qualified Logical Identity

Status: accepted and implemented
Related TODO item: `TODO.md` -> `### 1. Duplicate ID in fixture contradicts spec`

## Problem

The current baseline assumes canonical refs use:

`pals://<namespace>/<module>/<id>`

That only works if `id` is unique across the whole module. The fixture contradicts that assumption in `experiments`, where `EXP-0001` exists under multiple programs.

This is not just a fixture bug. It exposes a deeper issue:

- bare module-local IDs are ambiguous for nested entities
- cross-module refs can point at the wrong record
- search and agent reasoning become error-prone
- forcing global uniqueness creates awkward names like "the first experiment under PRG-0005 is EXP-0205"

## Decision Summary

Adopt fully qualified logical names as the canonical record identity and canonical ref target.

Normative uniqueness rule:

Within a module, a record's canonical identity must be unique, where canonical identity is its fully qualified logical path derived from its entity identity contract and local `id`.

Keep these rules:

1. `id` remains the required local identifier field for every record.
2. Filename stem must continue to equal frontmatter `id`.
3. `id` remains filename-friendly and record-local.

Add these rules:

1. Each entity may be either:
   - root identity
   - child identity qualified by exactly one parent ref
2. Canonical URIs are built from the full logical parent chain, not a bare module-local `id`.
3. Child records should store only immediate-parent refs when higher ancestors are derivable.
4. For child entities, the canonical URI of the target referenced by `parent_ref_field` must be a strict prefix of the child's canonical URI.

## Proposed Identity Model

Identity is declared per entity schema with an explicit identity contract.

Root entity:

```yaml
identity_contract:
  local_id_field: id
```

Child entity:

```yaml
identity_contract:
  local_id_field: id
  parent_ref_field: program_ref
```

Deep child entity:

```yaml
identity_contract:
  local_id_field: id
  parent_ref_field: experiment_ref
```

Notes:

1. `local_id_field` is fixed to `id` in the current proposal.
2. `parent_ref_field` is singular. This keeps identity tree-shaped and avoids a general composite-key model in the baseline.
3. If an entity has no `parent_ref_field`, it is rooted directly under the module namespace.
4. If `parent_ref_field` is present, it must name a declared field in `frontmatter_contract`.
5. That declared field must be `type: ref` and `nullable: false`.
6. That declared field defines the canonical hierarchy parent for the entity.

## Canonical URI Rules

The current 3-segment URI contract is replaced by a qualified logical-path contract:

`pals://<namespace>/<module>/<qualified-logical-path>`

Where `<qualified-logical-path>` is:

1. root entity: `<entity-tag>/<id>`
2. child entity: `<parent-qualified-logical-path>/<entity-tag>/<id>`

`<entity-tag>` is the entity name declared in schema frontmatter `entity`. For deployed modules, that same entity name must appear as the matching key in `MODULE.md` `entity_paths`. Matching is exact and case-sensitive.

Examples:

- program: `pals://workspace/experiments/program/PRG-0001`
- experiment: `pals://workspace/experiments/program/PRG-0001/experiment/EXP-0001`
- run: `pals://workspace/experiments/program/PRG-0001/experiment/EXP-0001/run/RUN-0001`

These are logical names, not raw filesystem paths, even if they often mirror the module tree.

## Example Shapes

Program record:

```yaml
---
id: PRG-0001
title: Pricing Page Rework
status: active
owner_ref: "[alex-rivera](pals://workspace/people/person/PPL-000101)"
---
```

Program schema identity:

```yaml
identity_contract:
  local_id_field: id
```

Experiment record:

```yaml
---
id: EXP-0001
program_ref: "[pricing-page-rework](pals://workspace/experiments/program/PRG-0001)"
title: Headline Variant Test
status: active
budget: 12000
owner_ref: "[mira-chen](pals://workspace/people/person/PPL-000204)"
---
```

Experiment schema identity:

```yaml
identity_contract:
  local_id_field: id
  parent_ref_field: program_ref
```

Run record:

```yaml
---
id: RUN-0001
experiment_ref: "[headline-variant-test](pals://workspace/experiments/program/PRG-0001/experiment/EXP-0001)"
status: completed
outcome: positive
started_on: 2026-02-10
ended_on: 2026-02-11
---
```

Run schema identity:

```yaml
identity_contract:
  local_id_field: id
  parent_ref_field: experiment_ref
```

## Normalization Rule

Do not duplicate derivable ancestor refs unless they carry independent business meaning.

Applied to the current fixture:

1. `experiment` keeps `program_ref`.
2. `run` keeps `experiment_ref`.
3. `run.program_ref` should be removed, because program identity is derivable from `experiment_ref`.

This keeps the model closer to normalized relational structure without turning refs into opaque DB-only foreign keys.

## Boundary Note: `entity_paths`

This proposal does not redefine `MODULE.md` `entity_paths`.

For item `1`:

1. `entity_paths` remains the existing filesystem-layout contract.
2. `identity_contract` defines canonical logical identity and canonical URI construction.
3. Formal path-pattern semantics and any deeper reconciliation between `entity_paths` and `identity_contract` are deferred to TODO item `2`.

## Why This Direction

1. It removes ambiguity for agents and humans.
2. It avoids global module-wide uniqueness pressure for nested entities.
3. It preserves a stable local `id` for filenames and authoring.
4. It supports namespace-like reasoning closer to qualified names in strongly typed systems.
5. It reduces agent ambiguity because the entity type is present in the URI itself.
6. It keeps the baseline model hierarchical instead of introducing arbitrary composite identities too early.

## Explicit Non-Goals For This Decision

1. Do not support arbitrary identity field names such as `ExperimentId`.
2. Do not introduce `scope: module | parent`.
3. Do not support general multi-field composite identity in the baseline.
4. Do not treat raw filesystem paths as canonical refs.

## Repo Surfaces Updated By This Decision

This decision required coordinated updates in at least:

1. `SPEC.md`
2. `palsc/references/frontmatter-schema-definition.md`
3. `palsc/references/record-validation.md`
4. `palsc/references/module-schema-definition.md`
5. `palsc/references/diagnostic-codes.md`
6. example fixture schemas and records under `example-systems/pristine-happy-path`
7. any repo skills/docs/examples that still embed the old bare-ID URI contract

This repository is still pre-release. This decision is implemented as a repo-wide spec and example update, not as a production migration of already-deployed systems.
