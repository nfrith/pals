# Unresolved Variant Behavior

## Status

Accepted

## Context

- Variant entities depend on the discriminator field to resolve the effective contract.
- Earlier behavior could fail variant resolution in frontmatter and then effectively skip body validation.
- That made records look less broken than they were.
- It also made repair loops noisy or ambiguous because agents could not tell whether to fix the discriminator or the body sections first.

## Decision

- When variant resolution fails, the record still fails body validation.
- The compiler must not guess a body contract from other variants.
- The compiler must not silently skip body validation.
- The compiler must emit `FM_VARIANT_UNRESOLVED` for the frontmatter-side failure.
- The compiler must emit `BODY_VARIANT_UNRESOLVED` for the body-side failure.
- `BODY_VARIANT_UNRESOLVED` is a distinct diagnostic, not a reuse of missing-section, unknown-section, or order-mismatch diagnostics.
- While the variant is unresolved, downstream body diagnostics for sections are suppressed.
- While the variant is unresolved, variant-local frontmatter keys that are declared in any variant should not be reported as unknown-field noise.
- Truly undeclared frontmatter keys should still fail.
- `BODY_ORDER_MISMATCH` should not be emitted when the section set is already invalid because of missing sections, unknown sections, or unresolved variant state.

## Normative Effect

- Required: unresolved variant state produces explicit failure on both frontmatter and body.
- Required: repair guidance points to the discriminator first.
- Allowed: validation of root or base frontmatter fields can still run.
- Allowed: truly undeclared frontmatter keys can still be rejected.
- Rejected: silent body-validation skip on unresolved variants.
- Rejected: body-contract guessing across variant section sets.
- Rejected: secondary section diagnostics when the body contract is unresolved.
- Rejected: redundant order diagnostics when the section set is already invalid.

## Compiler Impact

- Add and use the dedicated body diagnostic code `BODY_VARIANT_UNRESOLVED` (`PAL-RV-BODY-004`).
- Contract resolution must preserve unresolved-body state rather than only returning "no sections".
- Body validation must stop after the unresolved-variant diagnostic for that record.
- Frontmatter validation must suppress `FM_UNKNOWN_FIELD` for variant-local names that belong to declared variants when the discriminator is unresolved.
- Body-order validation must only run when the expected and actual section sets are otherwise valid.

## Docs and Fixture Impact

- Reference docs must explain that unresolved variants fail both frontmatter and body validation.
- Diagnostic references must distinguish unresolved variant state from ordinary body-shape errors.
- Tests must cover missing discriminator.
- Tests must cover invalid discriminator type.
- Tests must cover invalid discriminator value.
- Tests must cover body-side unresolved diagnostic emission.
- Tests must cover suppression of downstream section diagnostics.
- Tests must cover suppression of redundant order diagnostics.

## Alternatives Considered

- Skip body validation when variant resolution fails.
- Rejected because it leaves the record in a partially validated state.
- Guess a union or intersection body contract from all variants.
- Rejected because it invents a contract the shape did not declare.
- Reuse `BODY_MISSING_SECTION` or `BODY_ORDER_MISMATCH`.
- Rejected because those diagnostics suggest the wrong repair action.

## Follow-Up

- If variant resolution later gains additional states, keep the body-side failure distinct from ordinary section diagnostics.
