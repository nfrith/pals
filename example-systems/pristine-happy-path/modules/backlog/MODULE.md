---
module_id: backlog
namespace: section9
uri_scheme: pals
module_version: 1
schema_version: 1.0
compat:
  read_versions: [1]
  write_version: 1
---

# Backlog Module

## Ownership

- Owns epic and story records under this module directory.
- External modules reference backlog entities via `pals://section9/backlog/...` only.

## Invariants

1. Stories must reference an epic.
2. IDs are opaque and stable.
3. Required sections must exist in every record.

## Entity Paths

- Epics: `epics/<EPIC-ID>.md`
- Stories: `stories/<STORY-ID>.md`
