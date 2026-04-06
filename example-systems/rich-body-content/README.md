# Rich Body Content

This fixture is the active design sandbox for the forward-looking ALS v1 body contract.

## Purpose

- The records here already exercise richer Markdown than the original happy-path fixture.
- The module shapes here intentionally use a draft body schema based on SDR 006 and SDR 007.
- The fixture now also carries the `observability` module that exercises mixed markdown and JSONL entities inside one ALS system.
- The fixture also carries document-style `people`, `incident-response`, `operations`, `research`, `planning`, and `evals` modules so rich-body validation now lives in one host system.
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

## Multi-Format Coverage

- `observability` keeps a markdown `dashboard` entity alongside a JSONL `metric-stream` entity.
- The dashboard record links to the JSONL entity through a normal ALS ref, so this fixture now covers the current cross-format ref contract.
- The rejected mixed-schema JSONL artifact remains checked in at `content/rejected/mixed-schema-stream.jsonl` so it stays outside the validated module tree.

## Rich Document Coverage

- The workspace-scoped modules now cover runbooks, incident reports, research syntheses, planning dossiers, eval specs, and supporting people records in the same merged fixture.
- Together they pressure-test the current body contract through outline-structured incident reports, mostly freeform operational and research documents, quoted evidence, fenced code, and explicit GFM tables.
- The `people` module primarily supplies realistic cross-module references while still validating clean inside the merged host.
- The canonical source remains `.als/modules/...`; the checked-in `.claude/skills/` projection is a downstream artifact kept in sync with those module bundles.

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

- This fixture also demonstrates the ALS-native module bundle layout under `.als/modules/<module>/v1/`.
- Each module version is treated as a bundle that can hold both `shape.yaml` and `skills/`.
- `system.yaml` lists the live active skill ids rather than harness-specific file paths.
- Each skill lives in its own directory with `SKILL.md` as the entrypoint.
- The directory form is intentional: skills may later grow supporting files such as `references/`, `assets/`, `scripts/`, or archived notes without changing the top-level module contract.
- Harness folders like `.claude/` are treated as downstream projections, not the canonical source of module skills.
- This fixture now checks in the downstream Claude projection under `.claude/skills/` for both the original host modules and the imported workspace-scoped modules.

## Module v2 Paint

- The `evaluations` module also demonstrates a completed `v1 -> v2` cutover.
- `system.yaml` points `evaluations` at `version: 2`, so the live system snapshot is post-migration rather than merely prepared-for-migration.
- `.als/modules/evaluations/v2/` carries the next shape, the unchanged skill bundle, and a `migrations/` directory owned by the `v2` bundle.
- The schema change shown here is intentionally modest:
  - frontmatter `decision` becomes `outcome`
  - a required `owner` field is introduced
  - the final body section name becomes `OUTCOME`
- The live evaluation records under `governance/evaluations/` are already shown in their migrated `v2` form.
