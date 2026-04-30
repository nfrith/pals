---
name: incident-response-incident-lifecycle
description: Monitor and manually override incident records governed by the `incident-lifecycle` Delamain in the incident-response module.
model: sonnet
allowed-tools: Bash(bash *)
---

# Incident Lifecycle Console

Operator console for `incident-report` records bound to `incident-lifecycle`.

## Startup

1. Resolve the system root.
2. Check `.claude/delamains/incident-lifecycle/status.json`.
3. If the dispatcher heartbeat is stale or missing, start the dispatcher from `.claude/delamains/incident-lifecycle/dispatcher/`.

## Transition Surface

- `active` -> `monitoring`
- `monitoring` -> `active`
- `monitoring` -> `recovered`
- `recovered` -> `monitoring`
- `recovered` -> `closed`

## Procedure

1. Scan `workspace/incident-response/reports/` and group incidents by lifecycle state.
2. Present incidents for inspection, focusing on `active`, `monitoring`, and `recovered`.
3. For a selected incident, inspect frontmatter plus the `SUMMARY`, `TIMELINE`, `RECOVERY`, and `FOLLOW_UP` sections.
4. Allow manual override only along the legal transitions above.
5. When overriding, keep `stabilized_on` and the authored chronology consistent with the chosen lifecycle state.

## Scope

- Operates on `incident-report` only.
- Complements `incident-response-module`; it does not replace general incident authoring.
