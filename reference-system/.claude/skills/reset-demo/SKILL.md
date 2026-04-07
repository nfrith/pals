---
name: reset-demo
description: Reset the reference-system to its pre-demo state. Removes fabricated items and restores modified records to their committed versions.
model: sonnet
allowed-tools: Bash(bash *), Read, Glob
---

# reset-demo

Reset the reference-system back to its natural resting state — as if `/run-demo` was never invoked.

## What it undoes

- **All demo processes** — dispatchers, traffic generator, and their Agent SDK child processes
- **Fabricated items** created by the traffic generator
- **Modified records** that dispatchers advanced through state machines
- **Dispatcher status files**

## Procedure

### 1. Kill all demo processes

Demo processes form a tree: the traffic generator spawns Agent SDK subprocesses, and dispatchers do the same. Killing the parent PID alone does NOT cascade to these children — they become orphans and keep writing items. Kill the full tree.

**a) Kill dispatcher parents via status files:**

```bash
for sf in {system-root}/.claude/delamains/*/status.json; do
  [ -f "$sf" ] && pid=$(jq -r .pid "$sf") && kill "$pid" 2>/dev/null && rm -f "$sf"
done
```

**b) Kill the traffic generator and all Agent SDK orphans:**

```bash
pkill -f "run-demo/dispatcher.*index\.ts" 2>/dev/null
pkill -f "claude-agent-sdk/cli\.js.*run-demo" 2>/dev/null
```

**c) Kill any delamain dispatcher processes that outlived their status files:**

```bash
pkill -f "delamains/.*/dispatcher.*index\.ts" 2>/dev/null
pkill -f "claude-agent-sdk/cli\.js.*delamains" 2>/dev/null
```

**d) Wait and verify nothing survives:**

```bash
sleep 2 && ps aux | grep -E "(run-demo|delamains.*dispatcher)" | grep -v grep
```

If any processes remain, kill them by PID directly.

### 2. Remove fabricated items

The traffic generator creates new `.md` files in module data directories. These are untracked by git. Remove them:

```bash
cd {system-root} && git clean -f \
  workspace/factory/items/ \
  workspace/incident-response/reports/ \
  workspace/experiments/ \
  operations/postmortems/ \
  infra/
```

This only deletes untracked files (fabricated items). Committed files are untouched.

### 3. Restore modified records

Dispatchers may have advanced existing records to different states. Restore them to their committed versions:

```bash
cd {system-root} && git checkout -- \
  workspace/factory/items/ \
  workspace/incident-response/reports/ \
  workspace/experiments/ \
  operations/postmortems/ \
  infra/
```

### 4. Report

Tell the operator:
- How many processes were killed
- How many fabricated items were removed (count from `git clean` output)
- That the reference-system is ready for a fresh `/run-demo`

## Notes

- This skill is safe to run multiple times — it is idempotent.
- It does NOT modify `.als/` module definitions, shapes, or delamain bundles.
- It does NOT modify anything under `.claude/` (skills, dispatcher code, config).
- It does NOT uninstall `node_modules/` in dispatcher directories.
- After reset, run `/run-demo` to start a fresh demo cycle.
