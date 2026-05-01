# ALS Update Transaction Wrapper Contract

## Status

Accepted

## Context

- `/update` already owns plugin refresh and the operator-facing follow-through flow, but no runtime module owns the transaction machinery that Phase 6 now assumes: staging-worktree creation, whole-worktree validation, single-commit writeback, cleanup, and post-commit lifecycle execution.
- ALS-066 shipped `alsc/upgrade-language/` and SDR 037, but the runner still executes live in a single phase, pauses mid-run for `operator-prompt` steps, and tells the standalone skill to deploy Claude assets only after a successful live run. That shape cannot participate in an all-or-nothing transaction with construct-upgrade.
- ALS-067 shipped `alsc/upgrade-construct/` and SDR 038. It already provides the staged preflight/execute split, deterministic `als-construct-action-manifest@1`, runtime-token rules, manifest concatenation order, and named lifecycle failure vocabulary that the wrapper must consume unchanged.
- `alsc deploy claude` is fail-closed at the command/result layer but not filesystem-atomic while it writes. That is acceptable only when projection happens inside a disposable staging worktree whose contents can be discarded wholesale on failure.
- ALS-067 UAT clarified that bundled-surface refresh belongs inside staging during validation. Treating `alsc deploy claude` as a separate post-commit phase would reintroduce an avoidable partial-failure surface.
- Pulse respawn remains outside ALS-067's action manifest. This job must finish the `/update` transaction contract without pretending pulse is already a construct participant.

## Decision

- ALS ships a first-class `/update` transaction wrapper under `alsc/` as the sole owner of staging-worktree lifecycle, pre-commit validation, single-commit writeback, and post-commit lifecycle execution.
- `/update` is the sole operator-facing transaction owner for plugin-refresh follow-through, language-upgrade, construct-upgrade, bundled-surface refresh, and the post-commit action-manifest pass.
- Before any staging worktree is created, `/update`:
  - validates the live system
  - determines the required language hop chain
  - runs language-upgrade preflight
  - runs construct-upgrade preflight
  - batches every returned operator prompt into one AskUserQuestion round
- `/update` refuses to start when the live system has tracked changes under `.als/` or `.claude/`.
- After the operator gate succeeds, `/update` creates exactly one detached staging worktree from the current `HEAD` and shares that same worktree across every execute pass in the transaction.
- The staging worktree lives beside the operator repo in an ALS-owned path. Successful runs remove it. Validation or commit failures preserve it for inspection and report the path. Later `/update` runs prune stale ALS-owned staging worktrees before creating a new one.
- `/upgrade-language` becomes a two-phase runtime contract without a recipe-schema bump:
  - `preflight` returns the exact `operator-prompt` steps that can fire for the selected hop chain and the chosen optional/recommended-step settings
  - `execute` receives a staging root plus pre-collected operator answers and never pauses for AskUserQuestion mid-run
  - `operator-prompt` steps in `category: "recovery"` are rejected by recipe inspection/loading and by the runner
- `als-language-upgrade-recipe@1` remains the authored recipe schema. The recovery-prompt ban is enforced as runner/compiler validation, not as a new authored field or `@2` bump.
- ALS-067 construct-upgrade contracts are consumed unchanged. Construct preflight returns prompts. Construct execute mutates only the staging `.als/` tree and emits `als-construct-action-manifest@1`.
- Inside the shared staging worktree, `/update` runs language execute first and construct execute second. Both may mutate only staged `.als/`.
- Validation is one combined pre-commit phase:
  - `alsc validate` against the staged system
  - `alsc deploy claude` without `--dry-run`, projecting staged `.als/` into staged `.claude/`
  - manifest-shape and execute-result checks required by the participating engines
- The projection step is the bundled-surface refresh. It happens inside staging during validation, not as a separate post-commit phase.
- After successful validation, `/update` creates exactly one git commit for the run. That commit includes both staged `.als/` and staged `.claude/`. Its body records the applied language hop chain and any construct version deltas.
- After commit succeeds, `/update` concatenates construct action manifests in ALS-067's required order and executes them sequentially.
- Runtime-token substitution rules, manifest concatenation order, action kinds, lifecycle strategies, and lifecycle failure vocabulary from SDR 038 are consumed unchanged.
- The wrapper exposes exactly three top-level failure surfaces:
  - `validation-deploy-failed`
  - `commit-failed`
  - `lifecycle-failed`
- When `lifecycle-failed` occurs, the wrapper also reports the specific ALS-067 lifecycle state:
  - `lifecycle-drain-stalled`
  - `lifecycle-stop-failed`
  - `lifecycle-start-failed`
  - `lifecycle-partial`
- Pre-commit failures leave the live system unchanged and preserve the staging worktree for inspection. Post-commit lifecycle failures leave the committed filesystem in place and inherit ALS-067's fix-forward support posture.
- Pulse respawn is not part of the v1 action manifest. If statusline data goes stale after an update, the operator may still need `/bootup` or `/reboot` as a manual follow-up.

## Normative Effect

