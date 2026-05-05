---
name: infra-inspect
description: Query and understand infrastructure state — read records, list entities, check status across the infra module.
---

# Inspect Infrastructure

Read-only access to infrastructure state.

## Input

The operator asks about infrastructure:
- "Show me the US East 1 region"
- "List all services in CLS-PROD1"
- "What's the status of the API Gateway?"
- "Show me everything in draining or degraded state"

## Procedure

### 1 — Determine Query Type

- **Single record**: Read and present a specific entity by ID.
- **List**: Enumerate entities at a level, optionally filtered by parent.
- **Status scan**: Check status across entity types, flag anything not in a healthy/active state.
- **Tree walk**: Show the full hierarchy from a region down through its clusters, services, and releases.

### 2 — Read and Present

Read records from the module data directory (`infra/`). Present clearly:

- Single record: frontmatter fields and body content.
- List: table of IDs, names, and statuses.
- Status scan: group by status, highlight non-healthy states.
- Tree walk: indented hierarchy with key attributes at each level.

### 3 — Cross-Reference Context

When presenting a record, resolve `als://` references to show parent context. When showing a service, include which cluster and region it belongs to.

## Scope

- Read-only. Does not create, modify, or delete records.
- For mutations, direct the operator to `provision-infra`, `deploy-release`, or `maintain-infra`.
