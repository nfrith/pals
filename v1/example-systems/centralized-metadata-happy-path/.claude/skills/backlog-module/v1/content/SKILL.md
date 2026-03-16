---
name: backlog-module
description: Operate on the backlog module for read/write workflows using root-managed shape metadata.
---

# Backlog Module Skill

## Use This Skill When

1. You need to read backlog epics or stories.
2. You need to create or update backlog records.
3. You need module-owned interpretation for prioritization or readiness.

## Scope

- Read/write scope: `workspace/backlog/`
- Authoritative shape: `.pals/modules/backlog/v1.yaml`
- Registry entry: `.pals/system.yaml`

## Read Response Contract

Return:
1. `answer`
2. `evidence`
3. `confidence`
4. `uncertainties`

## Write Rules

1. Enforce the backlog contract from `.pals/modules/backlog/v1.yaml`.
2. Enforce canonical references using entity-tagged qualified logical URIs, for example `pals://workspace/backlog/story/STORY-0001`.
3. Keep all declared body sections present. Use `null` for explicit empty content.
4. Section headings must match the root-managed shape exactly.
