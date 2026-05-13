---
name: upgrade-statusline
description: Stage statusline construct version-state updates for the MCP-owned pulse lifecycle. Returns a no-op or a staged runtime-state update; the v1-to-v2 legacy-pulse cleanup runs post-commit inside `/update`.
allowed-tools: AskUserQuestion, Bash, Read
---

# upgrade-statusline

See [SDR 038](../../sdr/038-construct-upgrade-engine-contract.md) for the construct-upgrade semantics. This skill covers the statusline construct's version-state only; Claude's plugin MCP lifecycle owns the running pulse.

## Modes

- `preflight`
  - Read `${CLAUDE_PLUGIN_ROOT}/statusline/{VERSION,construct.json}`.
  - Read `.als/runtime/construct-upgrades/state.json` if present.
  - If the recorded applied version already matches the canonical statusline version, return a no-op result.
  - Otherwise return `needs_upgrade: true` with no operator prompts.

- `execute`
  - Re-run mismatch detection.
  - Update only the staging worktree copy of `.als/runtime/construct-upgrades/state.json`.
  - Emit no lifecycle actions. `/update` handles the bounded v1-to-v2 legacy-pulse cleanup after commit, and steady-state recovery is `/reload-plugins`.

## Output Contract

- `preflight` never asks the operator anything in v1.
- `execute` returns:
  - staged path `.als/runtime/construct-upgrades/state.json`
  - `requires_claude_deploy: false`
  - no post-commit action manifest for statusline
