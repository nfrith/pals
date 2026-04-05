# Software Factory

This fixture is a forward-looking design reference for the Delamain construct in ALS.

It exists to pressure-test a backlog-style software delivery model without relying on entity variants.

## Purpose

- Show one module where every record is the same kind of thing: a software work item.
- Keep `kind` as an ordinary enum for work classification: `bug`, `feature`, `hotfix`, `experiment`.
- Treat `status` differently from `kind` by binding it to a named Delamain instead of a plain enum.
- Keep the Delamain graph in `v1/delamains/` while declaring an explicit Delamain registry in `shape.yaml`.
- Show lifecycle phases as required Delamain metadata, not as a separate first-class primitive.
- Keep dispatcher and operator-console behavior out of the declaration surface for this draft.

## Important Note

- The module shape in this fixture uses the accepted Delamain surface from SDRs 018 and 020.
- This fixture now serves both as design-reference material and as a compiler/deploy reference for Delamain bundles.
- The draft surface here uses an explicit Delamain registry plus `type: delamain` in `shape.yaml`, with the primary definition file at `vN/delamains/<name>/delamain.yaml`.
- The Delamain file carries explicit `states`, state `actor`, state-local `path`, explicit `resumable`, optional `session-field`, path-valued optional `sub-agent`, explicit `transitions`, transition `class`, and phase order.
- This draft also paints Delamain-local prompt assets inside the Delamain bundle: one state agent markdown file per agent-owned state under `agents/`, plus optional helper prompts under `sub-agents/`.
- Delamain-local prompt asset paths are authored relative to the Delamain bundle root, not relative to the module bundle root.
- The fixture also sketches Delamain-owned resumable session fields, which are appended after the shape-declared frontmatter fields instead of being declared explicitly in `shape.yaml`.
- The fixture already satisfies the accepted restriction that each effective entity schema may bind at most one Delamain.
- The fixture also checks in the downstream Claude projection under `.claude/delamains/development-pipeline/`, which mirrors the deploy output for the bound Delamain bundle.

## Module

1. `factory`: software work items moving through one `development-pipeline` Delamain

## Design Goal

Use this fixture to test whether ALS can model:

- business classification with a normal enum
- operational state with a Delamain-bound field
- lifecycle grouping as phase metadata
- structural schema and workflow graph living in different authored files
- graph coherence through explicit transition classes

without collapsing those concerns back into one oversized `status` enum plus prose rules elsewhere.
