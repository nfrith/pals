# ALS Update Transaction Transient Runtime Hygiene Contract

## Status

Accepted

## Context

- ALS-080 shipped two partial fixes for runtime-generated `.claude/` state:
  - fresh installs now ignore dispatcher runtime and pulse cache paths
  - the `v1 -> v2` language-upgrade recipe now begins with a cleanup step that `git rm --cached`s those historical tracked paths for existing edgerunners
- The existing-edgerunner `/update` path still fails because SDR 039's prepare contract runs before language execute. Prepare rejects any tracked dirty path under `.als/` or `.claude/`, so the cleanup step never gets a chance to run in the realistic `/bootup`-active environment.
- Research reproduced that pure "ignore transient paths in prepare" is insufficient. If the live repo still tracks a runtime file while the staging commit deletes or untracks it, final `git merge --ff-only` writeback can fail with the runtime file still being actively rewritten by dispatchers or pulse.
- SDR 038 already fixes the lifecycle boundary: drain, kill, and cancel are operator-visible choices. `/update` must not silently stop dispatchers or pulse just to make the git transaction succeed.
- The current transient-path knowledge is duplicated across the cleanup shell script, fixture `.gitignore` entries, tests, and the implicit dirty-tree behavior. ALS needs one source of truth for which `.claude/` paths are machine-managed runtime ephemera.

## Decision

- ALS defines a canonical transient-runtime path taxonomy under `alsc/` as the single source of truth for machine-managed `.claude/` paths relevant to update hygiene.
- Before SDR 039's dirty-tree rejection path fires, `/update` prepare may inspect tracked dirty paths under `.claude/` and separate canonical transient-runtime paths from blocking user-authored drift.
- When the only tracked dirty paths under `.claude/` are canonical transient-runtime paths, `/update` performs one automatic pre-prepare hygiene checkpoint in the live repo before it creates a staging worktree.
- The hygiene checkpoint:
  - enumerates every currently tracked path that matches the canonical transient-runtime taxonomy at commit time and removes that full tracked set from git tracking
  - leaves those runtime files on disk so active dispatchers and pulse can keep writing
  - creates one machine-authored checkpoint commit before staging begins
  - does not mutate `.als/` or any user-authored `.claude/` content
- After the hygiene checkpoint succeeds, `/update` resumes the normal SDR 039 flow from the repaired live `HEAD`: validate, preflight, prompt batch, staging worktree, staged execute, one staged update commit, and post-commit lifecycle actions.
- If any tracked dirty path under `.als/` is present, or if any tracked dirty path under `.claude/` is not in the canonical transient-runtime taxonomy, prepare still blocks with `dirty-live-tree`.
- The `v1 -> v2` cleanup migration remains in the language-upgrade path as idempotent follow-through and ignore-pattern completion. It is no longer load-bearing for prepare to succeed.
- The canonical transient-runtime taxonomy for this job includes at least:
  - `.claude/delamains/*/runtime/`
  - `.claude/delamains/*/status.json`
  - `.claude/scripts/.cache/pulse/*.json`
  - `.claude/delamains/*/telemetry/events.jsonl`
  - `.claude/delamains/*/dispatcher/control/drain-request.json`
- `/update` never silently kills dispatchers, pulse, or other operator-managed processes as part of transient-runtime hygiene.

## Normative Effect

- Required: `/update` distinguishes canonical transient-runtime paths from blocking user-authored drift before `dirty-live-tree` is reported.
- Required: canonical transient-runtime paths that are both tracked and currently within the taxonomy match set at checkpoint time are repaired in the live repo before staging begins, even if only a subset was dirty when prepare first observed the blocker.
- Required: the live repair creates exactly one checkpoint commit and preserves the runtime files on disk.
- Required: the checkpoint commit removes the full currently tracked taxonomy-matching set, not merely the initially dirty subset. Long-term ignore-pattern convergence remains owned by the shared cleanup follow-through.
- Required: tracked user-authored changes under `.als/` or `.claude/` still block `/update` exactly as they do today.
- Required: the canonical transient-runtime taxonomy is shared by the live repair path and the cleanup migration path.
- Required: the existing-edgerunner half-applied ALS-080 state becomes self-healing when `/update` is re-run after this contract lands.
- Allowed: fresh installs and already-clean systems to observe no transient-runtime repair at all.
- Allowed: the cleanup migration to remain in place as an idempotent safety net after the live repair succeeds.
- Rejected: broadening prepare into a general "ignore some dirty files" escape hatch.
- Rejected: index-only live repair without a checkpoint commit.
- Rejected: silently stopping runtime processes to force the git transaction through.

## Compiler Impact

- Add a shared transient-runtime taxonomy module under `nfrith-repos/als/alsc/` that exposes the canonical path-match rules for update hygiene and cleanup migration consumers.
- Update `nfrith-repos/als/alsc/update-transaction/` so prepare:
  - classifies tracked dirty paths under `.claude/`
  - auto-repairs the all-transient historical case through the live checkpoint commit
  - expands the checkpoint commit's target set to every currently tracked taxonomy-matching transient path at commit time
  - preserves the existing `dirty-live-tree` blocker for any non-transient tracked path
- Update the `v1 -> v2` cleanup implementation to consume the shared taxonomy instead of hard-coding its own shell pattern list.
- Keep SDR 039's top-level failure surfaces and staged writeback model unchanged after the live checkpoint completes.

## Docs and Fixture Impact

- `nfrith-repos/als/skills/update/SKILL.md` must describe that canonical tracked transient-runtime paths are auto-repaired before the operator sees the dirty-tree AskUserQuestion flow.
- `nfrith-repos/als/skills/docs/references/language-upgrades.md` and any cleanup-step references must describe the cleanup migration as idempotent follow-through instead of the only path that makes prepare succeed.
- `nfrith-repos/als/sdr/039-update-transaction-wrapper-contract.md` must cross-reference this narrower transient-runtime refinement instead of keeping the old "all tracked `.claude/` dirt blocks" wording unqualified.
- Add regression coverage for:
  - transient tracked paths auto-repairing before prepare
  - user-authored dirty paths still blocking
  - full writeback succeeding from the existing-edgerunner state
  - shared-taxonomy drift failing tests
- No new authored ALS syntax, shape-language examples, or fixture-review syntax loops are expected from this contract change.

## Alternatives Considered

- Ignore canonical transient-runtime paths only in prepare.
- Rejected because writeback can still fail when the staging commit untracks or deletes a path the live repo still tracks and runtime writers keep modifying.

- Leave cleanup entirely inside the `v1 -> v2` recipe execute path.
- Rejected because prepare still blocks before execute can run.

- Perform index-only live repair without a checkpoint commit.
- Rejected because git can still abort fast-forward writeback when the runtime file remains present as an untracked working-tree path.

- Silently kill or drain dispatchers from `/update`.
- Rejected because SDR 038 makes lifecycle mediation operator-visible and ALS-082 is not allowed to collapse that boundary.
