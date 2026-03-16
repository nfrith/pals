---
name: people-module
description: Operate on the people module using root-managed shape metadata.
---

# People Module Skill

## Use This Skill When

1. You need to read person records by `id`.
2. You need to update person metadata or contact details.

## Scope

- Read/write scope: `workspace/people/`
- Authoritative shape: `.pals/modules/people/v1.yaml`
- Registry entry: `.pals/system.yaml`

## Write Rules

1. Enforce the `person` contract from `.pals/modules/people/v1.yaml`.
2. Enforce canonical references: `pals://workspace/people/person/<opaque-id>`.
3. Keep all declared sections present and use `null` for explicit empty content.
