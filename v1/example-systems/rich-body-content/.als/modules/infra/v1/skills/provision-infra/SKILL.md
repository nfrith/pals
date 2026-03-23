---
name: provision-infra
description: Stand up new infrastructure — regions, clusters, or services within the infra module.
---

# Provision Infrastructure

Add new infrastructure entities to the system.

## Input

The operator describes what they want to provision:
- "Add a new region for GCP in Asia"
- "Spin up a staging cluster in US East 1"
- "Register the payment service in the prod cluster"

## Procedure

### 1 — Identify Target Entity

Determine which entity type the operator wants to create: `region`, `cluster`, or `service`.

If ambiguous, ask. Do not guess.

### 2 — Validate Parent Lineage

- **region**: No parent required.
- **cluster**: Parent region must exist and be `active`.
- **service**: Parent cluster must exist and be `active`.

If the parent doesn't exist or is in an invalid state, stop and tell the operator.

### 3 — Gather Required Fields

Collect all required fields for the entity type per the module shape (`.als/modules/infra/v1/shape.yaml`):

- **region**: `id`, `name`, `provider`, `status`
- **cluster**: `id`, `name`, `region_ref`, `orchestrator`, `status`
- **service**: `id`, `name`, `cluster_ref`, `runtime`, `replicas`, `status`

Generate the next sequential ID by scanning existing records under the parent path. Set initial `status` to `provisioning` (region, cluster) or `deploying` (service) unless the operator specifies otherwise.

### 4 — Author Body Sections

Prompt the operator for content for each required body section. Use the shape file to determine which sections are required vs optional and what block types are allowed.

If the operator has nothing for optional sections, omit them.

### 5 — Write the Record

Create the record file at the correct path in the entity hierarchy:
- `infra/regions/{id}/{id}.md`
- `infra/regions/{region}/clusters/{id}/{id}.md`
- `infra/regions/{region}/clusters/{cluster}/services/{id}/{id}.md`

Confirm the file path with the operator before writing.

## Scope

- Creates `region`, `cluster`, and `service` entities only.
- Releases are handled by `deploy-release`.
- Does not modify existing records.
