# Delamain Cross-State Concurrency Pool Contract

## Status

Accepted

## Context

- SDR 036 introduced optional per-state `concurrency` and explicitly scoped it to same-state occupancy. It also listed cross-state or named-group serialization as a non-goal.
- ALS-076 needs the next layer up: a way to say that several different states draw from one shared capacity pool even though they are distinct nodes in the graph.
- The motivating consumer is the planned als-factory v3 `changelog -> aat` segment. A job in `aat` is validating the currently published RC, while a job in `changelog` may publish a newer RC. If those states run concurrently, the AAT result can immediately become meaningless.
- The current dispatcher already has the two core ingredients a pool contract should reuse:
  - per-state authored metadata projected through `delamain.yaml`
  - open-record occupancy counting based on persisted `active` plus `blocked` runtime records
- The current telemetry event `dispatch_suppressed_concurrency` is also the natural observability surface to extend rather than adding a second suppression event for the same scheduler decision.

## Decision

- Delamain definitions may declare an optional top-level `concurrency_pools` map.
- Each `concurrency_pools` entry is keyed by a delamain-local pool id and declares:
  - `states`: the member state ids
  - `capacity`: a positive integer
- `concurrency_pools` complements SDR 036 rather than replacing it. Per-state `concurrency` keeps its current meaning.
- Pool membership is restricted to agent-owned non-terminal states.
- A state may belong to at most one pool.
- The recommended v1 contract requires each pool to list at least two distinct member states.
- The order of `states` inside a pool has no scheduler meaning. It is an authored membership list, not a priority list.
- If a state declares both per-state `concurrency` and pool membership, both constraints apply. A dispatch is allowed only when the destination state's local cap and the pool cap both have headroom.
- Pool occupancy is counted across all member states using open runtime records whose status is `active` or `blocked`.
- `dispatch_suppressed_concurrency` adds `blocked_by: "state" | "pool"` so consumers can interpret `current_count` and `concurrency_limit` without guessing which cap fired.
- When `blocked_by: "state"`, `current_count` and `concurrency_limit` keep their existing same-state meaning and pool metadata is omitted.
- When `blocked_by: "pool"`, `current_count` and `concurrency_limit` describe pool occupancy and pool capacity, and the event includes `pool_id`, `pool_states`, and `pool_holders`.
- If the destination state's own cap and its pool cap are both exhausted on the same dispatch attempt, the dispatcher emits `blocked_by: "pool"` so the cross-state cause stays explicit to consumers.
- Pool capacity must also be reserved in memory during a scheduling tick so two queued jobs targeting different states in the same pool cannot both launch before either persisted record appears.
- Pools are local to one delamain. This decision does not introduce Ghost-wide or multi-delamain pools.
- Example authored shape:

```yaml
states:
  changelog:
    phase: acceptance
    actor: agent
    provider: anthropic
    resumable: false
    path: agents/changelog.md
    concurrency: 1
  aat:
    phase: acceptance
    actor: agent
    provider: anthropic
    resumable: false
    path: agents/aat.md

concurrency_pools:
  rc:
    states:
      - changelog
      - aat
    capacity: 1
```

## Normative Effect

- Required: `concurrency_pools` is optional; delamains that omit it behave exactly as they do today.
- Required: each pool id is unique within the delamain.
- Required: `capacity` is a positive integer.
- Required: every named pool member state exists on the same delamain.
- Required: pool member states are agent-owned and non-terminal.
- Required: each state may appear in at most one pool.
- Required: the authored order of `states` inside a pool does not change runtime behavior.
- Required: pool occupancy counts persisted `active` plus `blocked` runtime records across all member states.
- Required: same-tick in-memory reservations prevent oversubscription before runtime state is flushed.
- Required: when both a state-local `concurrency` cap and a pool cap exist, both must have headroom before dispatch.
- Required: `dispatch_suppressed_concurrency` includes `blocked_by: "state" | "pool"` and consumers interpret `current_count` plus `concurrency_limit` against that discriminator.
- Required: `blocked_by: "pool"` events include `pool_id`, `pool_states`, and `pool_holders`.
- Required: if both the state-local cap and the pool cap are exhausted on the same attempt, the event reports `blocked_by: "pool"`.
- Allowed: pooled states to also declare their own per-state `concurrency`.
- Allowed: unpooled states to keep using only same-state `concurrency`.
- Allowed: pool capacities greater than `1` when an author wants bounded cross-state parallelism instead of single-flight.
- Allowed: pool member states to live in different phases as long as they are agent-owned and non-terminal.
- Rejected: unknown pool member states.
- Rejected: pools with fewer than two distinct member states.
- Rejected: duplicate state ids inside one pool.
- Rejected: the same state belonging to multiple pools.
- Rejected: operator-owned or terminal states inside a pool.
- Rejected: using this surface for multi-delamain scheduling.

## Compiler Impact

- `alsc/compiler/src/delamain.ts` must add the top-level `concurrency_pools` schema and validate capacity, membership, and state eligibility.
- The same validation pass must reject duplicate membership across pools and any pool that resolves to fewer than two distinct states.
- `DelamainShape` and authored TypeScript helpers must expose the new top-level field.
- The projected `delamain.yaml` contract must carry pool data so the dispatcher can read normalized authored metadata instead of inferring pools from prompts or transitions.
- Tests must cover:
  - valid pool declarations
  - unknown states
  - invalid capacities
  - single-member pools
  - duplicate state ids inside one pool
  - duplicate membership across pools
  - invalid operator/terminal membership
  - coexistence with per-state `concurrency`

## Docs and Fixture Impact

- Add this SDR as the new decision record for cross-state concurrency pools.
- Update the canonical shape-language documentation after fixture review to teach `concurrency_pools` and its coexistence with per-state `concurrency`.
- Update the Delamain overview and dispatcher reference docs to describe pool occupancy, suppression, and observability.
- Fixture work should include:
  - a positive v3-style `rc` pool covering `changelog` and `aat`
  - negative examples for unknown states, duplicate membership, invalid capacities, and invalid actor/terminal membership
  - a Ghost-side `delamain-test` contention fixture with two pooled agent states for end-to-end UAT
- Dispatcher runtime tests must prove active-holder blocking, blocked-holder blocking, same-tick reservation, and enriched suppression telemetry.

## Alternatives Considered

- Reuse per-state `concurrency` and silently reinterpret it as a named cross-state group.
- Rejected because SDR 036 already accepted same-state-only semantics. Cross-state scheduling needs its own explicit contract.

- Put pool membership on each state instead of declaring pools at the graph level.
- Rejected because capacity is a graph-level concern and stable pool ids are useful for telemetry, logs, and operator-facing explanations.

- Expand this job to first-class dashboard work.
- Rejected for the proposed v1 contract because dispatcher telemetry can satisfy the holder-identification requirement without enlarging the shipped surface area.

## Non-Goals

- Multi-delamain or Ghost-wide concurrency pools.
- Automatic inference of shared-resource hazards from prompts, file paths, or touched files.
- Provider-slot scheduling changes beyond adding a second pool-cap gate before spawn.
- Changing the meaning of same-state `concurrency` as defined by SDR 036.
