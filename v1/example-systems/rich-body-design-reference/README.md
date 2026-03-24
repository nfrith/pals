# Rich Body Design Reference

This fixture is a forward-looking design reference for ALS v1 record-body semantics.

It exists alongside `centralized-metadata-happy-path`, not as a replacement for it.

## Purpose

- `centralized-metadata-happy-path` remains the structural smoke fixture for the current compiler.
- This fixture is intentionally centered on rich record bodies:
  - explicit `h1` title regions
  - explicit preamble regions
  - `h2` sections with `h3` and `h4` nesting
  - nested lists
  - blockquotes
  - fenced code blocks
  - GFM tables declared explicitly in shape YAML
- The records are meant to look like documents real agent systems would maintain during operations, research, planning, and evaluation.

## Important Note

- The module shapes in this fixture intentionally use the proposed body-contract direction from SDR 006 and SDR 007.
- That means these shape files are design-reference material first. They are not intended to be the current compiler smoke target before the new body model is implemented.
- The current draft in this fixture uses `body.title.source.kind`, `content.mode: freeform | outline`, exact `outline.nodes`, and `outline.preamble` where prose is allowed before the first required heading.
- The fixture now also uses the canonical ALS module-bundle layout under `.als/modules/<module>/vN/` with in-bundle skill directories.

## Modules

1. `people`: operators and collaborators referenced from other modules
2. `incident-response`: incident and recovery reporting
3. `operations`: runbooks and execution procedures
4. `research`: synthesis documents with quoted evidence and decisions
5. `planning`: task dossiers with assumptions, alternatives, and execution transcripts
6. `evals`: evaluation specifications and adjudication rules

## Design Goal

Use this fixture to pressure-test the future body language against realistic, diverse records instead of designing only from flat happy-path examples.
