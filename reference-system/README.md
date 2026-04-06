# Reference System

This directory is the working reference implementation for ALS v1. It is also the single canonical fixture and remains the active design sandbox for richer body-contract work.

## Purpose

- The reference system now carries the former centralized structural modules, the rich-body document modules, the `observability` module, and the `factory` Delamain module inside one ALS system.
- `backlog`, `experiments`, `client-registry`, `dotfiles`, and the centralized `people` contract keep the default compiler fixture surface grounded in realistic structural data.
- `incident-response`, `operations`, `research`, `planning`, `evals`, and the governance/infra modules continue to exercise the richer body schema direction based on SDR 006 and SDR 007.
- `factory` now brings the Delamain reference surface into the same host, including state-agent prompts, resumable session fields, and Claude Delamain projection coverage.
- The goal is to keep one canonical fixture that is still easy to inspect and revise before further compiler work begins.

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

## Structural Coverage

- `backlog`, `experiments`, `client-registry`, and `dotfiles` now live in this reference system unchanged from the former centralized happy-path fixture.
- The default compiler sandbox and most negative tests now run against this reference system rather than a separate structural fixture.
- The `people` module acts as the shared collaborator registry for both the structural modules and the richer operational documents.

## Rich Document Coverage

- The workspace-scoped rich-body modules now cover runbooks, incident reports, research syntheses, planning dossiers, and eval specs in the same merged fixture.
- Together they pressure-test the current body contract through outline-structured incident reports, mostly freeform operational and research documents, quoted evidence, fenced code, and explicit GFM tables.
- The richer operational records continue to use their original person ids, but those supporting person records now conform to the shared centralized collaborator contract.
- The canonical source remains `.als/modules/...`; the checked-in `.claude/skills/` projection is a downstream artifact kept in sync with those module bundles.

## Delamain Coverage

- `factory` adds a Delamain-bound `status` field, state-owned prompt assets, resumable session fields, and Delamain bundles with dispatcher source to the reference system.
- The checked-in `.claude/delamains/development-pipeline/` tree mirrors the current downstream Claude projection for that bundle, but intentionally omits vendored `dispatcher/node_modules/` while keeping the lightweight checked-in `dispatcher/bun.lock`.
- The standalone `software-factory` fixture no longer exists. Delamain validation and deploy coverage now run through this merged host.

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

- This fixture also demonstrates the ALS-native module bundle layout under `.als/modules/<module>/vN/`.
- Each module version is treated as a bundle that can hold both `shape.yaml` and `skills/`.
- `system.yaml` lists the live active skill ids rather than harness-specific file paths.
- Each skill lives in its own directory with `SKILL.md` as the entrypoint.
- The directory form is intentional: skills may later grow supporting files such as `references/`, `assets/`, `scripts/`, or archived notes without changing the top-level module contract.
- Harness folders like `.claude/` are treated as downstream projections, not the canonical source of module skills.
- This fixture now checks in downstream Claude projections under `.claude/skills/` and `.claude/delamains/` for the merged active bundles.

## Module v2 Paint

- The `evaluations` module also demonstrates a completed `v1 -> v2` cutover.
- `system.yaml` points `evaluations` at `version: 2`, so the live system snapshot is post-migration rather than merely prepared-for-migration.
- `.als/modules/evaluations/v2/` carries the next shape, the unchanged skill bundle, and a `migrations/` directory owned by the `v2` bundle.
- The schema change shown here is intentionally modest:
  - frontmatter `decision` becomes `outcome`
  - a required `owner` field is introduced
  - the final body section name becomes `OUTCOME`
- The live evaluation records under `governance/evaluations/` are already shown in their migrated `v2` form.
