# Explicit Declaration Semantics

## Status

Accepted

## Context

- Earlier v1 behavior separated presence from nullability.
- `required` controlled whether a field or section had to appear.
- `allow_null` controlled whether an explicitly present field or section could use `null`.
- That model allowed omission-based records.
- Omission created shape ambiguity for agents because a missing slot could mean "not applicable", "unknown", or "forgotten".

## Decision

- Remove `required` from the v1 authoring model.
- This applies to field definitions, inline section definitions, and variant `section_definitions`.
- Declared membership controls presence.
- Every declared field must appear in record frontmatter.
- Every declared section must appear in the record body.
- `allow_null: true` means the explicit value may be `null`.
- `allow_null: true` does not allow omission.
- The same rule applies to root fields, variant-local fields, plain-entity sections, and variant-local sections.
- `null` means the declared slot exists but currently has no value.
- "Not applicable" must be modeled with variant selection or a different entity shape, not omission or `null`.
- Empty string is not a valid value for `type: string` fields.
- Empty body sections are not a valid stand-in for `null`.
- `[]` remains valid and distinct from `null` for list fields.

## Normative Effect

- Required: every declared frontmatter field is present.
- Required: every declared body section is present.
- Required: nullable fields use explicit YAML `null` when empty.
- Required: nullable sections use explicit body `null` when empty.
- Allowed: `null` only when `allow_null: true`.
- Allowed: `[]` for an explicitly empty list.
- Rejected: authored `required` keys in v1 shapes.
- Rejected: omitted declared fields.
- Rejected: omitted declared sections.
- Rejected: empty string for `type: string`.
- Rejected: empty section bodies used in place of explicit `null`.
- Rejected: omission to represent "not applicable".

## Compiler Impact

- Shape parsing rejects legacy `required` keys anywhere in a v1 shape file.
- Field and section schemas no longer model `required`.
- `id` remains authored as `type: id` with `allow_null: false`.
- Frontmatter validation requires every declared field to be present, even when nullable.
- Body validation requires every declared section to be present, even when nullable.
- Frontmatter validation rejects empty string for `type: string`.

## Docs and Fixture Impact

- Reference docs must describe declaration as presence.
- Docs must say there is no optional-field mechanism.
- Docs must say `allow_null` controls explicit `null`, not omission.
- Example shapes must not use `required`.
- Example records and fixtures must include declared nullable members explicitly, using `null` when empty.
- Tests must cover omitted nullable fields.
- Tests must cover omitted nullable sections.
- Tests must cover legacy `required` keys.
- Tests must cover explicit `null` acceptance and rejection.

## Alternatives Considered

- Keep `required` as the presence flag.
- Rejected because it duplicates declaration and preserves omission-era ambiguity.
- Preserve `required: false` during transition.
- Rejected because the main v1 snapshot should reflect the actual intended contract.
- Treat `allow_null: true` as optional.
- Rejected because nullability and presence are different semantics.

## Follow-Up

- If this decision is materially revised, create a new SDR instead of weakening this file in place.
