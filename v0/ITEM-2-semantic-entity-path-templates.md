# Item 2 Decision Record: Semantic Entity Path Templates

Status: accepted and implemented
Related TODO item: `TODO.md` -> `### 2. Entity path pattern matching has no formal definition`

## Problem

`MODULE.md` uses `entity_paths` strings such as:

```yaml
entity_paths:
  epic: epics/<EPIC-ID>.md
  program: programs/<PROGRAM-ID>/<PROGRAM-ID>.md
  experiment: programs/<PROGRAM-ID>/experiments/<EXPERIMENT-ID>/<EXPERIMENT-ID>.md
  run: programs/<PROGRAM-ID>/experiments/<EXPERIMENT-ID>/runs/<RUN-ID>.md
```

The compiler already depends on these strings for:

1. entity inference from record paths
2. record-path validation against module layout
3. later nested-parent consistency work

But there is no formal path-template language yet. That leaves core questions open:

1. what exactly a placeholder matches
2. whether repeated placeholders must bind the same value
3. whether placeholder names are meaningful or just decorative
4. how to handle ambiguous matches across multiple entity patterns

Without a real definition, two compilers could infer different entities from the same path or disagree on whether a record lives at the correct location.

## Decision Summary

Treat `entity_paths` as a small semantic path-template language, not as regexes, globs, or documentation-only examples.

Keep these rules:

1. `entity_paths` remains a module-local filesystem layout contract.
2. Record paths are validated relative to the module root.
3. Entity inference still comes from matching a record path against declared `entity_paths`.

Add these rules:

1. Path patterns are exact slash-separated templates with named placeholders.
2. Placeholder names are semantic and must correspond to declared module entities.
3. Placeholder names are canonicalized from entity names, not arbitrarily chosen by authors.
4. Repeated placeholders in one pattern must bind the same value.
5. A concrete record path must match exactly one entity pattern. Zero or multiple matches are both errors.
6. Declaration order is not a tie-breaker.
7. The terminal filename segment for an entity must be exactly `<SELF-PLACEHOLDER>.md`.
8. The module contract is invalid if any two declared entity templates overlap.

## Proposed Path Template Model

`entity_paths` values are relative path templates evaluated against a normalized module-relative path using `/` separators.

Examples:

- `epics/<EPIC-ID>.md`
- `programs/<PROGRAM-ID>/<PROGRAM-ID>.md`
- `programs/<PROGRAM-ID>/experiments/<EXPERIMENT-ID>/<EXPERIMENT-ID>.md`

### Segment Rules

A path template is a `/`-separated sequence of segment patterns.

Each segment pattern is either:

1. a literal segment, for example `programs` or `experiments`
2. a segment containing exactly one placeholder with optional literal prefix/suffix, for example:
   - `<PROGRAM-ID>`
   - `<EPIC-ID>.md`

Current baseline restrictions:

1. placeholders do not cross `/` boundaries
2. a placeholder matches a non-empty string
3. each segment may contain at most one placeholder
4. literal text in a segment matches exactly and case-sensitively

Not supported in the baseline:

1. `*`, `**`, `?`, or glob syntax
2. regex syntax
3. alternation
4. optional segments
5. multiple placeholders in one segment

### Template Validity Rules

An `entity_paths` template is invalid if any of the following hold:

1. it is an absolute path
2. it contains empty segments
3. it contains `.` or `..` as a segment
4. it ends with `/`
5. it contains stray `<` or `>` characters that do not form one complete placeholder token
6. it contains an empty placeholder like `<>`
7. it uses any placeholder token that is not the canonical placeholder for some declared entity key in the same module

These are module-contract validation failures, not record-level match failures.

## Placeholder Naming Rules

Placeholder names are semantic, not decorative.

For an entity declared by key `<entity-name>` in `MODULE.md` `entity_paths`, the canonical placeholder token is:

`<UPPERCASE(entity-name)-ID>`

Examples:

