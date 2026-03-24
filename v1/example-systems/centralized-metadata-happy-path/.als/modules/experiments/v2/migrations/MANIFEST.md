---
manifest_id: MUT-experiments-v1-to-v2-20260324-001
module_id: experiments
module_path: workspace/experiments
skill_paths:
  - .als/modules/experiments/v2/skills/experiments-module
from_version: 1
to_version: 2
change_class: schema_only
data_migration_required: true
status: staged
created_on: 2026-03-24
updated_on: 2026-03-24
---

## Intent
Expand the experiments module to capture client ownership on programs and funding state on experiments without changing the outward skill interface.

## Wants
- `add-program-client-ref`: Add required frontmatter field `client_ref` to `program`.
- `expand-experiment-status-enum`: Extend experiment `status` with `awaiting-funds` and `funded`.
- `add-experiment-budget`: Add nullable frontmatter field `budget` to `experiment`.
- `keep-skill-interface-stable`: Keep the `experiments-module` skill interface unchanged for this cutover.

## Does Not Want
- `no-record-path-changes`: No record path changes.
- `no-entity-renames`: No entity renames.
- `no-run-shape-changes`: No changes to `run`.

## Invariants
- `preserve-module-hierarchy`: The module remains `program -> experiment -> run`.
- `preserve-record-identity`: Existing ids, URIs, and parent lineage remain stable.

## Contra-Invariants
- `v1-program-shape-retired`: `program` records without `client_ref` are no longer valid in `v2`.
- `v1-experiment-status-surface-retired`: The narrower `v1` experiment status enum is no longer the whole canonical status surface in `v2`.

## Migration Constraints
- `deterministic-rewrite`: The migration must be deterministic.
- `idempotent-script`: The migration must be idempotent.
- `preserve-non-migrated-content`: The migration must preserve all unchanged frontmatter and body content.

## Current Module Understanding
### Entity Shapes
The module still contains `program`, `experiment`, and `run`. `v2` adds `client_ref` to `program`, adds `budget` to `experiment`, and expands the experiment `status` enum.

### Workflows
This release does not change the module skill interface. Operators still use the same single skill bundle.

## Schema Changes
- `add-program-client-ref`: Add required field `client_ref: ref(client-registry/client)` to `program`.
- `expand-experiment-status-enum`: Add `awaiting-funds` and `funded` to experiment `status`.
- `add-experiment-budget`: Add nullable field `budget: number` to `experiment`.

## Behavior Changes
- `skill-bundle-unchanged`: None. The `experiments-module` bundle is copied forward unchanged in `v2`.

## Data Migration Plan
- `migration-script`: Run `migrations/migrate_from_v1.py`.
- `backfill-program-client-ref`: Backfill `client_ref` using an operator-maintained mapping file or leave records queued for manual completion.
- `seed-budget-null`: Add `budget: null` to existing experiment records when absent.
- `keep-run-records-unchanged`: Leave `run` records unchanged.

## Behavior Test Plan
- `verify-skill-bundle-stability`: The `experiments-module` skill bundle remains unchanged across the cutover.
- `verify-v2-shape`: Migrated records validate against the `v2` shape.
- `verify-idempotence`: Re-running the migration is a no-op on already migrated records.

## Cutover Gates
- `author-v2-bundle`: `v2` shape, skill bundle, and migration assets are authored.
- `run-migration-cleanly`: The migration script completes or clearly reports records queued for manual completion.
- `flip-system-version-last`: `.als/system.yaml` points `experiments` at `version: 2` only after records are in `v2` form.

## Risks
- `client-backfill-needs-operator-input`: Existing program records may require an external mapping to determine `client_ref`.

## Sign-off
- operator_approved: yes
- approval_date: 2026-03-24
- notes: Bundled migration example for the canonical ALS module-version layout.
