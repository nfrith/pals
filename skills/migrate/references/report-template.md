# v1 Migration Report Template

Use this template when `migrate` authors or updates `.als/modules/<module_id>/vN+1/migrations/REPORT.md`.

This report records dry-run and live cutover execution for one staged module-version bundle.
It is owned by `migrate`.

## Frontmatter Type Definition

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `report_id` | string | yes | stable unique id for this migration execution report |
| `manifest_id` | string | yes | must match the staged manifest id |
| `module_id` | string | yes | must match the ALS module id |
| `module_path` | string | yes | live module data path from `.als/system.ts` |
| `from_version` | integer | yes | live module version before cutover |
| `to_version` | integer | yes | target bundle version |
| `primary_migration_script` | string | yes | repo-root-relative path to the canonical executable migration artifact |
| `clone_result` | enum | yes | `pending` \| `passed` \| `failed` \| `skipped` |
| `live_result` | enum | yes | `not_started` \| `passed` \| `failed` |
| `created_on` | date (`YYYY-MM-DD`) | yes | report creation date |
| `updated_on` | date (`YYYY-MM-DD`) | yes | last updated date |

## Frontmatter Template

```yaml
---
report_id: MREP-<module_id>-v<from>-to-v<to>-<yyyymmdd>-<seq>
manifest_id: MUT-<module_id>-v<from>-to-v<to>-<yyyymmdd>-<seq>
module_id: <module_id>
module_path: <module-data-path>
from_version: <int>
to_version: <int>
primary_migration_script: .als/modules/<module_id>/v<to>/migrations/migrate_from_v<from>.py
clone_result: <pending|passed|failed|skipped>
live_result: <not_started|passed|failed>
created_on: <yyyy-mm-dd>
updated_on: <yyyy-mm-dd>
---
```

## Body Sections

Author these sections in this exact order:

1. `## Intent Snapshot`
2. `## Preflight`
3. `## Clone Dry Run`
4. `## Behavior Checks`
5. `## Live Cutover`
6. `## Outcome`
7. `## Notes`

## Section Expectations

- `Intent Snapshot`: short paragraph restating the migration purpose and scope.
- `Preflight`: flat bullet list covering baseline validation, manifest validation, and git readiness.
- `Clone Dry Run`: flat bullet list summarizing clone location, script outcome, validation outcome, and record counts, or explicit statement that the clone phase was skipped.
- `Behavior Checks`: flat bullet list of checklist items or executed commands and their outcomes.
- `Live Cutover`: flat bullet list covering live script execution, version and `skills:` flip, Claude projection, and rollback if it happened.
- `Outcome`: flat bullet list summarizing manifest status, final live status, and resulting commit message when successful.
- `Notes`: flat bullet list of operator decisions, preserved failure clones, or unusual observations, or explicit statement that there are no extra notes.

## Authoring Rules

- `migrate` owns this file; `change` does not pre-create it.
- One `REPORT.md` tracks both clone and live phases for a given `vN+1` bundle.
- If `data_migration_required: false`, use `clone_result: skipped`.
- If live cutover has not started yet, use `live_result: not_started`.
- On successful cutover, `MANIFEST.md` and `REPORT.md` must be updated together in the cutover commit.
- Do not add `open_questions`.
