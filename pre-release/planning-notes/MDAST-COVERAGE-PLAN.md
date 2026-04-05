# Markdown Support TODO

This file inventories the current `v1` Markdown support in the ALS compiler, compares it against the installed `mdast` node set, and maps the work required to close the gaps.

This is an inventory and implementation-planning document, not a spec decision record.

## Current compiler model

| Layer | What we have today | Notes |
| --- | --- | --- |
| Section discovery | Record bodies are split with a raw `^## (.+)$` regex | Section structure is not mdast-driven |
| Section parsing | Each section body is parsed with `fromMarkdown(trimmed)` | No GFM or frontmatter extensions are passed |
| Section schema | `allowed_blocks` only allows `paragraph`, `bullet_list`, `ordered_list` | `bullet_list` and `ordered_list` are ALS aliases over mdast `list` |
| Extra block toggles | `allow_subheadings`, `allow_blockquotes`, `allow_code_blocks` | These are ALS booleans, not raw mdast node names |
| Top-level validation | Unknown top-level nodes fail with `BODY_CONSTRAINT_VIOLATION` | Only `paragraph`, `list`, `heading`, `blockquote`, `code` are recognized |
| Phrasing validation | No explicit phrasing-node policy | Many inline nodes pass implicitly inside allowed paragraphs/lists |
| Frontmatter refs | ALS refs are parsed by regex as markdown links | This is separate from mdast body parsing |

## What the current v1 system uses

- The reference system shape files only declare `paragraph`, `bullet_list`, and `ordered_list`.
- There are no `allow_subheadings: true` hits under `example-systems/centralized-metadata-happy-path/.als`.
- There are no `allow_blockquotes: true` hits under `example-systems/centralized-metadata-happy-path/.als`.
- There are no `allow_code_blocks: true` hits under `example-systems/centralized-metadata-happy-path/.als`.
- In practice, the current fixture is narrower than the compiler's already-small Markdown model.

Representative shape examples:

- `example-systems/centralized-metadata-happy-path/.als/modules/backlog/v1/shape.yaml`
- `example-systems/centralized-metadata-happy-path/.als/modules/experiments/v2/shape.yaml`

## Status legend

- `Supported`: explicitly recognized by the compiler and expressible in section contracts
- `Supported via alias/flag`: supported, but not exposed as the raw mdast node name
- `Implicit`: parser can emit it inside an allowed parent and the compiler does not govern it explicitly
- `Rejected`: parser can emit it, but top-level validation rejects it today
- `Unavailable`: current parser configuration does not emit it as a dedicated mdast node
- `Blocked`: depends on another missing feature
- `Internal`: structural node, not something section contracts declare directly

## mdast coverage inventory

The installed `@types/mdast` package exposes the following relevant node set.

### Flow, definition, and frontmatter nodes

| mdast node | Status today | How it behaves now |
| --- | --- | --- |
| `root` | Internal | Container only |
| `paragraph` | Supported | Directly expressible in `allowed_blocks` |
| `list` | Supported via alias/flag | Expressed as `bullet_list` or `ordered_list` depending on `ordered` |
| `listItem` | Internal | Accepted only as a child of `list` |
| `heading` | Supported via alias/flag | Only through `allow_subheadings` |
| `blockquote` | Supported via alias/flag | Only through `allow_blockquotes` |
| `code` | Supported via alias/flag | Only through `allow_code_blocks` |
| `definition` | Rejected | Parser emits it for reference-style link definitions; validator rejects unknown top-level block |
| `html` as flow content | Rejected | Parser emits top-level `html`; validator rejects it |
| `thematicBreak` | Rejected | Parser emits it; validator rejects it |
| `table` | Unavailable | No GFM extension is enabled, so tables do not become `table` nodes today |
| `tableRow` | Blocked | Cannot appear until `table` support exists |
| `tableCell` | Blocked | Cannot appear until `table` support exists |
| `footnoteDefinition` | Unavailable | No footnote extension is enabled; no schema slot exists |
| `yaml` | Unavailable | `gray-matter` strips document frontmatter before mdast parsing, and no mdast frontmatter extension is enabled |

### Phrasing nodes

