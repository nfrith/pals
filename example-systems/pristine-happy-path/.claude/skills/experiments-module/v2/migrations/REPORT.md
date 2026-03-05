---
report_id: MIG-experiments-v1-to-v2-20260304-001
manifest_id: MUT-experiments-v1-to-v2-20260304-001
status: completed
started_on: 2026-03-04
completed_on: 2026-03-04
---

## Summary
Migration completed successfully for experiments v1 -> v2.

## Steps Executed
1. Updated experiment schema to include `budget` and funding statuses.
2. Updated experiments skill content to enforce funding lifecycle transitions.
3. Ran migration script `001_add_budget_and_funding_status.py` against experiment records.
4. Updated deployed router and module version metadata to v2.

## Record Outcomes
- updated: 4
- unchanged: 0
- failed: 0

## Notes
- Existing draft experiments received `budget: null`.
- Existing active experiments with no budget received placeholder `budget: 1000`.
- No experiment IDs or paths changed.
