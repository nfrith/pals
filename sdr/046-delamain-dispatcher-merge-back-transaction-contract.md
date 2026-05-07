# Delamain Dispatcher Merge-Back Transaction Contract

## Status

Proposed

## Context

- ALS-081 collects five empirically observed dispatcher merge-back failure modes across ALS-080 and ALS-082:
  - Mode A: descendant-shaped concurrent submodule advance blocks on Git's recursive submodule merge refusal
  - Mode B: orthogonal host-head movement blocks even when the dispatch's tracked paths do not overlap
  - Mode C: a later dispatch can silently override an earlier landed submodule pointer in the host
  - Mode D: local merge-back success can leave the canonical upstream ref stale
  - Mode E: the dispatcher can report success even when the canonical upstream ref is stale
- The current dispatcher implementation in `nfrith-repos/als/delamain-dispatcher/src/` treats refresh, mounted-submodule integration, dispatch-branch reachability, and host fast-forward as separate local Git steps guarded by `RepoMutationLock`, but it does not define one end-to-end success contract across those steps.
- ALS-081 planning selected Option A as the primary fix shape: keep the current isolated-worktree model and global repo-mutation lease, but make merge-back an invariant-driven transaction that is touched-path-aware, descendant-aware, and canonical-publication-aware.
- ALS-081 planning also added a first-class non-submodule constraint. Most ALS customer systems will be plain repos with zero mounted submodules. Modes B, D, and E apply to those systems too; Modes A and C are submodule-only and must remain conditional rather than assumed.

## Decision

- Dispatcher merge-back is a single transaction under `RepoMutationLock`. Success is defined by the transaction's end-to-end invariants, not by any one local Git command succeeding in isolation.
- Every successful merge-back must publish the host integration commit to the host repo's canonical upstream ref. A local host fast-forward without canonical-upstream publication is not a success state.
- In a system with mounted submodules, every successful merge-back must also:
  - integrate each mounted submodule to a specific mounted-submodule head
  - publish each integrated mounted-submodule head to that submodule's canonical upstream ref
  - record in the host gitlink the exact integrated mounted-submodule head for each mounted submodule
- In a system with zero mounted submodules:
  - submodule-specific invariants are not evaluated
  - submodule-specific incident kinds do not fire
  - success is "host integration + canonical-upstream publication"
- Host-head movement is treated as orthogonal unless it overlaps the dispatch's tracked-path set or violates a merge-back invariant. Orthogonal host movement must be absorbed rather than reported as a stale-base conflict.
- The dispatcher must preserve every successful dispatch's work end-to-end. It may not silently discard work, silently regress a previously landed host gitlink, or report success while canonical upstream refs remain stale.
- Merge-back failure reporting must be mechanism-specific. The dispatcher should distinguish at least:
  - concurrent submodule advance
  - orthogonal head movement
  - pointer-invariant failure
  - canonical-upstream publication failure
- The dispatcher may not infer a publish destination from a dispatch worktree branch name. Merge-back must use deterministic canonical publish targets for the host repo and for every mounted submodule.

## Normative Effect

- Required: plain-host ALS systems auto-resolve Modes B, D, and E without manual operator intervention.
- Required: submodule-bearing ALS systems auto-resolve Modes A, B, C, D, and E without manual operator intervention.
- Required: a successful merge-back publishes the host integration commit to the host repo's canonical upstream ref.
- Required: in submodule-bearing systems, a successful merge-back publishes each integrated mounted-submodule head to that submodule's canonical upstream ref and records that same SHA in the host gitlink.
- Required: host-head movement that does not overlap the dispatch's tracked-path set does not block merge-back.
- Required: residual failures surface cause-specific incidents and preserve worktrees when operator follow-up is still needed.
- Allowed: the dispatcher may persist extra runtime metadata such as canonical publish refs or remote-head observations if needed to prove the contract.
- Allowed: true non-descendant conflicts may still block, as long as the block is explicit and does not discard work.
- Rejected: treating dispatch-branch reachability as sufficient proof of success.
- Rejected: reporting clean success when the host or mounted-submodule canonical upstream ref remains stale.
- Rejected: silently overriding a previously landed host gitlink with a non-descendant or unverified replacement.
- Rejected: assuming every ALS system has mounted submodules.
- Rejected: making queueing or dispatch-time reservation the default fix shape for ALS-081.

## Compiler Impact

- No ALS parser, validator, authored-shape, or shape-language syntax change is introduced by this SDR.
- The `language` surface here is the dispatcher merge-back contract itself: the normative meaning of success, failure, and publication under ALS.
- Implementation is expected in the dispatcher construct runtime and its tests, with construct-version and migration work only if new persisted runtime-state fields are required.

## Docs and Fixture Impact

- Add this SDR as the canonical decision record for ALS-081's merge-back contract.
- Update `nfrith-repos/als/skills/docs/references/delamain-dispatcher.md` to describe the transaction contract for both system shapes:
  - plain-host systems
  - submodule-bearing systems
- Add regression coverage that treats zero-submodule systems as first-class fixtures, not as accidental side paths.
- No canonical `shape-language.md` update is required because this job does not introduce authored ALS syntax.

## Alternatives Considered

- Full rebase/replay integrator.
- Rejected as the primary ALS-081 path because it widens history-rewrite complexity and blast radius beyond what the five documented failure modes require.

- Per-submodule integration journal / reducer queue.
- Rejected as the primary ALS-081 path because it spends hot-submodule throughput in the normal case and conflicts with ALS-081's "tens of dispatches" scaling requirement.

- Dispatch-time reservation / serialize submodule-touching jobs.
- Rejected as the primary ALS-081 path because it solves correctness by removing concurrency rather than by making merge-back correct.

- Current flow plus post-block auto-repair worker.
- Rejected as the primary ALS-081 path because the blocked state still appears first, which fails the requirement that the documented modes stop looking like operator-diagnosis incidents.

## Non-Goals

- Changing ALS authored syntax.
- Changing the release-channel model or architect-side release-publish rules from SDR 045.
- Making queueing or reservation the default runtime architecture for dispatcher concurrency.
