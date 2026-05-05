---
name: infra-release-lifecycle
description: Monitor and manually override release records governed by the `release-lifecycle` Delamain in the infra module.
model: sonnet
allowed-tools: Bash(bash *)
---

# Release Lifecycle Console

Operator console for `release` records bound to `release-lifecycle`.

## Startup

1. Resolve the system root.
2. Check `.claude/delamains/release-lifecycle/status.json`.
3. If the dispatcher heartbeat is stale or missing, start the dispatcher from `.claude/delamains/release-lifecycle/dispatcher/`.

## Transition Surface

- `pending` -> `rolling-out`
- `rolling-out` -> `pending`
- `rolling-out` -> `active`
- `active` -> `rolled-back`
- `active` -> `superseded`

## Procedure

1. Scan `infra/**/releases/*.md` and group releases by lifecycle state.
2. Present current `pending`, `rolling-out`, and `active` releases for inspection.
3. For a selected release, inspect frontmatter together with `CHANGES`, `ROLLBACK_PLAN`, and `VERIFICATION`.
4. Allow manual override only through the legal transitions above.
5. When overriding, keep the selected release consistent with surrounding release history for the same service.

## Scope

- Operates on `release` only.
- Complements `infra-deploy-release`; it does not replace manual release creation.
