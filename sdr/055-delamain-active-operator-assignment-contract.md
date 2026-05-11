# Delamain Active-Operator Assignment Contract

## Status

Proposed

## Context

- ALS-101 addresses the multi-clone dispatcher race where two machines running the same delamain both pick up the same dispatchable entity because no authored assignment contract exists today.
- ALS-100 already fixed the operator-identity prerequisite by defining the committed roster surface and the gitignored machine-local active selector in SDR 054.
- Current delamain precedent is split:
  - top-level declarations such as `concurrency_pools` are explicit authored delamain surface
  - `session-field` semantics currently synthesize effective fields during validation
  ALS-101 must decide whether operator assignment follows the implicit-field path or requires an explicit authored field.
- The current dispatcher already supports value-based per-entity skipping through projected `discriminatorField` / `discriminatorValue`, but it has no projected active-operator assignment metadata and must not start parsing authored TypeScript at runtime.
- Console create flows are prompt-authored in Ghost today. Without a shared helper boundary, each skill would need to duplicate delamain introspection and local-selector lookup on its own.
- ALS-101 planning records the architectural rationale in [`../../../als-factory/artifacts/ALS-101/team-mode-dispatch-architecture.md`](../../../als-factory/artifacts/ALS-101/team-mode-dispatch-architecture.md). The recommended direction is a first-class assignment contract, not a lease/lock model and not a prompt-local string-field convention.

## Decision

- ALS defines a first-class entity field kind `operator-ref`.
- ALS defines a delamain-level declaration `requires_active_operator`.
- `requires_active_operator` accepts:
  - `true`
  - or an object with:
    - `field?: string`
    - `mode?: "opportunistic" | "strict"`
- Bare `requires_active_operator: true` means:
  - `field = "assigned_operator"`
  - `mode = "opportunistic"`
- The bound assignment field must be explicitly authored in the entity schema with `type: "operator-ref"`.
- ALS-101 rejects session-field-style implicit synthesis for this contract. The field is real authored schema, not a hidden effective field.
- Compiler validation resolves `operator-ref` values against the ALS-100 roster contract:
  - unknown operator IDs are validation errors
  - the delamain binding is a validation error when the named field is absent
  - the delamain binding is a validation error when the named field is not `type: "operator-ref"`
- `mode: "strict"` means:
  - the bound field must be declared with `allow_null: false`
  - entity records missing a value are invalid
- `mode: "opportunistic"` means:
  - the bound field may be nullable
  - missing value means "unassigned" rather than invalid
- Compiler projection writes the assignment contract into dispatcher runtime metadata. The dispatcher receives only projected data such as:
  - assignment field name
  - assignment mode
- Dispatcher runtime behavior is gated entirely on projected delamain config:
  - if no `requires_active_operator` declaration exists, behavior is unchanged
  - if the declaration exists and the entity assignment matches the local active operator, dispatch is allowed
  - if the assignment points at a different operator, dispatch is skipped silently
  - if the assignment is absent in opportunistic mode, dispatch is allowed on any machine
  - if the local active selector is missing or invalid on a machine, the dispatcher refuses to dispatch that delamain and emits explicit remediation; unrelated delamains continue running
- Console create flows consume a shared compiler-owned helper surface rather than duplicating roster/selector parsing. The helper returns whether the delamain requires assignment, the bound field name, the mode, and the current machine's active operator ID.
- Console create flows auto-stamp the active operator when the delamain requires it, while still allowing manual override and later manual reassignment.
- ALS-101 does not introduce timeout, lease, queue, or auto-takeover semantics. Reassignment remains an authored edit plus commit.
- ALS-101 is additive on top of the ALS-100 roster/selector contract and does not introduce a new language-upgrade recipe of its own.

## Normative Effect

