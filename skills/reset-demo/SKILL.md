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
- **Demo-mode agent overrides** injected by `/run-demo`
- **Fabricated items** created by the traffic generator
- **Modified records** that dispatchers advanced through state machines
- **Dispatcher status files**
- **Statusline changes** — restores the operator's original statusline if it was replaced by the demo

## Procedure

### 1. Kill all demo processes

Demo processes form a tree: parent processes (`bun run src/index.ts`) spawn Agent SDK child processes (`claude-agent-sdk/cli.js`). Killing a parent does NOT kill its children — they become orphans that keep running and writing items. You must kill both layers.

Run this single command to kill everything:

```bash
# Kill Agent SDK children first (they're doing the actual writes)
ps aux | grep "claude-agent-sdk/cli.js" | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null
# Kill dispatcher and traffic generator parents
for sf in {skill-dir}/../../reference-system/.claude/delamains/*/status.json; do
  [ -f "$sf" ] && pid=$(jq -r .pid "$sf") && kill -9 "$pid" 2>/dev/null && rm -f "$sf"
done
ps aux | grep "bun run src/index.ts" | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null
# Wait and verify
sleep 2
```

After the wait, verify nothing survives:

```bash
ps aux | grep -E "(claude-agent-sdk/cli.js|bun run src/index.ts)" | grep -v grep
```

If any processes remain, kill them by PID with `kill -9`.

### 2. Remove fabricated items

The traffic generator creates new `.md` files in module data directories. These are untracked by git. Remove them:

```bash
cd {skill-dir}/../../reference-system && git clean -f \
  workspace/factory/items/ \
  workspace/incident-response/reports/ \
  workspace/experiments/ \
  operations/postmortems/ \
  infra/
```

This only deletes untracked files (fabricated items). Committed files are untouched.

### 3. Restore modified records and agent files

Dispatchers may have advanced existing records to different states, and `/run-demo` injects demo-mode overrides into agent files. Restore everything to committed versions:

```bash
cd {skill-dir}/../../reference-system && git checkout -- \
  .claude/delamains/*/agents/ \
  .claude/delamains/*/sub-agents/ \
  workspace/factory/items/ \
  workspace/incident-response/reports/ \
  workspace/experiments/ \
  operations/postmortems/ \
  infra/
```

### 4. Remove delamain roots

Remove the reference-system entry from `.claude/delamain-roots`:

```bash
rm -f .claude/delamain-roots
```

### 5. Restore statusline

If `/run-demo` installed the ALS statusline, restore the operator's original. Look for the backup file:

```bash
backup=$(ls -t .claude/scripts/statusline.sh.backup-* 2>/dev/null | head -1)
if [[ -n "$backup" ]]; then
  mv "$backup" .claude/scripts/statusline.sh
fi
```

If no backup exists, the operator either didn't have a statusline before or chose to keep it. In that case, remove the ALS statusline and clear the settings:

```bash
if [[ ! -f .claude/scripts/statusline.sh.backup-* ]]; then
  rm -f .claude/scripts/statusline.sh .claude/scripts/obs-status.py
fi
```

Also remove the `statusLine` key from `.claude/settings.json` if the operator had no statusline before (no backup found). Read the file, remove the key, write it back.

### 6. Report

Tell the operator:
- How many processes were killed
- How many fabricated items were removed (count from `git clean` output)
- Whether the statusline was restored (and from which backup) or removed
- That the reference-system is ready for a fresh `/run-demo`

## Notes

- This skill is safe to run multiple times — it is idempotent.
- It does NOT modify `.als/` module definitions, shapes, or delamain bundles.
- It DOES restore `.claude/delamains/*/agents/` and `sub-agents/` to undo demo-mode injection.
- It does NOT modify `.claude/` skills, dispatcher code, or config.
- It does NOT uninstall `node_modules/` in dispatcher directories.
- After reset, run `/run-demo` to start a fresh demo cycle.