| mdast node | Status today | How it behaves now |
| --- | --- | --- |
| `text` | Implicit | Passes inside allowed paragraphs/lists |
| `strong` | Implicit | Passes inside allowed paragraphs/lists |
| `emphasis` | Implicit | Passes inside allowed paragraphs/lists |
| `inlineCode` | Implicit | Passes inside allowed paragraphs/lists |
| `link` | Implicit | Passes inside allowed paragraphs/lists |
| `image` | Implicit | Passes inside allowed paragraphs/lists |
| `break` | Implicit | Not modeled, but can appear inside paragraphs |
| `html` as phrasing content | Implicit | Inline HTML passes inside paragraphs because there is no phrasing-node policy |
| `linkReference` | Blocked | Inline node may parse, but required top-level `definition` is rejected |
| `imageReference` | Blocked | Same problem as `linkReference` |
| `delete` | Unavailable | No GFM strikethrough support is enabled |
| `footnoteReference` | Unavailable | No footnote support is enabled; also depends on missing `footnoteDefinition` |

### Custom or plugin-defined mdast nodes

| Node kind | Status today | How it behaves now |
| --- | --- | --- |
| Custom mdast nodes from plugins or module augmentation | Unsupported | No parser extensions, no schema model, no validator dispatch, no extension registry |

## Parser probe results with the current setup

These are concrete probe results from the current `fromMarkdown()` call shape.

| Sample markdown | Current parsed result | Meaning |
| --- | --- | --- |
| `| a | b |` table syntax | top-level `paragraph` | Tables are not enabled |
| `~~gone~~` | top-level `paragraph` | Strikethrough is not enabled as `delete` |
| `[x][ref]` with `[ref]: https://example.com` | top-level `paragraph`, `definition` | Reference definitions are emitted and would currently fail validation |
| `***` | top-level `thematicBreak` | The parser emits this node today, but the validator rejects it |
| `<div>hi</div>` | top-level `html` | The parser emits flow HTML today, but the validator rejects it |
| `A [link](...) with \`code\` and ![img](x)` | paragraph children `text`, `link`, `inlineCode`, `image` | Phrasing nodes already pass implicitly |
| `inline <span>x</span>` | paragraph children `text`, `html`, `text`, `html` | Inline HTML currently passes implicitly |

## What we explicitly have today

### Implemented and contract-addressable

- `paragraph`
- `list`, expressed as:
  - `bullet_list`
  - `ordered_list`
- `heading`, only through `allow_subheadings`
- `blockquote`, only through `allow_blockquotes`
- `code`, only through `allow_code_blocks`

### Implemented only as implicit nested content

- `text`
- `strong`
- `emphasis`
- `inlineCode`
- `link`
- `image`
- `break`
- inline `html`

### Present in mdast but missing as ALS-supported document/section content

- `definition`
- flow `html`
- `thematicBreak`
- `table`
- `tableRow`
- `tableCell`
- `footnoteDefinition`
- `yaml`
- plugin-defined custom nodes

### Present in mdast but blocked by current parser configuration

- `delete`
- `table`
- `tableRow`
- `tableCell`
- `footnoteDefinition`
- `footnoteReference`
- `yaml`

### Present in mdast but effectively unusable with current validator behavior

- `linkReference`
- `imageReference`

These are effectively blocked because they depend on top-level `definition`, which the compiler currently rejects.

## TODO: implementation map

The map below breaks each gap into parser, schema, validator, tests, and docs work.

