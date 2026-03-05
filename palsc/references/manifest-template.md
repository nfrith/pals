# MANIFEST.md Template

## Frontmatter Type Definition

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `manifest_id` | string | yes | stable unique id for this mutation/migration |
| `module_id` | string | yes | must match module `MODULE.md` `module_id` |
| `module_path` | string | yes | module workspace path, e.g. `workspace/experiments` |
| `skill_path` | string | yes | module skill path, e.g. `.claude/skills/experiments-module` |
| `from_version` | integer | yes | deployed module version before migration |
| `to_version` | integer | yes | must equal `from_version + 1` |
| `change_class` | enum | yes | `logic_only` \| `schema_only` \| `schema_and_logic` |
| `data_migration_required` | boolean | yes | `true` when existing records must be transformed |
| `status` | enum | yes | `draft` \| `approved` \| `ready-for-migrate` \| `migrated` \| `aborted` |
| `created_on` | date (`YYYY-MM-DD`) | yes | manifest creation date |
| `updated_on` | date (`YYYY-MM-DD`) | yes | last updated date |

## Frontmatter Template

```yaml
---
manifest_id: MUT-<module_id>-v<from>-to-v<to>-<yyyymmdd>-<seq>
module_id: <module_id>
module_path: workspace/<module_id>
skill_path: .claude/skills/<module-skill-dir>
from_version: <int>
to_version: <int>
change_class: <logic_only|schema_only|schema_and_logic>
data_migration_required: <true|false>
status: <draft|approved|ready-for-migrate|migrated|aborted>
created_on: <yyyy-mm-dd>
updated_on: <yyyy-mm-dd>
---
```

## Mutate Outputs

- `intent`: <string>
- `wants`: <list>
- `does_not_want`: <list>
- `invariants`: <list>
- `contra_invariants`: <list>
- `constraints`: <list>
- `schema_changes`: <list or `null`>
- `behavior_changes`: <list or `null`>
- `data_migration_plan`: <list or `null`>
- `behavior_test_plan`: <list or `null`>
- `cutover_gates`: <list>
- `risks`: <list or `null`>
- `open_questions`: <list or `null`>
- `sign_off`: <summary or `null`>