1. `epic` -> `<EPIC-ID>`
2. `story` -> `<STORY-ID>`
3. `program` -> `<PROGRAM-ID>`
4. `experiment` -> `<EXPERIMENT-ID>`
5. `run` -> `<RUN-ID>`
6. `build-step` -> `<BUILD-STEP-ID>`

Forward mapping:

1. take the declared entity key
2. uppercase it
3. append `-ID`
4. wrap in angle brackets

Reverse mapping:

1. remove the surrounding `<` and `>`
2. remove exactly one trailing `-ID`
3. lowercase the remaining token
4. interpret the result as the referenced entity key

Examples:

1. `<PROGRAM-ID>` -> `program`
2. `<BUILD-STEP-ID>` -> `build-step`
3. `<TRANSACTION-ID-ID>` -> `transaction-id`

This round-trip assumes entity keys are lowercase-normalized. Tightening the entity-key grammar belongs to the normative schema update, not to this decision record itself.

Rules:

1. every placeholder name used in any `entity_paths` pattern must correspond to a declared entity key in that same module
2. arbitrary names like `<A>`, `<X>`, `<PRIMARY>`, or `<PARENT-ID>` are invalid
3. placeholder matching is case-sensitive
4. an entity's own pattern must end with a final segment exactly equal to `<SELF-PLACEHOLDER>.md`
5. earlier occurrences of the self placeholder are allowed, but repeated-binding equality still applies
6. non-self placeholders are semantic references to other declared entity slots, not arbitrary capture labels
7. this decision does not yet define which non-self placeholders are legal or required for a given entity beyond the self-placeholder rule; that hierarchy-specific legality is deferred to TODO item `3`

This means placeholder names become stable logical slot names shared across patterns.

## Repeated Placeholder Semantics

If the same placeholder name appears more than once in one pattern, all occurrences must bind the same string value.

Example:

```yaml
program: programs/<PROGRAM-ID>/<PROGRAM-ID>.md
```

Valid match:

`programs/PRG-0001/PRG-0001.md`

Invalid match:

`programs/PRG-0001/PRG-9999.md`

This rule applies anywhere the same placeholder name repeats, including filename stems.

## Ambiguity Resolution

Entity inference must not depend on declaration order.

Given a concrete module-relative record path:

1. evaluate the path against every declared entity pattern
2. if exactly one pattern matches, infer that entity
3. if zero patterns match, inference fails
4. if more than one pattern matches, inference also fails

No "first match wins," "most specific wins," or "longest match wins" rule is added in the baseline.

The contract is simpler:

a valid record path must be unambiguous under the declared module templates.

### Template-Set Unambiguity

Module contracts must also be unambiguous before any concrete record is checked.

For one module, the declared `entity_paths` template set must be pairwise non-overlapping:

1. if two different entity templates can both match the same normalized module-relative path, the module contract is invalid
2. this is a module-contract error, not a record-specific inference error

Example invalid overlap:

```yaml
entity_paths:
  epic: items/<EPIC-ID>.md
  story: items/<STORY-ID>.md
```

Both templates can match `items/ANYTHING.md`, so the contract itself is ambiguous.

## Example Shapes

### Example 1: Flat module

```yaml
entity_paths:
  epic: epics/<EPIC-ID>.md
  story: stories/<STORY-ID>.md
```

Matches:

1. `epics/EPIC-0001.md` -> `epic` with binding `EPIC-ID = EPIC-0001`
2. `stories/STORY-0002.md` -> `story` with binding `STORY-ID = STORY-0002`

### Example 2: Nested module with semantic ancestor slots

```yaml
entity_paths:
  program: programs/<PROGRAM-ID>/<PROGRAM-ID>.md
  experiment: programs/<PROGRAM-ID>/experiments/<EXPERIMENT-ID>/<EXPERIMENT-ID>.md
  run: programs/<PROGRAM-ID>/experiments/<EXPERIMENT-ID>/runs/<RUN-ID>.md
```

