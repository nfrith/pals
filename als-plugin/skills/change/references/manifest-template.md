# v1 Change Manifest Template

Use this template when `change` authors `.als/modules/<module_id>/vN+1/migrations/MANIFEST.md`.

This manifest describes a prepared module-version bundle.
It is authored by `change`.
It does not imply that live records or `.als/system.yaml` have already been migrated.

## Frontmatter Type Definition

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `manifest_id` | string | yes | stable unique id for this prepared change |
| `module_id` | string | yes | must match the ALS module id |
| `module_path` | string | yes | live module data path from `.als/system.yaml` |
| `skill_paths` | string[] | yes | full staged future active `vN+1` skill bundle paths; may be empty |
| `primary_migration_script` | string | yes | repo-root-relative path to the canonical executable migration artifact under `.als/modules/<module_id>/v<to>/migrations/` |
| `from_version` | integer | yes | active module version before cutover |
| `to_version` | integer | yes | must equal `from_version + 1` |
| `change_class` | enum | yes | `logic_only` \| `schema_only` \| `schema_and_logic` |
| `data_migration_required` | boolean | yes | `true` when live records must be transformed before cutover |
| `status` | enum | yes | `staged` \| `migrated` |
| `created_on` | date (`YYYY-MM-DD`) | yes | manifest creation date |
| `updated_on` | date (`YYYY-MM-DD`) | yes | last updated date |

## Frontmatter Template

```yaml
---
manifest_id: MUT-<module_id>-v<from>-to-v<to>-<yyyymmdd>-<seq>
module_id: <module_id>
module_path: <module-data-path>
skill_paths:
  - .als/modules/<module_id>/v<to>/skills/<skill-id>
primary_migration_script: .als/modules/<module_id>/v<to>/migrations/migrate_from_v<from>.py
from_version: <int>
to_version: <int>
change_class: <logic_only|schema_only|schema_and_logic>
data_migration_required: <true|false>
status: <staged|migrated>
created_on: <yyyy-mm-dd>
updated_on: <yyyy-mm-dd>
---
```

If the module declares `skills: []`, use:

```yaml
skill_paths: []
```

## Body Sections

Author these sections in this exact order:

1. `## Intent`
2. `## Wants`
3. `## Does Not Want`
4. `## Invariants`
5. `## Contra-Invariants`
6. `## Migration Constraints`
7. `## Current Module Understanding`
8. `## Schema Changes`
9. `## Behavior Changes`
10. `## Data Migration Plan`
11. `## Behavior Test Plan`
12. `## Cutover Gates`
13. `## Risks`
14. `## Sign-off`

## Section Expectations

- `Intent`: one short paragraph describing the point of the change.
- `Wants`: flat bullet list of desired outcomes.
- `Does Not Want`: flat bullet list of preserved behavior or explicit exclusions.
- `Invariants`: flat bullet list of rules that must continue to hold.
- `Contra-Invariants`: flat bullet list of retired or intentionally broken old rules.
- `Migration Constraints`: flat bullet list of rewrite constraints such as determinism, idempotence, fail-closed behavior, or preservation requirements.
- `Current Module Understanding`: describe the current entity surface, workflow surface, and any identity/reference conditions that matter to the change.
- `Schema Changes`: flat bullet list of concrete `shape.yaml` differences.
- `Behavior Changes`: flat bullet list of concrete skill-bundle or interface differences, or explicit statement that the skill bundle is unchanged.
- `Data Migration Plan`: flat bullet list of required live-data transformations, or explicit statement that no record rewrite is needed.
- `Behavior Test Plan`: flat bullet list of checks the later migration/cutover flow should prove.
- `Cutover Gates`: flat bullet list of conditions that must be true before `.als/system.yaml` can point at `to_version` and the matching future `skills:` set.
- `Risks`: flat bullet list of known migration or semantic risks, or explicit statement that no unusual risk is known.
- `Sign-off`: operator approval summary with approval date and any important notes.

## Authoring Rules

- `change` authors this manifest from scratch for `vN+1`; it does not copy the previous manifest.
- `skill_paths` is the authoritative staged future active skill set for `vN+1`.
- `migrate` later copies `skill_paths` into the module's live `.als/system.yaml` `skills:` when the cutover lands.
- `primary_migration_script` must point at a file inside the target bundle's `migrations/` directory.
- `status: staged` means the next bundle is prepared and committed but the live system has not cut over.
- `status: migrated` is reserved for later migration tooling once live records and the active version have actually moved.
- All ambiguities must be resolved before the manifest is written.
- Do not add `open_questions`.
- Do not use singular `skill_path`; ALS v1 modules may have multiple active skills or none.
