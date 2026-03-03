---
name: backlog-module
description: Operate on the PALS backlog module for read/write workflows, schema-aware validation, and versioned evolution tasks.
---

# Backlog Module Skill

## Use This Skill When

1. You need to read backlog epics or stories.
2. You need to create or update backlog records.
3. You need module-owned interpretation for prioritization or readiness.

## Scope

- Read/write scope: `modules/backlog/`
- Do not write outside module scope.

## Read Response Contract

Return:
1. `answer`
2. `evidence`
3. `needs`
4. `confidence`
5. `uncertainties`

## Write Rules

1. Enforce schema in `modules/backlog/.schema/`.
2. Enforce canonical references: `pals://section9/backlog/<opaque-id>`.
3. Keep body required sections present. Use `null` for explicit empty content.

## Evolution Rules

1. Follow module compatibility policy in `modules/backlog/MODULE.md`.
2. Use phased plan: `prepare -> expand -> backfill -> cutover -> cleanup`.
