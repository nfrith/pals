---
name: reset-demo
description: Reset the reference-system to its pre-demo state. Removes fabricated items and restores modified records to their committed versions.
model: sonnet
allowed-tools: Bash(bash *)
---

# reset-demo

Reset the reference-system back to its natural resting state — as if `/run-demo` was never invoked.

## What it undoes

- **All demo processes** — dispatchers, traffic generators, daemon, and their Agent SDK child processes
- **Demo-mode agent overrides** injected by `/run-demo`
- **Fabricated items** created by the traffic generator
- **Modified records** that dispatchers advanced through state machines
- **Dispatcher status files**
- **Statusline changes** — restores the operator's original statusline if it was replaced by the demo

## Procedure

Run the reset script in a single call:

```
Bash(command: "bash {skill-dir}/reset.sh '{skill-dir}/../../reference-system' '$(pwd)'")
```

The script handles everything: killing processes (daemon, Agent SDK children, dispatchers, generators), removing fabricated items, restoring agent files and records, removing delamain-roots, and restoring the statusline backup.

After the script completes, report the output to the operator.

## Notes

- This skill is safe to run multiple times — it is idempotent.
- It does NOT modify `.als/` module definitions, shapes, or delamain bundles.
- It DOES restore `.claude/delamains/*/agents/` and `sub-agents/` to undo demo-mode injection.
- It does NOT modify `.claude/` skills, dispatcher code, or config.
- It does NOT uninstall `node_modules/` in dispatcher directories.
- After reset, run `/run-demo` to start a fresh demo cycle.