- Required: `operator-ref` is a first-class field kind validated against the compiler-owned operator roster contract.
- Required: delamains that declare `requires_active_operator` bind to one explicitly authored `operator-ref` field.
- Required: bare `true` means `assigned_operator` plus opportunistic mode.
- Required: strict mode rejects nullable assignment fields and rejects missing assignment values.
- Required: opportunistic mode preserves single-operator behavior by allowing unassigned entities to dispatch on any machine.
- Required: dispatcher filtering runs only from compiler-projected metadata and the local active selector.
- Required: missing or invalid local selector state fails closed for the affected declared delamain and surfaces remediation explicitly.
- Required: console create flows use a shared helper for assignment metadata and local active operator lookup.
- Allowed: delamains without `requires_active_operator` remain byte-identical to current behavior.
- Allowed: authors may override the default field name through the delamain declaration.
- Allowed: operators may manually reassign work by editing the bound `operator-ref` field and committing the change.
- Rejected: implicit synthesized operator-assignment fields.
- Rejected: plain `string` or roster-mirrored `enum` as the canonical authored assignment contract.
- Rejected: dispatcher parsing of authored module or delamain TypeScript at runtime.
- Rejected: lease, lock, queue, or timeout-based takeover semantics in this job.

## Compiler Impact

- Extend field-schema validation with the `operator-ref` kind and roster-backed diagnostics.
- Extend delamain schema parsing and validation with `requires_active_operator`.
- Extend effective-validation logic to enforce bound-field existence/type and strict-vs-opportunistic nullability rules.
- Extend compiler-owned operator-config or adjacent helper surfaces so non-compiler consumers can resolve the active selector through one semantic boundary.
- Extend runtime-manifest projection with active-operator assignment metadata for the dispatcher.
- Extend CLI/helper surfaces so console flows can ask for assignment requirements without re-parsing authored files.
- Add positive and negative coverage for:
  - field-kind validation
  - unknown operator IDs
  - missing bound field
  - wrong bound field type
  - strict nullable-field rejection
  - opportunistic missing-value acceptance
  - projected runtime metadata
  - missing-selector remediation

## Docs and Fixture Impact

- Add this SDR as the normative record for the `operator-ref` plus `requires_active_operator` contract.
- Add [`../../../als-factory/artifacts/ALS-101/team-mode-dispatch-architecture.md`](../../../als-factory/artifacts/ALS-101/team-mode-dispatch-architecture.md) as the load-bearing rationale note for the recommended direction.
- Update the canonical shape-language reference with:
  - the `operator-ref` field kind
  - the `requires_active_operator` authored surface
  - strict and opportunistic examples
- Update dispatcher reference docs with the projected filter contract and missing-selector remediation behavior.
- Update console-pattern docs with the shared-helper stamping path and manual-reassignment rule.
- Paint fixture review around:
  - positive module + delamain examples using default and overridden field names
  - positive entity frontmatter examples for strict and opportunistic modes
  - negative examples for unknown operator IDs, wrong field type, missing bound field, and missing local selector
  - runtime-manifest examples showing projected assignment metadata
  - dispatcher examples showing allowed, skipped, and refused-to-dispatch outcomes

## Alternatives Considered

- Use a plain `string` or roster-shaped `enum` field and keep the rest of the contract in validation prose and console prompts.
- Rejected because it hides the roster-bound identity contract in duplicated glue instead of modeling it as first-class ALS meaning.

- Synthesize the assignment field implicitly the same way session-field effective fields are synthesized today.
- Rejected because assignment is durable authored data that humans and consoles need to see, override, and reason about directly.

- Solve the race with runtime claims, locks, or leases instead of authored assignment.
- Rejected because it introduces serialization and state-recovery complexity when a parallelism-preserving authored contract is available.

## Non-Goals

- Auto-takeover, lease expiry, or queue semantics.
- JSONL `operator-ref` support in this pass.
- Any change to delamain state-machine topology beyond the new declaration.
- Making console create flows generic or centralized beyond the helper boundary required for stamping.

## Follow-Up

- The next ALS-101 planning pass should paint the concrete fixture round for:
  - module field syntax
  - delamain declaration syntax
  - frontmatter examples
  - runtime-manifest projection
  - missing-selector remediation output
