---
name: postmortems-incident-lifecycle
description: Monitor and manually override incident records governed by the `postmortem-lifecycle` Delamain in the postmortems module.
model: sonnet
allowed-tools: Bash(bash *)
---

# Postmortem Lifecycle Console

Operator console for `incident` records bound to `postmortem-lifecycle`.

## Startup

1. Resolve the system root.
2. Check `.claude/delamains/postmortem-lifecycle/status.json`.
3. If the dispatcher heartbeat is stale or missing, start the dispatcher from `.claude/delamains/postmortem-lifecycle/dispatcher/`.

## Transition Surface

- `investigating` -> `mitigated`
- `mitigated` -> `investigating`
- `mitigated` -> `resolved`
- `resolved` -> `mitigated`
- `resolved` -> `closed`

## Procedure

1. Scan `operations/postmortems/*.md` and group incidents by lifecycle state.
2. Present `investigating`, `mitigated`, and `resolved` incidents for inspection.
3. For a selected record, inspect frontmatter plus `TIMELINE`, `ROOT_CAUSE`, `IMPACT`, `REMEDIATION`, and `LESSONS`.
4. Allow manual override only through the legal transitions above.
5. When overriding, keep `resolved_date` and the authored incident narrative consistent with the chosen lifecycle state.

## Scope

- Operates on `incident` only.
- Complements `postmortems-module`; it does not replace general postmortem authoring.
