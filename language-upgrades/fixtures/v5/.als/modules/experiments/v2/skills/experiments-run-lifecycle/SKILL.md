---
name: experiments-run-lifecycle
description: Monitor and manually override run records governed by the `run-lifecycle` Delamain in the experiments module.
model: sonnet
allowed-tools: Bash(bash *)
---

# Run Lifecycle Console

Operator console for `run` records bound to `run-lifecycle`.

## Startup

1. Resolve the system root.
2. Check `.claude/delamains/run-lifecycle/status.json`.
3. If the dispatcher heartbeat is stale or missing, start the dispatcher from `.claude/delamains/run-lifecycle/dispatcher/`.

## Transition Surface

- `queued` -> `running`
- `running` -> `queued`
- `running` -> `completed`
- `running` -> `failed`

## Procedure

1. Scan `workspace/experiments/**/runs/*.md` and group runs by lifecycle state.
2. Present `queued` and `running` runs first, with completed and failed runs available for inspection.
3. For a selected run, inspect frontmatter plus `OBSERVATIONS`, `DECISION`, and `NOTES`.
4. Allow manual override only through the legal transitions above.
5. When overriding, keep `ended_on` and `outcome` consistent with the selected terminal or non-terminal state.

## Scope

- Operates on `run` only.
- Complements `experiments-module`; it does not replace program or experiment authoring.