| Gap | Parser work | Schema work | Validator work | Tests needed | Docs needed |
| --- | --- | --- | --- | --- | --- |
| Flow `html` support | None for basic HTML; parser already emits it | Add `html` to section content model or add a dedicated `allow_html_blocks` flag | Recognize top-level `html` in the allowlist and decide whether inline `html` also needs policy | Positive and negative body tests for allowed/disallowed HTML blocks | Update shape-language docs and fixture examples |
| Inline `html` policy | None | If explicit control is desired, add phrasing-level policy fields | Walk phrasing content and reject or allow inline `html` intentionally instead of implicitly | Positive and negative tests for inline HTML inside paragraphs/lists | Document whether inline HTML is allowed, banned, or configurable |
| `thematicBreak` support | None; parser already emits it | Add `thematic_break` or `thematicBreak` to allowed section content | Extend top-level node mapping so thematic breaks can be allowed | Positive and negative body tests | Update docs with the supported spelling and examples |
| Reference definitions and ref-style links | None; parser already emits `definition` | Decide whether `definition` should be a legal top-level node in sections | Allow top-level `definition` when enabled; decide whether bare definitions are acceptable or must accompany reference nodes | Tests for `definition`, `linkReference`, and `imageReference` | Document whether reference-style links are supported |
| `linkReference` and `imageReference` usability | None beyond `definition` support | Possibly no new schema knob if they are accepted whenever definitions are allowed | Ensure validator does not reject the required `definition` sibling nodes | Positive tests for reference-style links and images | Note interaction with `definition` support |
| Tables (`table`, `tableRow`, `tableCell`) | Add GFM support to the markdown parser path | Add `table` to section content model | Accept `table` as a top-level node; nested row/cell nodes come along with it | Positive and negative tests for tables in allowed/disallowed sections | Document GFM table support |
| Strikethrough (`delete`) | Add GFM support to the markdown parser path | Decide whether phrasing nodes remain implicit or become configurable | If explicit phrasing policy is introduced, add `delete` handling there | Positive tests showing `delete` emission and acceptance/rejection | Document GFM strikethrough support or non-support |
| Footnotes (`footnoteReference`, `footnoteDefinition`) | Add footnote support to the parser path | Add section-content model for `footnoteDefinition`, and possibly phrasing policy for `footnoteReference` | Allow paired reference/definition nodes and validate them intentionally | Positive and negative tests for footnotes | Document whether footnotes are part of ALS v1 |
| `yaml` nodes inside markdown | Add frontmatter extension if section-local frontmatter is desired | Add `yaml` to the section content model only if ALS actually wants this | Decide whether section-local frontmatter is legal or should stay banned | Tests for YAML nodes if enabled; negative tests if kept unsupported | Document the policy clearly |
| Explicit phrasing-node policy | None required for current parser output | Introduce a new schema shape for allowed phrasing nodes if the project wants more than implicit pass-through | Extend AST walk to validate phrasing children explicitly | Positive and negative tests for `link`, `image`, `emphasis`, `strong`, `inlineCode`, `break`, inline `html`, and future GFM nodes | Update shape-language docs with the phrasing contract |
| Custom mdast/plugin nodes | Add parser/plugin registration mechanism | Add an extension point to the schema or decide to ban custom nodes | Add validator dispatch or extension hooks | Extension and regression tests | Document the extension mechanism or the explicit non-goal |

## Recommended order

If the goal is "full mdast coverage", the work should still be staged.

### Stage 1: policy decision

- [ ] Decide whether ALS wants full mdast coverage or a deliberately curated Markdown subset.
- [ ] Decide whether phrasing content should remain implicit or become an explicit part of section contracts.
- [ ] Decide whether GFM is in scope for v1 (`table`, `delete`, footnotes) or intentionally deferred.

### Stage 2: low-friction current-parser gaps

- [ ] Add support for `thematicBreak` if desired.
- [ ] Add support for flow `html` if desired.
- [ ] Decide on and implement `definition` support, which unblocks reference-style links and images.

### Stage 3: parser-extension features

- [ ] Add GFM table support.
- [ ] Add GFM strikethrough support.
- [ ] Add footnote support if it is in scope.

### Stage 4: model-quality improvements

- [ ] Add explicit phrasing-node policy if implicit pass-through is too loose.
- [ ] Add tests for every newly supported node type, including negative tests for disallowed content.
- [ ] Update the shape-language docs so the documented contract matches the implementation exactly.

## If the project does not want full mdast coverage

That is also a valid outcome, but it should be made explicit.

- [ ] Document the supported subset as an ALS-specific Markdown contract rather than "mdast support".
- [ ] Document that `bullet_list` and `ordered_list` are ALS aliases over mdast `list`.
- [ ] Document that section headers are discovered by regex, not by mdast section parsing.
- [ ] Add negative tests for every intentionally unsupported mdast node that the parser can emit today:
  - `definition`
  - flow `html`
  - `thematicBreak`
- [ ] Add explicit docs about GFM being unsupported if tables, footnotes, and strikethrough remain out of scope.

## Source pointers

- Compiler section parsing and validation:
  - `alsc/compiler/src/markdown.ts`
  - `alsc/compiler/src/schema.ts`
  - `alsc/compiler/src/validate.ts`
- ALS ref parsing:
  - `alsc/compiler/src/refs.ts`
- Installed mdast node definitions:
  - `alsc/compiler/node_modules/@types/mdast/index.d.ts`
- Current shape-language docs:
  - `skills/docs/references/shape-language.md`
- Current reference system shapes:
  - `example-systems/centralized-metadata-happy-path/.als/modules/backlog/v1/shape.yaml`
  - `example-systems/centralized-metadata-happy-path/.als/modules/experiments/v2/shape.yaml`
