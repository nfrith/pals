# Delamain State Label, Outcome, And Bucket Projection Contract

## Status

Proposed

## Context

- The dashboard journey view currently renders raw Delamain state ids such as `research-gate` and `change-impact-input`, which are meaningful to the architect but not readable enough for a generic human-facing status surface.
- The dashboard already consumes deployed `.claude/delamains/{name}/delamain.yaml` artifacts per SDR 029, so human-readable state meaning needs to arrive through the compiled artifact instead of through dashboard-local translation tables.
- `terminal: true` currently collapses successful completion, intentional stop, and errored termination into one bucket even though status consumers need to distinguish those cases.
- Pass-1 operator review rejected the earlier opt-in `audience` gate. The approved direction is one universal Delamain contract: every state gets a label and every terminal state gets an outcome.
- Making those fields mandatory in v4 means existing v3-authored Delamains need bootstrap content. The operator deliberately chose a content-generating `v3 -> v4` recipe step as the first scoped exercise of the framework's auto-placeholder pattern because this dashboard-oriented surface is low-stakes enough to test the pattern before it is needed in a higher-stakes migration.
- The current compiler projects authored Delamain shape verbatim into deployed `delamain.yaml`, so there is no existing projection seam for compiler-owned per-state consumer metadata.

## Decision

- Every Delamain state declares `label: string`.
- Every terminal Delamain state declares `outcome: "success" | "stopped" | "errored"`.
- Non-terminal states do not declare `outcome`.
- Delamain root definitions do not declare `audience`. Labels and terminal outcomes are universal rather than opt-in.
- The compiler projects a derived `customer_bucket` onto every deployed Delamain state. Authors do not declare `customer_bucket` in `delamain.ts`.
- `customer_bucket` is derived by rule:
  - terminal plus `outcome: "success"` => `closed_success`
  - terminal plus `outcome: "stopped"` => `closed_stopped`
  - terminal plus `outcome: "errored"` => `closed_errored`
  - non-terminal `actor: "operator"` => `waiting_for_user`
  - non-terminal `actor: "agent"` => `active`
- The deployed Delamain artifact preserves authored `label` and authored `outcome` and adds derived `customer_bucket` during projection.
- The `v3 -> v4` language-upgrade recipe includes one content-generating script step that inserts missing `label` and terminal `outcome` fields into existing `.als/modules/*/delamains/*/delamain.ts` files.
- Recipe insertion is deterministic and fill-only:
  - existing authored `label` values are preserved unchanged
  - existing authored `outcome` values are preserved unchanged
  - missing non-terminal labels receive a placeholder derived mechanically from the state id by replacing hyphens with spaces and title-casing the result
  - missing terminal labels follow the same placeholder rule, except `done` maps to `Shipped`, `shelved` maps to `Stopped`, and `cancelled` maps to `Stopped`
  - missing terminal outcomes are inserted from an explicit allowlist over the current terminal-state inventory
  - encountering a terminal state id outside that allowlist fails the recipe closed rather than guessing
- The allowlist used by the v3 inventory bootstrap is:
  - `success`: `done`, `completed`, `concluded`, `processed`, `closed`
  - `stopped`: `shelved`, `cancelled`, `deferred`, `superseded`
  - `errored`: `failed`, `rolled-back`
- Re-running the recipe is idempotent.
- Authored values that differ from the generated placeholder are preserved and do not produce migration warnings solely because they differ from the default.
- New machine-readable diagnostic `reason` values for the steady-state compiler contract live under `delamain.state.label.*` and `delamain.state.outcome.*` in line with SDR 012.

## Normative Effect

- Required: every state declares a non-empty `label`.
- Required: every terminal state declares `outcome: "success" | "stopped" | "errored"`.
- Required: non-terminal states do not declare `outcome`.
- Required: authored Delamain source does not declare `customer_bucket`.
- Required: the compiler emits `customer_bucket` on every deployed Delamain state.
- Required: deployed `customer_bucket` values follow the five-way derivation contract recorded in this SDR.
- Required: the steady-state v4 language contract has no `audience` field and no opt-in label coverage mode.
- Required: the `v3 -> v4` recipe inserts missing labels and terminal outcomes only where fields are absent.
- Required: the `v3 -> v4` recipe preserves any existing authored label or outcome exactly as written.
- Required: the `v3 -> v4` recipe is idempotent.
- Required: the `v3 -> v4` recipe fails closed on any terminal state id that is not in the approved outcome-mapping allowlist.
- Allowed: authors may refine placeholder labels after upgrade without changing the language contract.
- Allowed: authors may preserve existing authored labels even when those labels differ from the generated placeholder a fresh v3 file would receive.
- Rejected: renderer-owned state-name translation tables as the primary human-readable status contract.
- Rejected: authored `customer_bucket` or any other author-declared bucket field.
- Rejected: an `audience` opt-in gate for label coverage.
- Rejected: recipe behavior that guesses an outcome for unknown terminal ids.
- Rejected: recipe behavior that overwrites existing authored label or outcome values.

