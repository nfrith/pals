---
name: deploy-release
description: Create and manage releases for services in the infra module — rollouts, rollbacks, and supersession.
---

# Deploy Release

Manage the release lifecycle for infrastructure services.

## Input

The operator describes the release action:
- "Deploy v2.15.0 of the API Gateway"
- "Roll back the latest auth service release"
- "Mark the 2.14.0 release as active"

## Procedure

### 1 — Identify the Target Service

Resolve the service the operator is referring to. Read its current state. Verify the service exists.

### 2 — Determine the Action

- **Create a release**: New deployment of a version to a service.
- **Roll back**: Transition an active release to `rolled-back` and reactivate the previous release.
- **Supersede**: When creating a new release, mark the currently active release as `superseded`.

### 3 — Create a Release Record

When creating a new release:

1. Scan existing releases under the service to determine the next `REL-*` ID.
2. Collect from the operator: `version`, `deployed_on` (defaults to today).
3. Set `status` to `pending`.
4. Author body sections per the shape: `CHANGES`, `ROLLBACK_PLAN`, `VERIFICATION`.
5. If a currently `active` release exists, mark it `superseded`.

### 4 — Status Transitions

Valid transitions:
- `pending` → `rolling-out` → `active`
- `active` → `rolled-back`
- `active` → `superseded` (only when a new release becomes active)

Reject invalid transitions. Explain why and suggest the correct path.

### 5 — Write Changes

Write or update release records at the correct path:
- `infra/regions/{region}/clusters/{cluster}/services/{service}/releases/{id}.md`

## Scope

- Manages `release` entities only.
- Reads but does not modify `service`, `cluster`, or `region` records.
- Provisioning new services is handled by `provision-infra`.
