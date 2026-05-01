---
name: upgrade-delamain
description: Stage dispatcher construct upgrades for every delamain in the operator system. Uses the ALS-067 construct-upgrade engine contract and returns structured preflight prompts or a staged action manifest.
allowed-tools: AskUserQuestion, Bash, Read
---

# upgrade-delamain

See [SDR 038](../../sdr/038-construct-upgrade-engine-contract.md) for the construct-upgrade semantics. This skill is the operator surface for dispatcher upgrades only.

## Modes

- `preflight`
  - Read `${CLAUDE_PLUGIN_ROOT}/skills/new/references/dispatcher/{VERSION,construct.json}`.
  - Discover every authored dispatcher bundle under `.als/modules/**/delamains/*/dispatcher/`.
  - Fail closed if the fleet is heterogeneous.
  - If the fleet already matches the canonical dispatcher version, return a no-op result.
  - Otherwise return:
    - one `pick-construct-lifecycle` prompt per dispatcher instance
    - one `confirm-construct-overwrite` prompt for each customized dispatcher bundle

- `execute`
  - Re-run mismatch detection and abort if any preflight answer is missing, `Cancel`, or `Abort`.
  - Write only into the staging worktree path supplied by `/update`.
  - Run the `sequential` migration chain across every dispatcher bundle in fleet order.
  - Overwrite vendor-owned dispatcher paths from the canonical bundle, backing up customized bundles to `<dispatcher>.customized-backup` inside the staging worktree first.
  - Emit `als-construct-action-manifest@1` in stable dispatcher-instance order, using:
    - `drain-then-restart` for `Drain`
    - `kill-then-restart` for `Kill`

## Output Contract

- `preflight` returns either `needs_upgrade: false` or a structured prompt list.
- `execute` returns:
  - staged dispatcher paths
  - `requires_claude_deploy: true`
  - an `als-construct-action-manifest@1` payload for post-commit lifecycle

Do not restate lifecycle semantics or customization rules here. When explaining them to the operator, point back to SDR 038.
