# Centralized Metadata Happy Path

This fixture is an alternate clean PALS-style system built from the same domain data as `pristine-happy-path`, but with a different metadata placement strategy.

## What Changed

1. Authoritative module shape metadata lives under `.pals/`.
2. Workspace module directories contain records only.
3. Skill versions point at root-managed shape files instead of duplicating schema snapshots under each skill version.
4. Module shape files use explicit object-shaped contracts intended to be authored by agents, not terse human shorthand.

## Intent

Use this fixture to evaluate a middle path between:

1. Per-directory metadata (`MODULE.md` + `.schema/` everywhere).
2. One giant whole-system contract file.

This model centralizes metadata at the system root, but keeps ownership module-scoped with one versioned shape file per module version.

## Layout

1. `.pals/system.yaml`
2. `.pals/modules/<module>/vN.yaml`
3. `.claude/skills/<module>-module/...`
4. `workspace/<module>/...` data records

## Tradeoff This Fixture Is Testing

- Better: one obvious place to inspect system shape, lower schema duplication, cleaner data tree.
- Better: section content rules are explicit enough for AST-based validation instead of loose `prose`/`list` heuristics.
- Worse: metadata is farther from records, and module edits usually touch `.pals/` plus skill content.
- Explicit non-goal: this fixture does not make one monolithic file authoritative for the entire system.
