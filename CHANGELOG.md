# Changelog

All notable changes to ALS preview releases should be recorded here.

## Unreleased

- Added explicit Delamain agent `provider` declarations (`anthropic` or `openai`), removed the old `delegated` state shape, and taught the dispatcher/runtime manifest to dispatch through provider-native SDK adapters with provider-aware logging and OpenAI turn/budget accounting.
- Added per-Delamain dispatcher `limits` projection through `runtime-manifest.config.json` → `runtime-manifest.json`, so `maxTurns` / `maxBudgetUsd` survive `alsc deploy` without hand-patching deployed dispatcher source. Canonical fallback remains `50 / 10`, and there is still no operator-local override layer in this release.
- Relaxed the Delamain merge-back pre-flight dirty check on `systemRoot` to ignore submodule state (`--ignore-submodules=all`) so a mounted submodule advancing mid-dispatch no longer blocks integration before the ALS-020 refresh phase can reconcile it. Per-submodule primary clean checks are unchanged.
- Refreshed Delamain merge-back worktrees onto the current primary `HEAD` before integration, replaced cherry-pick replay with rebase plus `merge --ff-only`, and introduced preserved `stale_base_conflict` incidents for stale-base overlaps and force-push-below-base blocks.
- Added manifest-driven mounted submodule worktrees to the Delamain dispatcher runtime, including dual-repo audit trailers and atomic rollback on multi-repo merge-back failure.
- Added a new `/foundry` skill plus an empty `foundry/` ALS mini-system as the curated bundled source for end-user module installs.
- Retargeted `/install` to hand first-touch operators to `/foundry`.
- **Removed the `/install-reference` skill.** `reference-system/` remains in the repo as the ALS Architect's painting/fixture space but is no longer exposed as an installable shelf via a skill. End users use `/foundry`; the reference system is now authoring-space-only.
- Added required module `description` fields to `.als/system.ts` declarations and validation.
- Accepted and documented SDR 026 for system-level module descriptions and the hard-break migration.
- Added first-class Delamain support to the ALS compiler:
  - `type: delamain` fields bound through a module `delamains` registry
  - Delamain bundle loading, graph validation, and state-owned agent validation
  - implicit resumable `session-field` synthesis on effective entity schemas
- Accepted and documented SDR 018 and SDR 020 as the current Delamain contract.
- Merged the former `software-factory` example fixture into `reference-system/`, which now carries the Delamain design and compiler reference surface.
- Extended `alsc deploy claude` from skill-only projection to full Claude projection:
  - active skills still project to `.claude/skills/`
  - bound Delamain bundles now project to `.claude/delamains/`
  - deploy now reports Delamain target collisions and flat-name conflicts
- Added compiler and deploy test coverage for Delamain validation and Claude projection behavior.
- Changed Delamain dispatcher status polling to read committed `HEAD` state only, so unstaged and staged status edits no longer trigger dispatch; every operator transition must land in its own `delamain: <id> <from> → <to> [operator]` commit, and the dispatcher now warns when it detects a working-tree-only transition.

## 0.1.0-beta.1 - 2026-03-29

First public beta research preview.

- ALS distributed as a Claude Code plugin with validation and deploy skills
- `alsc validate` for ALS system validation with machine-readable JSON output
- `alsc deploy claude` for Claude skill projection
- PostToolUse hook validates affected module on file edits
- Stop hook gates Claude from finishing while validation errors remain
- explicit research-preview policy and contribution guidance
- CI workflow and structured GitHub issue templates

Compatibility note:

- authored-source compatibility is not guaranteed across preview releases
- manual rewrites may be required while ALS is still in preview

UAT smoke touch for ALS-026 — 2026-04-20
UAT smoke touch for ALS-026 — 2026-04-20
