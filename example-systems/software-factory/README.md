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

- The module shape in this fixture intentionally uses proposed workflow syntax from SDR 018.
- That means this fixture is design-reference material first. It is not intended to be a current compiler smoke target before the workflow primitive is implemented.
- The draft surface here uses an explicit Delamain registry plus `type: delamain_state` in `shape.yaml`, with companion files under `vN/delamains/`.
- The Delamain files carry explicit `states`, state `actor`, state-local `agent`, explicit `transitions`, transition `class`, stable transition `id`, and phase order.
- This draft also paints Delamain-local `agents`: one prompt file per agent-owned state, with explicit registry entries in the Delamain file and markdown prompt assets under the Delamain's own folder.

## Module

1. `factory`: software work items moving through one delivery Delamain

## Design Goal

Use this fixture to test whether ALS can model:

- business classification with a normal enum
- operational state with a Delamain-bound field
- lifecycle grouping as phase metadata
- structural schema and workflow graph living in different authored files
- graph coherence through explicit transition classes

without collapsing those concerns back into one oversized `status` enum plus prose rules elsewhere.
