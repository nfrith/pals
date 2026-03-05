---
module_id: experiments
namespace: workspace
uri_scheme: pals
module_version: 2
schema_version: 2
---

# Experiments Module

## Ownership

- Owns program, experiment, and run records under this module directory.
- External modules reference experiment entities via `pals://workspace/experiments/...` only.

## Invariants

1. `id` is required in frontmatter for every record.
2. Filename stem must equal frontmatter `id`.
3. `id` is immutable after creation except through explicit migration workflow.
4. Duplicate `id` values within module scope are forbidden.
5. Parent-child hierarchy is encoded by containment path.
6. Child records must be stored under valid parent directories.

## Entity Paths

- Programs: `programs/<PROGRAM-ID>/<PROGRAM-ID>.md`
- Experiments: `programs/<PROGRAM-ID>/experiments/<EXPERIMENT-ID>/<EXPERIMENT-ID>.md`
- Runs: `programs/<PROGRAM-ID>/experiments/<EXPERIMENT-ID>/runs/<RUN-ID>.md`
