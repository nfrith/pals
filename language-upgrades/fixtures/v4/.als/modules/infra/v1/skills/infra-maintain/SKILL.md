---
name: infra-maintain
description: Modify running infrastructure — update configurations, transition statuses, and decommission entities in the infra module.
---

# Maintain Infrastructure

Day-2 operations on existing infrastructure entities.

## Input

The operator describes what they want to change:
- "Scale API Gateway to 5 replicas"
- "Put CLS-PROD1 into maintenance mode"
- "Update the networking notes on EU West 1"
- "Decommission the staging cluster"

## Procedure

### 1 — Identify the Target

Resolve the entity the operator wants to modify. Read its current state.

### 2 — Classify the Change

- **Field update**: Changing a frontmatter field (replicas, runtime, provider, orchestrator, etc.)
- **Body update**: Modifying section content (configuration, notes, capacity, etc.)
- **Status transition**: Moving an entity through its lifecycle.
- **Decommission**: Retiring an entity from the system.

### 3 — Validate the Change

**Field updates**: Verify the new value is valid per the module shape — enum membership, type constraints, nullability.

**Status transitions** — valid paths:

- region: `provisioning` → `active` → `draining` → `decommissioned`
- cluster: `provisioning` → `active` ↔ `maintenance` → `draining`
- service: `deploying` → `healthy` ↔ `degraded` → `down`

Reject invalid transitions. Explain the valid options.

**Decommission workflow**:

1. Check for active children. A region cannot be decommissioned while it has non-decommissioned clusters. A cluster cannot be decommissioned while it has non-down services.
2. If active children exist, present them to the operator. They must be drained or moved first.
3. Transition through `draining` → `decommissioned` once children are cleared.

### 4 — Apply the Change

Edit the record file. Show the operator what changed.

## Scope

- Modifies existing `region`, `cluster`, and `service` entities.
- Does not create new entities (use `provision-infra`).
- Does not manage releases (use `deploy-release`).
- Identity changes (renaming IDs, moving entities between parents) are out of scope — those require migration.
