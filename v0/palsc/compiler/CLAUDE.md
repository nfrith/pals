# v0 — Shape Compiler (First Take)

Created: 2026-03-15, single session exploration.

## What This Is

A proof-of-concept shape compiler that validates PALS module directories against a compact YAML shape definition. The idea: describe what a directory should look like in ~20-40 lines of YAML, then run a machine that checks every file in that directory conforms.

This is the first take — exploratory, not production. It exists to test whether the shape language works across flat, 2-level, and 3-level module hierarchies.

## The Shape Language (SHAPE.yaml)

A single YAML file captures everything about a module's expected structure: entities, hierarchy, field types, body sections, and references. Type shorthand keeps it compact.

| Notation | Meaning |
|---|---|
| `string`, `number`, `date` | scalar types |
| `id` | identity field (filename stem must match) |
| `enum(a, b, c)` | restricted string values |
| `?` suffix | nullable |
| `[]` suffix | array |
| `ref(entity)` | same-module reference |
| `ref(module/entity)` | cross-module reference |
| `prose` | body section: markdown prose |
| `list` | body section: markdown list |
| `prose\|list` | body section: either |
| `parent: entity via field` | declares hierarchy |

Path templates use `{id}` for self-ID and `{parent_entity}` for ancestor IDs.

## How It Works

```
SHAPE.yaml → shape parser → internal model → validation pipeline → diagnostics JSON
```

**Parser layer** (`src/parser/`):
- `field-shorthand.ts` — parses `enum(a,b)[]?` notation into typed field descriptors
- `path-template.ts` — parses `{id}` path templates, matches concrete paths, handles repeated placeholders
- `shape-parser.ts` — parses full SHAPE.yaml into a `ShapeModule` model

**Validator layer** (`src/validator/`):
- `runtime.ts` — orchestrates the 7-phase validation pipeline from `record-validation.md`
- `frontmatter.ts` — validates fields against type contracts (id, string, number, date, enum, ref, arrays, nullability)
- `body.ts` — validates body sections (presence, null markers, prose/list classification)
- `identity.ts` — filename-stem matching, qualified duplicate detection across nested hierarchies
- `references.ts` — `pals://` URI parsing and structural validation
- `diagnostics.ts` — all 26 diagnostic codes from `diagnostic-codes.md`

**Dependencies**: gray-matter (frontmatter parsing), yaml (SHAPE.yaml parsing), zod (available but not yet wired — frontmatter validation is hand-coded in this take), unified/remark-parse (available but body classification uses a simpler line-based heuristic), glob, vitest, tsx.

## What It Validates

All three pristine-happy-path fixture modules pass clean:
- **people** — flat, 1 entity, 2 records
- **backlog** — 2-level (epic → story), 3 records, cross-module refs to people
- **experiments** — 3-level (program → experiment → run), 8 records, duplicate local IDs across parents

Negative cases tested (backlog):
- Unknown frontmatter field → `PAL-RV-FM-002`
- Invalid enum value → `PAL-RV-FM-003`
- Missing body section → `PAL-RV-BODY-001`
- Filename/id mismatch → `PAL-RV-ID-001`
- Null in non-nullable section → `PAL-RV-BODY-003`

## Running It

```bash
cd v0/palsc/compiler
npm install
npx tsx src/index.ts shapes/backlog.yaml <path-to-module-dir>
npx vitest run   # 31 tests
```

## What's Deferred

- Cross-module reference resolution (requires workspace discovery — TODO item 6)
- Nested parent consistency cross-check (TODO item 3)
- Precise body value_type AST classification via remark (TODO item 13 — uses line-based heuristic)
- Zod integration for frontmatter validation (types are checked manually)
- SHAPE.yaml → PALS MODULE.md + .schema/*.md generation
- Conversational shape authoring skill

## Design Decisions Made

1. **SHAPE.yaml path templates use `{id}` and `{entity}` shorthand**, not the spec's `<UPPERCASE-ID>`. The parser translates between the two. Readability over spec-fidelity at the authoring layer.

2. **Identity keys are qualified by parent chain.** `experiment/EXP-0001` under `PRG-0001` is a different canonical identity than under `PRG-0002`. The `buildCanonicalKey` function walks the parent chain using path template bindings.

3. **gray-matter auto-parses dates.** The `date` field validator accepts both `YYYY-MM-DD` strings and JavaScript `Date` objects since gray-matter converts date-like strings.

4. **Body classification is a simple heuristic.** Lines starting with `- `, `* `, or `1. ` are list items; everything else is prose. Mixed content is accepted by `prose|list`. This is intentionally loose per TODO item 13.

5. **Validation runs directly from the parsed shape model.** No code generation step — the validator interprets the shape at runtime. Codegen can be added later if needed for CI caching or distribution.

## Session Context

This emerged from a conversation about whether gray-matter and existing tools could stand up what the PALS reference specs describe. The answer: yes, for the validation surface. The shape language is the novel contribution — a compact authoring format that sits above the verbose PALS schema files. The next take might wire in Zod for type-safe validation, add the authoring skill, or explore shape-to-PALS-file generation.
