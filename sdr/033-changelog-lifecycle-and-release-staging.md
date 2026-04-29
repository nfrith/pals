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
- The ALS factory lifecycle inserts three states between `uat` and `done`:
  - `changelog` (agent) — stages the classification and entry
  - `changelog-gate` (agent) — validates and routes
  - `changelog-input` (operator, conditional) — operator review only when the gate flags doubt
- The `changelog` agent is responsible for:
  - reading the shipped change
  - proposing `compatibility_classes`
  - staging the matching `### ALS-XXX` entry under `## [Unreleased]`
  - advancing the job to `status: changelog-gate`
- The `changelog-gate` agent is responsible for:
  - running `alsc changelog inspect` to validate structural correctness
  - reading the staged entry against policy (concrete summary, explicit operator action, real affected surfaces, class list matching the diff)
  - routing to `done` when the entry is clean and unambiguous (the default path)
  - routing to `changelog-input` when the gate has genuine doubt about the staged data
  - rework back to `changelog` when `alsc changelog inspect` fails
- Operator review at `changelog-input` is conditional, not mandatory. The gate's default action for clean entries is direct advance to `done`. The architect supplies human-in-the-loop oversight on this routing — if the gate over- or under-routes, the gate prompt evolves.
- A job may not advance to `done` unless:
  - `compatibility_classes` is a non-empty list
  - `CHANGELOG.md` contains the matching `### ALS-XXX` entry under `## [Unreleased]`
  - `alsc changelog inspect` passes
- While the job is in `status: changelog-input`, the operator may edit either the class list or the staged entry before advancing to `done` or reworking back to `changelog`.
- `/release-prep` is the architect-run release-cut workflow. It validates the staging area, computes the release headline class, prompts for version/date, promotes `## [Unreleased]` into the next numbered section, and restores an empty `## [Unreleased]`.

## Normative Effect

- Required: `CHANGELOG.md` follows the fixed markdown structure exactly.
- Required: changelog validation uses `alsc changelog inspect`.
- Required: the ALS factory workflow passes through `status: changelog` and `status: changelog-gate` before `done`.
- Required: operator review at `status: changelog-input` is conditional — entered only when the gate routes there. Clean classifications skip operator review.
- Required: advancing to `done` is blocked when the staged changelog contract is missing or invalid.
- Required: each state in the lifecycle has exactly one actor (`agent` or `operator`). A single hybrid state is structurally invalid against the dispatcher.
- Allowed: `## [Unreleased]` to be empty between releases.
- Allowed: the operator to edit the staged entry or class list while the job is in `status: changelog-input` before advancing to `done`.
- Rejected: free-form changelog prose with no machine-checkable entry structure.
- Rejected: validating repo changelog structure through operator-side `alsc validate`.
- Rejected: backfilling pre-2026-04-29 history into the new structured format.
- Rejected: a single hybrid `changelog` state that runs the agent first and then waits for operator review. ALS state actor-typing forbids this — the dispatcher would re-dispatch the agent every tick.

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

- Always require operator review at `changelog-input` after the agent stages.
- Rejected because the architect does not want to review every changelog entry. Most classifications are clean enough that mandatory review is review-theater. The gate-and-input pattern keeps `changelog-input` as a conditional escape hatch for genuine ambiguity, while clean entries advance directly to `done`.

- Implement operator review inside the agent-owned `changelog` state itself (single hybrid state).
- Rejected because ALS state actor-typing requires each state to have exactly one actor. A hybrid state where an agent runs first and then waits for operator review would cause infinite re-dispatch — the dispatcher reads HEAD and re-dispatches the state's actor every tick, with no notion of "the agent already finished, this is now waiting for operator." This was the original shape proposed in the planner's PLAN, identified as broken late in dev review, and corrected via hot-patch on 2026-04-29 before ALS-058 reached prd. The lesson is captured here so future state-graph designs default to the gate-and-input pair when "agent does work, operator may review" is the desired shape.

## Non-Goals

- Automatic version bumping, git tagging, or marketplace publishing.
- Migrating old free-form historical releases into the structured format.