## Compiler Impact

- Extend Delamain authored schema and types to require state `label` and terminal `outcome: "success" | "stopped" | "errored"` and to reject any root `audience` field.
- Extend Delamain semantic validation to enforce missing-label, missing-terminal-outcome, and non-terminal-outcome rejection.
- Add stable machine-readable diagnostic `reason` values for the new state-label and state-outcome validation failures so automation does not parse message text.
- Introduce a compiler-owned Delamain projection seam for deployed `delamain.yaml` so emitted state shape can include derived `customer_bucket` without making that field authorable.
- Bump supported ALS versions to include v4 and add a `v3-to-v4` language-upgrade recipe that mutates `.als/` Delamain source by inserting placeholder labels and terminal outcomes.
- Add positive and negative tests for valid v4 Delamains, missing labels, missing terminal outcomes, non-terminal outcome rejection, deployed projection shape, `closed_errored` projection, idempotent recipe rerun, partially pre-authored v3 input, preserved conflicting authored labels, and fail-closed unknown terminal-id mapping.

## Docs and Fixture Impact

- Update the canonical shape-language reference to document universal state `label`, terminal `outcome`, and the projection-only status of `customer_bucket`.
- Paint authored `delamain.ts`, deployed `delamain.yaml`, and `language-upgrade-recipe` examples in the fixture-first planning pass before compiler implementation begins.
- Add compiler fixtures or tests for:
  - valid v4 Delamain with labels on every state and outcomes on every terminal
  - v4 Delamain missing a non-terminal `label`
  - v4 terminal state missing `outcome`
  - v4 non-terminal state declaring `outcome`
  - v4 terminal state with `outcome: "errored"` projecting `customer_bucket: closed_errored`
  - `v3 -> v4` recipe on fully unlabeled input
  - `v3 -> v4` recipe on partially pre-authored input
  - idempotent recipe rerun
  - `v3 -> v4` recipe failure on unmapped terminal state id
- Retain a v4 language-upgrade fixture snapshot and the content-generating `v3-to-v4` recipe alongside the existing v3 snapshot.
- The downstream dashboard rebuild must widen its parser and feed types to consume `label`, `outcome`, and `customer_bucket`, but that renderer work is a follow-up job rather than part of this contract.

## Alternatives Considered

- Keep human-readable labels and outcome meaning in dashboard-local translation tables.
- Rejected because it duplicates Delamain meaning outside the language contract and breaks the generic-projection rule established for dashboard consumers.

- Keep the earlier `audience` opt-in gate.
- Rejected because operator review selected one universal contract instead of a two-tier authored surface.

- Use an operator gate to force manual authoring of every missing label and outcome during `v3 -> v4`.
- Rejected because it serializes the migration across operator attention, while the pipeline is built for parallel upgrade flows and the chosen placeholder script can preserve existing authored values without introducing that gate.

- Let the content-generating recipe guess unknown terminal meanings or use an LLM to invent labels and outcomes.
- Rejected because recipe behavior must remain deterministic, network-free, and fail closed on semantic ambiguity.

- Let authors declare `customer_bucket` directly.
- Rejected because it duplicates semantics already implied by `terminal`, `actor`, and terminal `outcome`, and it invites authored drift between bucket and state meaning.

- Validate `label` and `outcome` in the compiler but keep bucket derivation in each consumer.
- Rejected because every consumer would need to re-implement the same active-vs-waiting-vs-closed-success-vs-closed-stopped-vs-closed-errored mapping, recreating drift across the producer/consumer boundary.

- Introduce a broader localization or multi-copy surface now.
- Rejected because this job needs one human-readable label and one terminal outcome classifier per state, not locale selection, pluralization, or audience-variant copy.

## Non-Goals

- Authoring polished final copy for every existing Delamain state at migration time. The recipe only guarantees deterministic readable placeholders.
- Rebuilding dashboard rendering or dashboard routing.
- Adding localization, multi-locale copy, or audience-specific label variants beyond the one declared `label`.