Path:

`programs/PRG-0001/experiments/EXP-0001/runs/RUN-0001.md`

Match:

```yaml
entity: run
bindings:
  PROGRAM-ID: PRG-0001
  EXPERIMENT-ID: EXP-0001
  RUN-ID: RUN-0001
```

The shared ancestor placeholder names are intentional:

1. `<PROGRAM-ID>` in `experiment` means the same logical slot as `<PROGRAM-ID>` in `program`
2. `<PROGRAM-ID>` and `<EXPERIMENT-ID>` in `run` mean the same logical slots as in the parent entity patterns

### Example 3: Invalid arbitrary placeholder names

```yaml
entity_paths:
  program: programs/<A>/<A>.md
  experiment: programs/<X>/experiments/<Y>/<Y>.md
```

This is invalid because `<A>`, `<X>`, and `<Y>` do not correspond to declared entity keys.

### Example 4: Invalid undeclared placeholder

```yaml
entity_paths:
  story: stories/<STORY-ID>.md
  subtask: stories/<STORY-ID>/subtasks/<TASK-ID>.md
```

If `task` is not a declared entity key in the same module, `<TASK-ID>` is invalid.

The self placeholder for `subtask` must be `<SUBTASK-ID>`, derived from the declared entity key `subtask`.

### Example 5: Invalid self placeholder placement

```yaml
entity_paths:
  story: stories/prefix-<STORY-ID>.md
```

This is invalid because the final segment is not exactly `<STORY-ID>.md`.

Likewise, this is invalid:

```yaml
entity_paths:
  story: stories/<STORY-ID>/record.md
```

The self placeholder may appear earlier in the path, but the terminal file segment must still be `<STORY-ID>.md`.

## Path Matching Algorithm

For a concrete record path relative to the module root:

1. normalize path separators to `/`
2. split both the candidate path and template on `/`
3. segment count must match exactly
4. match each segment left-to-right
5. for literal-only segments, require exact string equality
6. for placeholder segments, require literal affixes to match and capture the placeholder substring
7. reject empty captures
8. if a placeholder name was already captured earlier in the same pattern, the new capture must equal the earlier value
9. if all segments match, the template matches and yields a binding map

The binding map is the semantic output of path matching and is available to later validation phases.

## Boundary Note: Nested Parent Consistency

This decision defines only path-template syntax, matching, and placeholder semantics.

For item `2`:

1. `entity_paths` now has a formal matching model
2. successful matching yields a binding map keyed by canonical placeholder name
3. how those bindings are compared against canonical parent refs in nested hierarchies is deferred to TODO item `3`
4. this decision governs matching candidate record paths only; it does not define module file discovery or exclusion of metadata files like `MODULE.md` or `.schema/*`

Item `3` should build on this decision instead of redefining path matching again.

## Why This Direction

1. It keeps `entity_paths` easy to read and author.
2. It avoids turning module contracts into regex mini-programs.
3. It makes nested-path reasoning possible without inventing a heavier schema layer.
4. It makes typos in placeholder names machine-detectable.
5. It removes declaration-order ambiguity from entity inference.
6. It gives the compiler a stable binding model to reuse in later validation steps.

## Explicit Non-Goals For This Decision

1. Do not introduce regex-powered path matching.
2. Do not support arbitrary placeholder names.
3. Do not add wildcard or optional segment semantics.
4. Do not define the full nested-parent consistency algorithm here.
5. Do not redefine canonical logical URI construction; that remains governed by `identity_contract`.

## Repo Surfaces Updated By This Decision

This decision required coordinated updates in at least:

1. `palsc/references/module-schema-definition.md`
2. `palsc/references/frontmatter-schema-definition.md`
3. `palsc/references/record-validation.md`
4. `palsc/references/diagnostic-codes.md`
5. `TODO.md`

This repository is still pre-release. This decision is now implemented in the normative spec files and tracked as resolved in `TODO.md`.
