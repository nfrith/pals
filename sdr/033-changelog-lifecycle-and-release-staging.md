# Changelog Lifecycle and Release Staging

## Status

Accepted

## Context

- `nfrith-repos/als/CHANGELOG.md` was free-form prose with mixed release history and no structural validator.
- The ALS factory lifecycle ended at `uat -> done`, so no state owned the compatibility classification step or the release-note staging step.
- `CHANGELOG.md` is an ALS development artifact, not an operator-authored system artifact, so operator-side `alsc validate` is the wrong audience for its validation surface.
- Release-cut work still needs a repeatable way to promote staged entries into a numbered release section without backfilling legacy history.

## Decision

- `CHANGELOG.md` is an ALS-managed SDLC artifact with a fixed markdown contract:
  - `# Changelog`
  - `For pre-2026-04-29 release history, see git tags.`
  - `## [Unreleased]`
  - repeated `### ALS-XXX` entries, each with exactly:
    - `- Compatibility: ...`
    - `- Summary: ...`
    - `- Operator action: ...`
    - `- Affected surfaces: ...`
- Numbered release sections reuse the same `### ALS-XXX` entry shape under `## <version> - YYYY-MM-DD`.
- Historical entries before `2026-04-29` are not backfilled. The pointer line is the entire legacy bridge.
- CHANGELOG validation lives under the SDLC-side command `alsc changelog inspect`, not under operator-side `alsc validate`.
- The ALS factory lifecycle inserts a `changelog` state between `uat` and `done`.
- The `changelog` agent is responsible for:
  - reading the shipped change
  - proposing `compatibility_classes`
  - staging the matching `### ALS-XXX` entry under `## [Unreleased]`
  - leaving the job at `status: changelog` for operator review
- The operator may override either the class list or the staged entry while the job remains in `status: changelog`.
- A job may not advance from `changelog` to `done` unless:
  - `compatibility_classes` is a non-empty list
  - `CHANGELOG.md` contains the matching `### ALS-XXX` entry under `## [Unreleased]`
  - `alsc changelog inspect` passes
- `/release-prep` is the architect-run release-cut workflow. It validates the staging area, computes the release headline class, prompts for version/date, promotes `## [Unreleased]` into the next numbered section, and restores an empty `## [Unreleased]`.

## Normative Effect

- Required: `CHANGELOG.md` follows the fixed markdown structure exactly.
- Required: changelog validation uses `alsc changelog inspect`.
- Required: the ALS factory workflow passes through `status: changelog` before `done`.
- Required: the operator review for changelog staging happens inside `status: changelog`, not in a separate `changelog-input` state.
- Required: advancing to `done` is blocked when the staged changelog contract is missing or invalid.
- Allowed: `## [Unreleased]` to be empty between releases.
- Allowed: the operator to edit the staged entry or class list before `done`.
- Rejected: free-form changelog prose with no machine-checkable entry structure.
- Rejected: validating repo changelog structure through operator-side `alsc validate`.
- Rejected: backfilling pre-2026-04-29 history into the new structured format.

## Compiler Impact

- Add a dedicated changelog inspection/parser module and expose it through `alsc changelog inspect`.
- Keep changelog validation separate from the operator-facing system validator.
- Tests must cover:
  - valid zeroed baseline
  - valid structured entries
  - malformed compatibility lists
  - missing required labeled fields

## Docs and Fixture Impact

- Zero `nfrith-repos/als/CHANGELOG.md` to the accepted baseline.
- Update `version-policy.md` to document the staged `## [Unreleased]` flow and release-headline collapse rule.
- Update `architect-flow.md` to require `/release-prep` before the release version bump.
- Update ALS factory workflow prompts and console guidance to include `status: changelog` and the `done` guard.

## Alternatives Considered

- Put changelog validation under `alsc validate`.
- Rejected because `CHANGELOG.md` is SDLC-side release infrastructure, not an operator-authored ALS system artifact.

- Add a separate `changelog-input` operator state after the agent state.
- Rejected because operator override is local to the staged class list and entry; keeping it inside `status: changelog` is simpler and preserves one review slot.

## Non-Goals

- Automatic version bumping, git tagging, or marketplace publishing.
- Migrating old free-form historical releases into the structured format.
