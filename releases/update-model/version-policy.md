# Version Policy

This is the compatibility policy ALS should follow during the beta preview and the world-facing launch push.

## Preview Posture

- The Beta Research Preview label stays on.
- Exact version pinning is required.
- Breaking changes are allowed during preview, but they must never be silent.
- Every published release must classify operator impact and required action.

## Compatibility Classes

| Class | Meaning | Acceptable for the public launch push? |
|-------|---------|----------------------------------------|
| `docs_only` | docs or wording changed; no contract or runtime impact | yes |
| `refresh_required` | bundled operator surface changed; operator must rerun deploy or an installer skill | yes, if the required action is explicit |
| `additive` | new capability landed and existing authored systems stay valid | yes |
| `migration_required` | authored source or live data must change; a guided path must ship with the release | yes, only if the path ships in the same release |
| `breaking_without_path` | existing systems can break and no guided path ships | no |

## Breaking Rules By Artifact

| Artifact | Treat as breaking when... | Minimum release requirement |
|----------|---------------------------|-----------------------------|
| `als_version` | the language epoch changes | `migration_required` with hop-by-hop tooling |
| module shapes and bodies | a required field/section is added, removed, renamed, or retyped | `migration_required` |
| public identity | `system_id`, module ids, entity names, section names, or path-template lineage names change | `migration_required`, usually whole-system |
| projected skill or delamain ids | an active projected id is removed or renamed | at least `refresh_required`; `migration_required` if authored systems or workflows must change |
| hooks, statusline, dashboard launchers | existing installs need new copied assets or changed startup semantics | `refresh_required` with explicit operator action |
| machine-readable diagnostics/output | codes, schema, or consumer-visible semantics change | version the output contract or treat as `migration_required` for tooling consumers |

## Changelog Rules

`CHANGELOG.md` remains at repo root. This document defines how release entries should be written.

Every published release entry should:

1. identify the compatibility class for each notable change
2. state the required operator action for every `refresh_required` or `migration_required` change
3. call out affected surfaces clearly: authored source, projected `.claude/` assets, hooks, statusline, dashboard, Foundry, or diagnostics/tooling
4. avoid shipping `breaking_without_path` items under a world-facing public launch posture

## Current Gap

The current changelog records real work, but it does not yet apply this policy consistently. That is a release-process blocker, not just a documentation gap. The enforcement work is listed in `../launch/punchlist.md`.
