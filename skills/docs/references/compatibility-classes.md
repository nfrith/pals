# Compatibility Classes

Reference for ALS release-compatibility classification.

## Canonical Contract

The canonical class vocabulary lives in `alsc/compiler/src/contracts.ts`.

The public contract exported there is:
- `COMPATIBILITY_CLASSES`
- `CompatibilityClass`
- `COMPATIBILITY_CLASS_METADATA`
- `COMPATIBILITY_CLASS_RELEASE_HEADLINE_ORDER`

## Classes

| Class | Meaning | Operator action required? |
|-------|---------|---------------------------|
| `docs_only` | docs or wording changed with no contract or runtime impact | no |
| `refresh_required` | bundled operator surface changed and the operator must rerun deploy or an installer skill | yes |
| `additive` | new capability landed and existing authored systems stay valid | no |
| `migration_required` | authored source or live data must change and a guided path ships with the release | yes |
| `breaking_without_path` | existing systems can break and no guided path ships | yes |

## Precedence

When ALS needs one release headline for many jobs, it chooses the most disruptive class present in the release:

1. `breaking_without_path`
2. `migration_required`
3. `refresh_required`
4. `additive`
5. `docs_only`

This precedence is for release summarization only. Jobs and changelog entries keep their raw class lists.

## How ALS Uses The Classes

- ALS factory jobs store the raw list in `compatibility_classes`.
- `CHANGELOG.md` entries repeat the raw list under `- Compatibility: ...`.
- `/release-prep` collapses the release-level headline through the canonical precedence order.

## Deprecation Interaction

Deprecation uses the same compatibility vocabulary:
- announcing a new deprecation is `additive`
- removing a previously deprecated construct uses the compat class of the actual removal
- `breaking_without_path` should be reserved for removals that had a prior deprecation announcement whenever possible

The warning and lifecycle contract behind that policy lives in [Deprecation and Warnings](./deprecation-and-warnings.md).