- Required: `/update` owns one transaction boundary for language-upgrade, construct-upgrade, bundled-surface refresh, commit, and post-commit lifecycle.
- Required: `/update` batches every language and construct prompt into one operator gate before it creates a staging worktree.
- Required: `/update` rejects runs with tracked live changes under `.als/` or `.claude/`.
- Required: the wrapper creates exactly one detached staging worktree per run and shares it across every execute participant.
- Required: successful runs remove the staging worktree; validation or commit failures preserve it and report its path; later runs prune stale ALS-owned staging worktrees first.
- Required: `/upgrade-language` exposes `preflight` and `execute` runtime entrypoints instead of a single live-mutation phase.
- Required: language execute consumes pre-collected answers and does not pause for AskUserQuestion mid-run.
- Required: `operator-prompt` steps in `category: "recovery"` are rejected while `als-language-upgrade-recipe@1` remains the schema version.
- Required: ALS-067 construct-upgrade manifests, runtime tokens, ordering rules, and lifecycle vocabulary stay unchanged.
- Required: language execute runs before construct execute inside the shared staging worktree.
- Required: validation includes both `alsc validate` and real `alsc deploy claude` against the staged system.
- Required: bundled-surface refresh occurs inside staging during validation, before commit.
- Required: `/update` produces exactly one git commit per successful run.
- Required: the update commit body records the applied language hop chain and construct version deltas.
- Required: `/update` exposes the three top-level failure surfaces `validation-deploy-failed`, `commit-failed`, and `lifecycle-failed`.
- Required: `lifecycle-failed` also carries one of ALS-067's named lifecycle states.
- Required: pre-commit failures leave the live system unchanged.
- Required: post-commit lifecycle failures follow fix-forward recovery rather than rollback.
- Allowed: unrelated live repo changes outside `.als/` and `.claude/` to remain untouched by the start gate.
- Allowed: the standalone `/upgrade-language` operator skill to reuse the same two-phase runner contract outside `/update`, as long as it does not reintroduce mid-execute operator prompts.
- Rejected: keeping language-upgrade as a single-phase live exception inside `/update`.
- Rejected: creating one operator gate per engine or per hop.
- Rejected: creating separate staging worktrees for language-upgrade and construct-upgrade in the same `/update`.
- Rejected: running `alsc deploy claude` as a separate post-commit phase.
- Rejected: rollback as part of the public contract.

## Compiler Impact

- Add a dedicated `/update` transaction-wrapper runtime module under `alsc/` that owns:
  - staging-worktree creation, pruning, preservation, and cleanup
  - the dirty-tree precondition
  - prompt batching across language-upgrade and construct-upgrade
  - pre-commit validation plus bundled-surface refresh
  - one-commit writeback
  - top-level failure reporting
  - post-commit action-manifest execution
- Update `alsc/upgrade-language/` so the runner exposes separate `preflight` and `execute` entrypoints, with execute consuming a pre-collected operator-answer map.
- Add validation in the language-upgrade recipe loader/inspector and runner that rejects `operator-prompt` steps in `category: "recovery"` without changing the authored recipe schema literal.
- Reuse existing `alsc validate`, `alsc deploy claude`, and ALS-067 action-manifest validation contracts unchanged instead of creating a wrapper-owned schema family.
- Keep ALS-067 compiler surfaces read-only from this job's perspective: no new construct action kinds, runtime tokens, lifecycle strategies, or failure-state literals.

## Docs and Fixture Impact

- `skills/update/SKILL.md` must defer transaction semantics to this SDR instead of carrying provisional Phase 6 behavior as skill-owned truth.
- `skills/upgrade-language/SKILL.md` must describe the two-phase runner shape and stop teaching mid-execute AskUserQuestion pauses as the contract.
- `language-upgrades/CLAUDE.md` and any related reference docs must stay aligned with the no-mid-execute-prompt contract and the recovery-prompt ban.
- `skills/docs/references/vocabulary.md` must add canonical entries for:
  - transaction wrapper
  - staging worktree
  - bundled-surface refresh
- Add fixture and test examples for:
  - one batched operator gate spanning language and construct prompts
  - rejected `operator-prompt` + `category: recovery` recipes
  - combined validation-plus-deploy failure before commit
  - preserved staging-worktree reporting on pre-commit failure
  - one-commit update summaries listing hop and construct deltas
  - the known pulse manual-follow-up note after statusline-affecting updates

## Alternatives Considered

- Keep `/upgrade-language` single-phase and let `/update` special-case live prompts.
- Rejected because it preserves the half-upgraded failure mode this job exists to remove.

- Run `alsc deploy claude` after commit as a separate phase.
- Rejected because staged projection already matches ALS-067's UAT-proven flow and keeps projection failures inside the pre-commit discard boundary.

- Bump `als-language-upgrade-recipe` to `@2` solely to encode the recovery-prompt ban.
- Rejected because no new authored field is required and runner/compiler validation is enough.

- Always delete failed staging worktrees.
- Rejected because validation and projection failures are easier to debug when the staged tree is preserved.

- Use a generic temp directory instead of a detached git worktree.
- Rejected because the wrapper needs git-native commit/writeback and discard semantics.

## Non-Goals

- Pulse-as-construct in v1.
- Rollback automation.
- Changes to ALS-067's construct action-manifest contract beyond consuming it.
- Per-phase commit splitting.
- Mid-drain Drain-to-Kill escalation.

## Follow-Up

- A future job may turn pulse into a construct participant so statusline-related `/update` runs can refresh data producers automatically instead of relying on `/bootup` or `/reboot`.
