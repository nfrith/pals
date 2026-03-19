# Centralized Metadata Happy Path

This fixture is an alternate clean ALS-style system built from the same domain data as `pristine-happy-path`, but with a different metadata placement strategy.

## What Changed

1. Authoritative module shape metadata lives under `.als/`.
2. `.als/system.yaml` owns the single `system_id` for canonical ALS refs.
3. Each module declares one explicit mount path relative to the system root, such as `workspace/backlog`, `clients/registry`, or `dotfiles`.
4. Shape files are inferred by convention as `.als/modules/<module-id>/v<version>.yaml`.
5. Module shape files contain only module contents, not repeated registry metadata.

## Intent

Use this fixture to evaluate a middle path between:

1. Per-directory metadata (`MODULE.md` + `.schema/` everywhere).
2. One giant whole-system contract file.

This model centralizes metadata at the system root, but keeps ownership module-scoped with one versioned shape file per module version.

## Layout

1. `.als/system.yaml`
2. `.als/modules/<module>/vN.yaml`
3. `<module-path>/...` data records

In this trimmed `v1` fixture, skill paths still exist as metadata in `.als/system.yaml`, but the example-system-local skill files are intentionally omitted.

## Tradeoff This Fixture Is Testing

- Better: one obvious place to inspect system shape, lower schema duplication, cleaner data tree.
- Better: a single `system_id` owns canonical identity, while module paths describe file placement directly.
- Better: existing directory trees can be adopted incrementally without inventing extra placement metadata.
- Better: section content rules are explicit enough for AST-based validation instead of loose `prose`/`list` heuristics.
- Worse: metadata is farther from records, and module edits usually touch `.als/` plus skill content.
- Explicit non-goal: this fixture does not make one monolithic file authoritative for the entire system.
