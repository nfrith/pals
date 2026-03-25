# List Item Enum Support

## Status

Accepted

## Context

- ALS v1 already supports scalar `enum` fields with `allowed_values`.
- ALS v1 already supports `list` fields, but list items were limited to `string` and `ref`.
- That left no way to express a frontmatter field whose members must each be one of a declared enum set.
- Real module shapes need ordered multi-value classification such as bookmark folders, where a record may belong to more than one declared bucket.

## Decision

- `list.items.type` may be `enum`.
- `list.items.type: enum` must declare `allowed_values`.
- `allowed_values` entries must be unique for both scalar `enum` fields and list-item enums.
- `list<enum>` validates each item independently against the declared `allowed_values`.
- `list<enum>` rejects duplicate enum members.
- Duplicate rejection is scoped to `list<enum>` in this decision. It does not redefine uniqueness for `list<string>` or `list<ref>`.
- Empty lists remain valid. This decision does not add frontmatter list cardinality constraints.
- This decision does not add a separate `set` field type.

## Normative Effect

- Required: `list.items.type: enum` must include at least one unique allowed value.
- Required: each `list<enum>` member must be a string.
- Required: each `list<enum>` member must appear in `allowed_values`.
- Required: repeated valid enum members in one `list<enum>` field are invalid from the second occurrence onward.
- Allowed: `[]` for non-null `list<enum>` fields.
- Allowed: ordered enum lists whose members are all distinct and declared.
- Rejected: non-string `list<enum>` members.
- Rejected: string `list<enum>` members outside the declared enum set.
- Rejected: duplicate entries inside `allowed_values`.
- Rejected: using this decision to imply uniqueness for non-enum lists.

## Compiler Impact

- Extend shape parsing so `list.items` accepts `type: enum` plus `allowed_values`.
- Reject missing or duplicate `allowed_values` in module shape validation with `SHAPE_INVALID`.
- Reuse existing frontmatter diagnostic categories for list-enum validation:
  - non-array field value: `FM_TYPE_MISMATCH`
  - non-string enum item: `FM_ARRAY_ITEM` with no `reason`
  - out-of-set enum string: `FM_ENUM_INVALID`
- Reuse `FM_ARRAY_ITEM` for duplicate enum members and emit stable `reason: frontmatter.list_item.duplicate` for that subcase.

## Docs and Fixture Impact

- Update the canonical shape-language reference to document `list<enum>`, unique `allowed_values`, empty-list behavior, and duplicate rejection.
- Add positive tests proving valid `list<enum>` usage and empty-list acceptance.
- Add negative tests covering missing `allowed_values`, duplicate `allowed_values`, non-string members, out-of-set strings, and duplicate enum members.

## Alternatives Considered

- Generalize list items to every field type in one step.
- Rejected because it would force unrelated decisions about `number`, `date`, `id`, nested lists, and other item-level semantics.
- Allow duplicate enum members and defer uniqueness entirely to higher layers.
- Rejected because ALS can express this constraint directly, and tightening now is easier than introducing stricter duplicate rejection later.
- Add a separate `set` type instead of extending `list`.
- Rejected for now because ordered multi-value enum fields are still usefully modeled as lists, and a distinct set type can be evaluated later if experience justifies it.
