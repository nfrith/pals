# Module Version Bundles And Canonical Skills

## Status

Accepted

## Context

- ALS v1 initially modeled module shapes as flat files at `.als/modules/<module_id>/vN.yaml`.
- Skill and migration work returned to scope later, and the flat shape-file layout no longer provides a coherent place for versioned skill bundles or inbound migration assets.
- Rich-body fixture work showed a cleaner model: each module version is a bundle that can hold shape, skills, and migration material together.
- ALS needs one canonical source location for module skills. Harness-specific projections such as `.claude/` should not be the authored source of truth.

## Decision

- ALS v1 module versions are directory bundles under `.als/modules/<module_id>/vN/`.
- Each required module version bundle must contain `shape.yaml`.
- `.als/system.yaml` replaces singular `skill` with `skills`.
- `skills` is a module-local array of active skill ids for the module's active version and may be empty.
- Skill ids use the same kebab-case slug grammar as module ids and map directly to directory names under `vN/skills/`.
- Active skill entrypoints live at `.als/modules/<module_id>/vN/skills/<skill_id>/SKILL.md`.
- Extra files inside a listed skill directory are allowed.
- Unlisted skill directories under the active `vN/skills/` directory are invalid.
- A module declared at active `version: N` must have contiguous version-bundle history from `v1` through `vN`.
- Every bundle `vK` where `K > 1` must contain inbound migration assets at `vK/migrations/`.
- Required migration assets for `vK/migrations/` are:
  - `MANIFEST.md`
  - at least one additional file besides `MANIFEST.md`
- Bundles above the active version may exist as staged future work. Default ALS validation ignores them.
- ALS validation in this phase is structural only for skills and migrations. It does not parse `SKILL.md` contents or migration-manifest semantics.

## Normative Effect

- Required: `.als/system.yaml` must declare `skills`, not `skill`, for every module.
- Required: every module's active version must resolve to `.als/modules/<module_id>/vN/shape.yaml`.
- Required: active module history must be contiguous from `v1` through the declared active version.
- Required: every required bundle `vK` where `K > 1` must contain `migrations/MANIFEST.md` plus at least one additional migration artifact.
- Required: if `skills` is non-empty, the active bundle must contain `skills/<skill_id>/SKILL.md` for every listed skill id.
- Allowed: `skills: []`.
- Allowed: omitting `vN/skills/` entirely when `skills: []`.
- Allowed: future bundles above the active version for staged upgrade work.
- Allowed: extra files inside a listed skill directory.
- Rejected: singular `skill` in ALS v1 system configuration.
- Rejected: flat active shape lookup at `.als/modules/<module_id>/vN.yaml`.
- Rejected: gaps in required active version history such as `v1` and `v3` without `v2`.
- Rejected: unlisted skill directories inside the active `skills/` directory.
- Rejected: treating harness projection directories as the canonical authored source of module skills.

## Compiler Impact

- Update system config parsing to require `skills: string[]`.
- Update inferred active shape resolution to `.als/modules/<module_id>/vN/shape.yaml`.
- Add structural validation for required bundle history, active skill entrypoints, and required migration assets.
- Reject duplicate skill ids in a module's `skills` array.
- Keep validation structural for skills and migrations in this phase.

## Docs and Fixture Impact

- Update the canonical shape-language reference to document `skills`, version bundles, and required migration assets.
- Update authoring guidance so new systems and modules are created with version-bundled `shape.yaml` and `skills/`.
- Update all example systems to the bundled layout and canonical in-ALS skill source model.
- Update compiler docs and tests to cover the new bundle layout, empty `skills`, migration-asset minimums, and rejection of stale `skill`.

## Alternatives Considered

- Keep flat `vN.yaml` shapes and add parallel ad hoc skill and migration paths.
- Rejected because it splits one module version across multiple top-level conventions.
- Keep skills canonical in `.claude/` or other harness directories.
- Rejected because harness-specific projections are downstream delivery targets, not ALS-authored source.
- Infer the active skill set by scanning `vN/skills/`.
- Rejected because ALS should treat `skills` in `system.yaml` as the explicit active interface rather than making filesystem contents authoritative by accident.
