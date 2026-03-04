---
module_id: people
namespace: workspace
uri_scheme: pals
module_version: 0
schema_version: 0
---

# People Module

## Ownership

- Owns person records under this module directory.
- External modules reference people entities via `pals://workspace/people/...` only.

## Invariants

1. `id` is required in frontmatter for every record.
2. Filename stem must equal frontmatter `id`.
3. `id` is immutable after creation except through explicit migration workflow.
4. Duplicate `id` values within module scope are forbidden.

## Entity Paths

- Persons: `persons/<PERSON-ID>.md`
