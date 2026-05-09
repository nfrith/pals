# Delamain Customer-Facing State Projection Contract

## Status

Proposed

## Context

- The dashboard journey view currently renders raw Delamain state ids such as `research-gate` and `change-impact-input`, which are meaningful to the architect but not to a non-technical customer-facing audience.
- The dashboard already consumes deployed `.claude/delamains/{name}/delamain.yaml` artifacts per SDR 029, so customer-facing state meaning needs to arrive through the compiled artifact instead of through dashboard-local translation tables.
- `terminal: true` currently collapses shipped and stopped end states into one bucket even though customer-facing surfaces need to distinguish `done` from `shelved` and `cancelled`.
- Internal-only Delamains should not be forced to author customer copy when no customer-facing consumer will ever read it.
- The current compiler projects authored Delamain shape verbatim into deployed `delamain.yaml`, so there is no existing projection seam for compiler-owned per-state consumer metadata.

## Decision

- Delamain root definitions may declare optional `audience: "customer-facing" | "operator-only"`.
- If `audience` is absent, the effective value is `"operator-only"`.
- Delamain states may declare optional `label: string`.
- Delamain states may declare optional `outcome: "success" | "stopped"` only when `terminal: true`.
- When `audience === "customer-facing"`:
  - every non-terminal state must declare a non-empty `label`
  - every terminal state must declare a non-empty `label`
  - every terminal state must declare `outcome`
- When `audience === "operator-only"`:
  - `label` and `outcome` remain valid authored fields
  - neither field is required
- The compiler projects a derived `customer_bucket` onto every deployed Delamain state. Authors do not declare `customer_bucket` in `delamain.ts`.
- `customer_bucket` is derived by rule:
  - `terminal: true` plus `outcome: "success"` => `closed_success`
  - `terminal: true` plus `outcome: "stopped"` => `closed_stopped`
  - `terminal: true` with no `outcome` => `closed`
  - non-terminal `actor: "operator"` => `waiting_for_user`
  - non-terminal `actor: "agent"` => `active`
- The deployed Delamain artifact preserves authored `label` and authored `outcome` when present and adds derived `customer_bucket` during projection.
- This is an additive language change. The `v3 -> v4` language-upgrade recipe rewrites only `als_version` and language-upgrade runtime state; it does not rewrite authored Delamain content.
- Audience-gated coverage failures use stable machine-readable diagnostic `reason` values under the `delamain.audience.*` namespace in line with SDR 012.

## Normative Effect

- Required: `audience` values are limited to `"customer-facing"` and `"operator-only"`.
- Required: absent `audience` behaves exactly as `"operator-only"`.
- Required: `label`, when present, is a non-empty string.
- Required: `outcome`, when present, is limited to `"success"` or `"stopped"`.
- Required: non-terminal states do not declare `outcome`.
- Required: if `audience === "customer-facing"`, every non-terminal state has `label`.
- Required: if `audience === "customer-facing"`, every terminal state has both `label` and `outcome`.
- Required: the compiler emits `customer_bucket` on every deployed Delamain state.
- Required: authored Delamain source does not declare `customer_bucket`.
- Required: deployed `customer_bucket` values follow the five-rule derivation contract recorded in this SDR.
- Required: existing v3-authored Delamains remain valid after the v4 cutover with zero authored source edits because the new root field defaults to `"operator-only"` and the new state fields stay optional outside the customer-facing gate.
- Allowed: operator-only Delamains may still author `label` and terminal `outcome` if they want downstream consumers to read them.
- Allowed: operator-only terminal states may omit `outcome`, in which case their deployed `customer_bucket` is `closed`.
- Rejected: renderer-owned state-name translation tables as the primary customer-facing contract.
- Rejected: authored `customer_bucket` or any other author-declared bucket field.
- Rejected: requiring customer-facing copy on operator-only Delamains.
- Rejected: inferring shipped vs stopped outcome from state ids such as `done`, `shelved`, or `cancelled`.

## Compiler Impact

- Extend Delamain authored schema and types to accept root `audience`, state `label`, and terminal `outcome`.
- Extend Delamain semantic validation to enforce customer-facing coverage and terminal-only `outcome` placement.
- Add stable machine-readable diagnostic `reason` values for audience-gated coverage failures so automation does not parse message text.
- Introduce a compiler-owned Delamain projection seam for deployed `delamain.yaml` so emitted state shape can include derived `customer_bucket` without making that field authorable.
- Bump supported ALS versions to include v4 and add a `v3-to-v4` language-upgrade recipe that performs the additive cutover without rewriting module bundles.
- Add positive and negative tests for valid customer-facing Delamains, missing labels, missing terminal outcomes, deployed projection shape, and v3-to-v4 upgrade success on retained fixtures.

## Docs and Fixture Impact

- Update the canonical shape-language reference to document `audience`, `label`, `outcome`, and the projection-only status of `customer_bucket`.
- Paint authored `delamain.ts`, deployed `delamain.yaml`, and `language-upgrade-recipe` examples in the fixture-first planning pass before compiler implementation begins.
- Add compiler fixtures or tests for:
  - customer-facing Delamain with full label coverage
  - customer-facing Delamain missing a non-terminal `label`
  - customer-facing terminal state missing `outcome`
  - operator-only Delamain with no customer-facing fields
- Retain a v4 language-upgrade fixture snapshot and the additive `v3-to-v4` recipe alongside the existing v3 snapshot.
- The downstream dashboard rebuild must widen its parser and feed types to consume `label`, `outcome`, and `customer_bucket`, but that renderer work is a follow-up job rather than part of this contract.

## Alternatives Considered

- Keep customer-facing labels and outcome meaning in dashboard-local translation tables.
- Rejected because it duplicates Delamain meaning outside the language contract and breaks the generic-projection rule established for dashboard consumers.

- Let authors declare `customer_bucket` directly.
- Rejected because it duplicates semantics already implied by `terminal`, `actor`, and terminal `outcome`, and it invites authored drift between bucket and state meaning.

- Validate `label` and `outcome` in the compiler but keep bucket derivation in each consumer.
- Rejected because every consumer would need to re-implement the same closed-vs-waiting-vs-active mapping, recreating drift across the producer/consumer boundary.

- Introduce a broader localization or multi-copy surface now.
- Rejected because this job needs one customer-facing label and one terminal outcome classifier per state, not locale selection, pluralization, or audience-variant copy.

## Non-Goals

- Authoring customer-facing copy for existing Delamains.
- Rebuilding dashboard rendering or dashboard routing.
- Adding localization, multi-locale copy, or audience-specific label variants beyond the one declared `label`.
