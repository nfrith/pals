# Delamain State Concurrency Contract

## Status

Accepted

## Context

- Delamain state definitions currently describe actor, provider, resumability, prompt path, and phase, but they do not describe how many jobs in the same state may run concurrently.
- The dispatcher's current behavior is effectively unbounded within a state: if several jobs share the same status and provider slots are open, it may spawn all of them in parallel.
- That default is correct for states whose agents edit only the job's own file, but it is incorrect for states whose agents write to a shared resource.
- ALS-065 surfaced the gap directly on 2026-04-30 when ALS-062, ALS-063, and ALS-064 all entered `changelog` and each wrote a `CHANGELOG.md` update from its own stale preimage. Only the first merge landed cleanly; the later siblings blocked on stale-base refresh and required manual recovery.
- A delamain-specific retry or auto-rebase patch would solve the immediate `CHANGELOG.md` race but would not give future delamain authors a general way to declare "this state touches a shared resource."

## Decision

- Delamain state definitions may declare an optional `concurrency` field.
- `concurrency` is valid only on agent-actor states.
- `concurrency` must be a positive integer.
- If `concurrency` is absent, the state remains unbounded and existing delamains keep today's behavior.
- `concurrency: 1` means single-flight: the dispatcher may have at most one open dispatch record in that state at a time.
- `concurrency: 2` and higher mean bounded parallelism: the dispatcher may have at most that many open dispatch records in that state at a time.
- The cap is enforced per state across all jobs and all providers. Provider-slot availability remains a separate scheduler axis.
- The dispatcher counts both `active` and `blocked` open dispatch records toward the cap.
- If a candidate dispatch is suppressed because the cap is already full, the dispatcher leaves the job queued and emits telemetry event `dispatch_suppressed_concurrency` with `{ state, item_id, current_count, concurrency_limit }`.
- `concurrency` on terminal states is rejected.
- `concurrency` on operator-actor states is rejected.
- Example authored shape:

```yaml
"changelog":
  phase: acceptance
  actor: agent
  provider: anthropic
  resumable: false
  path: agents/changelog.md
  concurrency: 1
```

## Normative Effect

- Required: agent-actor states may declare `concurrency` only as a positive integer.
- Required: absent `concurrency` means unbounded dispatch within that state.
- Required: dispatcher-side enforcement happens before spawn and is based on open records for the same state, not on provider identity.
- Required: `blocked` records count toward the cap alongside `active` records.
- Required: a blocked single-flight state remains frozen until the operator clears or resolves the blocking record.
- Allowed: different states in the same delamain to choose different caps.
- Allowed: `concurrency` values greater than `1` when a delamain author wants bounded parallelism instead of single-flight.
- Rejected: `concurrency: 0`.
- Rejected: negative, fractional, or string-valued `concurrency`.
- Rejected: `concurrency` on terminal or operator-actor states.
- Rejected: treating this field as cross-state serialization or automatic shared-write detection.

## Compiler Impact

- `alsc/compiler/src/delamain.ts` must recognize `concurrency` as an optional state field and validate that it is an integer greater than or equal to `1`.
- The same validation pass must reject `concurrency` on terminal and operator-actor states with normal Delamain schema diagnostics.
- The emitted dispatcher-readable contract must carry the validated `concurrency` value so the runtime does not need to re-interpret authored YAML at tick time.
- Dispatcher runtime code must add a same-state open-record count check before spawn, using the existing runtime-state data store and counting both `active` and `blocked` records.
- Tests must cover the default-unbounded case, valid positive integers, rejected invalid values, rejected terminal/operator placement, and suppression behavior when the cap is already full.

## Docs and Fixture Impact

- Compiler fixtures and shape examples must show:
  - no `concurrency` field on a normal agent state
  - valid `concurrency: 1`
  - rejected `concurrency: 0`
  - rejected `concurrency: -1`
  - rejected `concurrency: "1"`
  - rejected `concurrency` on terminal and operator-actor states
- The first live delamain use is `concurrency: 1` on `.als/modules/als-factory/v2/delamains/als-factory-jobs/delamain.ts` state `changelog`.
- The canonical shape-language documentation at `skills/docs/references/shape-language.md` describes the field briefly and points back to this SDR for semantics.
- Any later authoring docs should mention the field briefly and avoid re-stating its semantics in multiple places.

## Alternatives Considered

- Fix only the `changelog` agent or stale-base handler with auto-retry or auto-rebase logic.
- Rejected because it solves one shared-write race locally and leaves the language without a general state-level concurrency contract.

- Count only `active` records toward the cap.
- Rejected because the operator explicitly wants a blocked record to freeze the queue and force visibility instead of allowing more jobs to pile into the same state behind an unresolved block.

- Add a broader `concurrency-group` or cross-state serialization feature in this job.
- Rejected because ALS-065 only needs per-state bounded concurrency, and cross-state locking is a separate language decision.

## Non-Goals

- Cross-state or named-group serialization.
- Automatic inference of shared-write hazards from prompts or file paths.
- A pause feature where `concurrency: 0` disables a state.
- Changes to stale-base retry policy beyond preventing the race through serialization.
