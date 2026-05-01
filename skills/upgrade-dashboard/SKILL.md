---
name: upgrade-dashboard
description: Stage dashboard construct upgrades using the ALS-067 process-lifecycle contract. Returns a no-op, a staged runtime-state update, and a post-commit action manifest.
allowed-tools: AskUserQuestion, Bash, Read
---

# upgrade-dashboard

See [SDR 038](../../sdr/038-construct-upgrade-engine-contract.md) for the construct-upgrade semantics. This skill covers the delamain dashboard service only.

## Modes

- `preflight`
  - Read `${CLAUDE_PLUGIN_ROOT}/delamain-dashboard/{VERSION,construct.json}`.
  - Read `.als/runtime/construct-upgrades/state.json` if present.
  - If the recorded applied version already matches the canonical dashboard version, return a no-op result.
  - Otherwise return `needs_upgrade: true` with no operator prompts.

- `execute`
  - Re-run mismatch detection.
  - Update only the staging worktree copy of `.als/runtime/construct-upgrades/state.json`.
  - Emit:
    - `kill-then-restart` when the live dashboard service exists
    - `start-only` when it does not

## Output Contract

- `preflight` never asks the operator anything in v1.
- `execute` returns:
  - staged path `.als/runtime/construct-upgrades/state.json`
  - `requires_claude_deploy: false`
  - an `als-construct-action-manifest@1` payload for the dashboard lifecycle
