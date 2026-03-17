# v1 TODO

## 1. Explicit Declaration Semantics for Fields and Sections

### Context

The current compiler treats presence and nullability as separate concerns:

- `required` controls whether a frontmatter field or body section must appear in the record.
- `allow_null` controls whether an explicitly present field/section may use `null`.

That is not the intended PALS design for agent-first systems.

The intended rule is stricter:

- Every declared field must be explicitly present in frontmatter.
- Every declared section must be explicitly present in the markdown body.
- `allow_null` means the explicit value may be `null`; it does not mean the field or section may be omitted.

This matters because omission creates shape ambiguity for agents. The system should expose a stable explicit record shape even when a value is empty.

This future change also subsumes the current review feedback around optional section ordering. Under the intended semantics, there should be no concept of a declared section that may be silently omitted.

### Why this is deferred

This is a semantic contract change, not just a bug fix.

It affects:

- frontmatter validation
- body validation
- examples and fixtures
- language documentation
- possibly the meaning or existence of `required`

Because of that, it should be handled as a dedicated follow-up after the current review-fix session.

### Desired end state

The compiler should enforce:

- all declared root/base fields are present
- all declared variant-local fields for the selected variant are present
- all declared plain-entity sections are present
- all declared variant sections for the selected variant are present
- nullable fields may use YAML `null`
- nullable sections may use the literal body content `null`

The compiler should reject:

- omitted declared fields
- omitted declared sections
- empty sections used in place of explicit `null`
- records that rely on omission to signal “not applicable” or “not filled in yet”

### Likely implementation areas

- `v1/palsc/compiler/src/validate.ts`
- `v1/palsc/compiler/src/schema.ts`
- `v1/palsc/skills/new/references/shape-language.md`
- `v1/example-systems/centralized-metadata-happy-path/`
- compiler negative tests for frontmatter and body validation

### Open questions

1. What should happen to `required`?

Current state:

- `required` is the presence flag.

Under the intended semantics:

- `required` may become redundant for fields and sections.

Options to decide:

- keep `required` in `pals-module@1` as a redundant field and ignore it for presence
- keep `required` but redefine it to some new semantic
- remove `required` from the language in a later cleanup pass, while possibly tolerating it for compatibility in v1

2. Should “explicit declaration” mean explicit `null` for list/ref/string/number/date/enum whenever `allow_null: true`?

Presumed answer is yes, but it should be confirmed and documented uniformly across all field types.

3. Should variant resolution failure still validate body shape?

Today, bad discriminator values can cause effective section validation to be skipped.

For the future contract, decide whether to:

- fail only frontmatter and skip body because the variant cannot be resolved, or
- additionally surface a stronger invariant/error path so records never silently escape section validation

4. How should “not applicable for this type” be represented?

The current variant model solves most of this by selecting a different field/section schema per type. Confirm that this is the only intended mechanism, rather than allowing declared-but-omitted content.

5. Do we want to preserve `required: false` in examples during transition, or normalize examples now so all declared members are explicitly present with `null` when empty?

### Acceptance criteria for the future session

- The compiler rejects omitted declared fields even when `allow_null: true`.
- The compiler rejects omitted declared sections even when `allow_null: true`.
- The compiler accepts explicit `null` only where `allow_null: true`.
- Variant entities enforce explicit presence for the selected variant’s fields and sections.
- Docs clearly state that omission is not allowed for declared members.
- Example systems and fixtures reflect the explicit-declaration rule.
