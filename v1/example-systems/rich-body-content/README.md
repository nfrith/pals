# Rich Body Content

This fixture is the active design sandbox for the forward-looking ALS v1 body contract.

## Purpose

- The records here already exercise richer Markdown than the original happy-path fixture.
- The module shapes here intentionally use a draft body schema based on SDR 006 and SDR 007.
- The goal is to make the YAML surface easy to inspect and revise before compiler work begins.

## Draft Body Surface

The shapes in this fixture use:

- `body.title.source.kind`
- optional `body.preamble`
- ordered `body.sections`
- `content.mode: freeform | outline`
- unified `content.blocks` for `freeform`
- table blocks declared as `table.syntax: gfm`
- exact `outline.nodes` with explicit heading text and explicit heading depth
- optional `outline.preamble` for prose before the first required outlined heading

## Intentional Choices In This Fixture

- Most existing records in this fixture currently render `h1` as the record `id`, not the human-readable `title`.
- Most shapes here still bind `body.title.source.kind: field` to `id`, but `playbooks` now demonstrates `kind: template`.
- Those are fixture choices, not spec claims about what `h1` should normally be.
- `body.preamble` is omitted in most shapes because the current records mostly begin their declared sections immediately after the `h1`.

## Current Riff Targets

- `body.title.source` now needs clear reference docs for all three source kinds: `field`, `authored`, and `template`.
- `body.preamble` and section-level `preamble` should stay the same exact schema shape unless a real counterexample appears.
- How much optionality should `outline` nodes support beyond required ordered nodes plus explicit `preamble`?
- How much block-level detail belongs in the core shape language before mdast coverage expands further?

## Skill Bundle Paint

- This fixture also paints a proposed ALS-native module bundle layout under `.als/modules/<module>/v1/`.
- Each module version is treated as a bundle that can hold both `shape.yaml` and `skills/`.
- `system.yaml` now lists module-local skill ids rather than harness-specific file paths.
- Each skill lives in its own directory with `SKILL.md` as the entrypoint.
- The directory form is intentional: skills may later grow supporting files such as `references/`, `assets/`, `scripts/`, or archived notes without changing the top-level module contract.
- Harness folders like `.claude/` are treated as downstream projections, not the canonical source of module skills.

## Module v2 Paint

- The `evaluations` module now also demonstrates a completed `v1 -> v2` cutover.
- `system.yaml` points `evaluations` at `version: 2`, so the live system snapshot is post-migration rather than merely prepared-for-migration.
- `.als/modules/evaluations/v2/` carries the next shape, the unchanged skill bundle, and a `migrations/` directory owned by the `v2` bundle.
- The painted schema change is intentionally modest:
  - frontmatter `decision` becomes `outcome`
  - a required `owner` field is introduced
  - the final body section name becomes `OUTCOME`
- The live evaluation records under `governance/evaluations/` are already shown in their migrated `v2` form.
