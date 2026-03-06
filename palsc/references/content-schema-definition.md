# Schema Content Definition (Current Baseline)

## Scope

This document defines the allowed markdown body structure for schema files.
It works with frontmatter `body_contract` where:

1. `source: markdown`
2. `section_contract_model: inline`

## Canonical Type Model

```ts
type SchemaBody = {
  title_h1: string;
  sections: Record<SectionName, SectionContract>;
};

type SectionContract = {
  value_type: "markdown_string" | "markdown_list" | "markdown_string_or_list";
  nullable: boolean;
  empty_marker: null;
  includes: string;
  excludes: string;
};
```

## Canonical Markdown Shape

```md
# {ENTITY NAME}

## <SECTION_NAME>

- value_type: <markdown_string|markdown_list|markdown_string_or_list>
- nullable: <true|false>
- empty_marker: null
- includes: <non-empty guidance string>
- excludes: <non-empty guidance string>
```

Repeat the `## <SECTION_NAME>` block for each section in the schema.

## Compiler Enforcement Rules

1. Schema body must contain one top-level H1 title (`# ...`) before section contracts.
2. Section contracts must be declared under level-2 headings (`## ...`).
3. Section names are literal contract keys and are matched exactly by record headings.
4. Section names must be unique within one schema file.
5. Every section contract must include all keys:
   - `value_type`
   - `nullable`
   - `empty_marker`
   - `includes`
   - `excludes`
6. `value_type` must be one of:
   - `markdown_string`
   - `markdown_list`
   - `markdown_string_or_list`
7. `empty_marker` must be literal `null`.
8. `includes` and `excludes` must be non-empty strings.
9. Unknown section-contract keys are invalid in the current baseline.

## Boundary

This file defines only schema-file body shape. Record validation semantics are defined in `palsc/references/record-validation.md`.

## Value Type Meaning

1. `markdown_string`: prose/block text section content.
2. `markdown_list`: list-form section content.
3. `markdown_string_or_list`: either prose or list content.

## Explicitly Not Supported (Current Baseline)

1. Per-section custom empty markers.
2. Non-markdown section content models.
3. Deep typed section sub-schemas beyond `value_type` + nullability.
4. Section-name normalization or aliasing.
