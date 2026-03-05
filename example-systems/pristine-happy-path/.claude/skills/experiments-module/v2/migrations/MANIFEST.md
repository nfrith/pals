---
manifest_id: MUT-experiments-v1-to-v2-20260304-001
module_id: experiments
module_path: workspace/experiments
skill_path: .claude/skills/experiments-module
from_version: 1
to_version: 2
change_class: schema_and_logic
data_migration_required: true
status: migrated
created_on: 2026-03-04
updated_on: 2026-03-04
operator: example-operator
agent: codex
---

## Intent
Introduce a funding gate in experiment lifecycle so experiments cannot be activated directly from draft.

## Wants
- WANT-001: Add intermediate statuses `awaiting-funds` and `funded` between `draft` and `active`.
- WANT-002: Track an experiment `budget` in frontmatter.
- WANT-003: Enforce guarded transitions so `draft -> active` is blocked.

## Does Not Want
- AV-001: No changes to program or run schemas in this release.
- AV-002: No changes to module ownership, hierarchy, or URI format.
- AV-003: No writes outside `workspace/experiments/`.

## Invariants
- INV-001: Experiment status must be one of `draft | awaiting-funds | funded | active | paused | completed`.
- INV-002: Transition to `awaiting-funds`, `funded`, or `active` requires `budget > 0`.
- INV-003: Direct transition `draft -> active` is forbidden.

## Contra-Invariants
- CINV-001: v1 rule allowing direct `draft -> active` behavior is removed.

## Constraints
- CST-001: Migration must be deterministic.
- CST-002: Migration must be idempotent.
- CST-003: Existing record IDs and containment paths must remain unchanged.

## Current Module Understanding
### Entity Shapes
Program and run entities are unchanged in v2. Experiment gains `budget` and expanded status enum.

### Workflows
Experiment lifecycle becomes `draft -> awaiting-funds -> funded -> active` with existing side states `paused`, `completed`.

### Reference Paths
No reference path changes. Existing `program_ref` and `owner_ref` remain canonical.

## Schema Changes
- SCH-001: entity=experiment; action=add_field; field=budget:number(required=false)
- SCH-002: entity=experiment; action=expand_enum; field=status; add=[awaiting-funds,funded]

## Behavior Changes
- BEH-001: entrypoint=design-experiment; change=create `budget: null` in new records
- BEH-002: entrypoint=submit-budget; change=new write path to set budget and move to `awaiting-funds`
- BEH-003: entrypoint=mark-funded; change=new write path to move `awaiting-funds -> funded`
- BEH-004: entrypoint=activate-experiment; change=require `funded` and `budget > 0`

## Data Migration Plan
- MIG-001: script=`migrations/001_add_budget_and_funding_status.py`
- MIG-002: strategy=add `budget` to all existing experiment records
- MIG-003: defaults=draft records get `budget: null`; active/paused/completed records get `budget: 1000` if missing
- MIG-004: ambiguity_policy=fail_and_queue_manual

## Behavior Test Plan
- TST-001: kind=transition; given=status=draft,budget=null; when=activate-experiment; then=blocked
- TST-002: kind=transition; given=status=draft,budget=2500; when=submit-budget; then=status=awaiting-funds
- TST-003: kind=transition; given=status=awaiting-funds,budget=2500; when=mark-funded; then=status=funded
- TST-004: kind=transition; given=status=funded,budget=2500; when=activate-experiment; then=status=active
- TST-005: kind=migration_idempotence; given=post-migration data; when=run migration again; then=no-op

## Cutover Gates
- GATE-001: v2 schema and v2 skill content authored
- GATE-002: migration script executed without failures
- GATE-003: post-migration validation clean
- GATE-004: router and MODULE version updated to v2 atomically

## Risks
- RSK-001: Placeholder budgets on legacy active experiments may need operator adjustment later.

## Open Questions
- Q-001: Should budget evolve to structured money object (`amount`,`currency`) in v3?

## Sign-off
- operator_approved: yes
- approval_date: 2026-03-04
- notes: Cutover completed in this fixture as a simulated post-migrate state.
