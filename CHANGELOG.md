# Changelog

All notable changes to ALS preview releases should be recorded here.

## 0.1.0-beta.28 - 2026-04-26

- **ALS-046 — operator-config.** Added `/operator-config` skill, the typed operator profile schema, the `operator-config-session-start` hook (registered in `plugin.json` so the operator profile is injected as a `<system-reminder>` on every session start when a valid config exists), and the bootup migration that renames legacy `.als/config.md` to `.als/bootup.md`. Sensitive-data boundary documented in `skills/docs/references/operator-config.md` — credentials must not be stored in `operator.md`.
- **ALS-042 — codex auto_review approvals.** Added the per-OpenAI-agent `approvals-reviewer` frontmatter knob, validator pairing rule (`approvals-reviewer: auto_review` requires interactive `approval-policy`), kebab→camel reader through the dispatcher, and the `new Codex({ config: { approvals_reviewer: "auto_review" } })` constructor wiring. Documented the two-knob contract, no-default-flip posture, disable behavior, OpenAI-only scope, and Reading-A-only acceptance scope in `skills/docs/references/delamain-dispatcher.md`. Existing `approval-policy: never` prompts are intentionally unchanged.
- **ALS-048 — dashboard journey graph z-index fix.** Edges now render above nodes via per-edge `zIndex: 1` in `delamain-dashboard/src/journey.ts` (both direct and aggregated emission paths). Removed dead `.xyflow-*` CSS rules in `src/client/styles.css`. Added regression assertions in `src/journey.test.ts`.
- **ALS-049 — dashboard journey graph cockpit-clean edge routing (in flight, regression-pending).** Shipped a layout-aware custom edge router (`delamain-dashboard/src/client/journey-routing.ts`) with per-edge-class motion differentiation (rework U-turn through gutter, advance smooth bezier, exit straight-through-top-channel) plus geometric unit tests. Geometric routing math passes unit tests + offline raster verification but **regresses live React Flow edge rendering** (operator UAT 2026-04-26: edges almost completely missing on `/journey/<delamain>` views). Currently in dev rework. Operators on this beta should expect the journey graphs to render nodes correctly but to be effectively edge-less until the next beta.
- **ALS-047 — pulse statusline producer.** Hardening pass on the pulse background data producer to address repeated exit-0 termination during normal sessions.
- **ALS-029 — codex onToolUse hook fix.** The dispatcher's codex onToolUse filter no longer rejects every real codex tool name.

## Unreleased

- Split Delamain dispatcher budget caps by provider with `limits.maxBudgetUsdByProvider`, canonical defaults of `$50` for OpenAI and `$20` for Anthropic, and backward-compatible expansion of legacy scalar `maxBudgetUsd` to both providers.
- Added explicit Delamain agent `provider` declarations (`anthropic` or `openai`), removed the old `delegated` state shape, and taught the dispatcher/runtime manifest to dispatch through provider-native SDK adapters with provider-aware logging and OpenAI turn/budget accounting.
- Accepted and documented SDR 028 for Delamain agent providers, superseding SDR 021's delegated-state model.
- Added per-Delamain dispatcher `limits` projection through `runtime-manifest.config.json` → `runtime-manifest.json`, so `maxTurns`, legacy `maxBudgetUsd`, and provider-specific `maxBudgetUsdByProvider` survive `alsc deploy` without hand-patching deployed dispatcher source. There is still no operator-local override layer in this release.
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
