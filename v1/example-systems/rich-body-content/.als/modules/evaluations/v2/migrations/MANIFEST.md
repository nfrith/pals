---
manifest_id: MUT-evaluations-v1-to-v2-20260324-001
module_id: evaluations
module_path: governance/evaluations
skill_paths:
  - .als/modules/evaluations/v2/skills/evaluations-module
from_version: 1
to_version: 2
change_class: schema_only
data_migration_required: true
status: migrated
created_on: 2026-03-24
updated_on: 2026-03-24
---

## Intent
Clarify that an evaluation's final state is an owned outcome, not just a bare decision flag.

## Wants
- `rename-decision-field`: Rename frontmatter `decision` to `outcome`.
- `add-owner-field`: Add required frontmatter field `owner`.
- `rename-decision-section`: Rename the final body section from `DECISION` to `OUTCOME`.
- `keep-skill-interface-stable`: Keep the module skill interface unchanged for this cutover.

## Does Not Want
- `no-record-path-changes`: No record path changes.
- `no-entity-renames`: No entity renames.
- `no-skill-interface-changes`: No skill-interface changes during this migration.

## Invariants
- `single-evaluation-entity`: Every record remains a single `evaluation` entity at `{id}.md`.
- `preserve-outcome-enum`: Allowed outcome values remain `pending | approved | rejected | deferred`.
- `preserve-evaluation-meaning`: Existing evaluation content stays semantically intact after migration.

## Contra-Invariants
- `decision-field-retired`: `decision` is no longer the canonical frontmatter field name.
- `decision-heading-retired`: `DECISION` is no longer the canonical final section heading.

## Migration Constraints
- `deterministic-rewrite`: The migration must be deterministic.
- `idempotent-script`: The migration must be idempotent.
- `preserve-non-migrated-content`: The migration must preserve all non-migrated frontmatter and body content.
- `fail-closed-on-bad-frontmatter`: The migration must fail closed if a record lacks expected frontmatter boundaries.

## Current Module Understanding
### Entity Shapes
The module still contains one flat `evaluation` entity at `{id}.md`. The `v2` shape adds `owner`, renames `decision` to `outcome`, and renames the final body section to `OUTCOME`.

### Workflows
This release does not change the module skill interface. Operators still create, inspect, and revise evaluations through the same single skill bundle.

### Reference Paths
No reference-path or identity-contract changes land in this cutover. Record ids, URIs, and containment remain stable.

## Schema Changes
- `add-owner-field`: Add required field `owner: string` to `evaluation`.
- `rename-decision-field`: Rename frontmatter field `decision` to `outcome`.
- `rename-decision-section`: Rename body section `DECISION` to `OUTCOME`.

## Behavior Changes
- `skill-bundle-unchanged`: None. The `evaluations-module` skill bundle is copied forward unchanged in `v2`.

## Data Migration Plan
- `migration-script`: Run `migrations/migrate_from_v1.py`.
- `rewrite-decision-field`: Rewrite frontmatter key `decision` to `outcome`.
- `backfill-owner`: Backfill `owner` from category-to-owner defaults when absent.
- `rewrite-decision-heading`: Rewrite top-level heading `## DECISION` to `## OUTCOME`.
- `ambiguity-policy`: Fail and queue manual review if the input record does not match the expected migration surface.

## Behavior Test Plan
- `verify-skill-bundle-stability`: Given the `v1` skill bundle, when it is promoted into `v2`, there is no behavioral diff.
- `verify-idempotence`: Given post-migration data, when the migration runs again, it is a no-op.
- `verify-v2-shape`: Given migrated records, when validated against `v2`, validation is clean.

## Cutover Gates
- `author-v2-bundle`: `v2` shape and `v2` skill bundle are authored.
- `run-migration-cleanly`: The migration script executes without failure on all existing evaluation records.
- `validate-migrated-records`: Migrated records satisfy the `v2` shape.
- `flip-system-version-last`: `system.yaml` points `evaluations` at `version: 2` only after data is in `v2` form.

## Risks
- `owner-defaults-heuristic`: `owner` defaults are heuristic and may need human correction if future category values expand beyond the current mapping.
- `single-heading-assumption`: Heading replacement assumes the canonical final section label appears exactly once.

## Sign-off
- operator_approved: yes
- approval_date: 2026-03-24
- notes: Painted as a completed post-cutover fixture example for ALS-native module migration layout.
