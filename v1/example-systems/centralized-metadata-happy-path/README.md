# Centralized Metadata Happy Path

This fixture is an alternate clean PALS-style system built from the same domain data as `pristine-happy-path`, but with a different metadata placement strategy.

## What Changed

1. Authoritative module shape metadata lives under `.pals/`.
2. The system registry declares reusable top-level mounts such as `workspace/` and `clients/`.
3. Module shapes use `mount + path` instead of a single baked-in root string.
4. Module shape files use explicit object-shaped contracts intended to be authored by agents, not terse human shorthand.

## Intent

Use this fixture to evaluate a middle path between:

1. Per-directory metadata (`MODULE.md` + `.schema/` everywhere).
2. One giant whole-system contract file.

This model centralizes metadata at the system root, but keeps ownership module-scoped with one versioned shape file per module version.

## Layout

1. `.pals/system.yaml`
2. `.pals/modules/<module>/vN.yaml`
3. `<declared-root>/<module-path>/...` data records

In this trimmed `v1` fixture, skill paths still exist as metadata in `.pals/system.yaml`, but the example-system-local skill files are intentionally omitted.

## Tradeoff This Fixture Is Testing

- Better: one obvious place to inspect system shape, lower schema duplication, cleaner data tree.
- Better: modules can be spread across multiple repo roots without changing canonical module identity.
- Better: section content rules are explicit enough for AST-based validation instead of loose `prose`/`list` heuristics.
- Worse: metadata is farther from records, and module edits usually touch `.pals/` plus skill content.
- Explicit non-goal: this fixture does not make one monolithic file authoritative for the entire system.
