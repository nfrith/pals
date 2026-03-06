---
name: people-module
description: Operate on the PALS people module for identity lookups and person profile updates.
---

# People Module Skill

## Use This Skill When

1. You need to read person records by `id`.
2. You need to update person metadata or contact details.

## Scope

- Read/write scope: `workspace/people/`
- Do not write outside module scope.

## Write Rules

1. Enforce schema in `workspace/people/.schema/`.
2. Enforce canonical references: `pals://workspace/people/<opaque-id>`.
3. Keep all declared sections present and use `null` for explicit empty content.
