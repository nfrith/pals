# Centralized Metadata Happy Path

This fixture is an alternate clean ALS-style system built from the same domain data as `pristine-happy-path`, but with a different metadata placement strategy.

## What Changed

1. Authoritative module shape metadata lives under `.als/`.
2. `.als/system.yaml` owns the single `system_id` for canonical ALS refs.
3. `.als/system.yaml` also declares one active `als_version` for the whole system.
4. Each module declares one explicit mount path relative to the system root, such as `workspace/backlog`, `clients/registry`, or `dotfiles`.
5. Shape files are inferred by convention as `.als/modules/<module-id>/v<version>/shape.yaml`.
6. Authored source YAML does not carry a separate top-level `schema` header.
7. Module shape files contain only module contents, not repeated registry metadata.
8. Canonical module skills live under the module version bundle rather than under a harness-specific directory.

## Intent

Use this fixture to evaluate a middle path between:

1. Per-directory metadata (`MODULE.md` + `.schema/` everywhere).
2. One giant whole-system contract file.

This model centralizes metadata at the system root, but keeps ownership module-scoped with one version bundle per module version.
ALS language upgrades are intended to cut over the whole system version, while module `version` remains the schema-evolution surface for module data.
The backlog module in this fixture also demonstrates discriminator-selected contracts: `type` changes both the allowed frontmatter fields and the required body sections.

## Layout

1. `.als/system.yaml`
2. `.als/modules/<module>/vN/shape.yaml`
3. `.als/modules/<module>/vN/skills/<skill>/SKILL.md`
4. `.als/modules/<module>/vN/migrations/` for `N > 1`
5. `.claude/skills/<skill>/SKILL.md` as the checked-in downstream Claude projection
6. `<module-path>/...` data records

This fixture now treats `.als/` as the canonical source for module skills and checks in `.claude/skills/` as the downstream Claude projection.

## Tradeoff This Fixture Is Testing

- Better: one obvious place to inspect system shape, lower schema duplication, cleaner data tree.
- Better: a single `system_id` owns canonical identity, while module paths describe file placement directly.
- Better: existing directory trees can be adopted incrementally without inventing extra placement metadata.
- Better: the backlog example shows one entity shape with shared identity plus variant-local frontmatter and variant-local section sets.
- Better: section content rules are explicit enough for AST-based validation instead of loose `prose`/`list` heuristics.
- Worse: metadata is farther from records, and module edits usually touch `.als/` plus skill content.
- Explicit non-goal: this fixture does not make one monolithic file authoritative for the entire system.
