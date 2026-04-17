---
name: reboot
description: Quickly restart downed delamain dispatchers. Finds what's offline, brings it back. Fast — keeps the operator in flow.
allowed-tools: Bash(bash *)
---

# reboot

Find offline delamain dispatchers and restart them. Does not touch running dispatchers.

## Scan results

<bash>bash ${CLAUDE_PLUGIN_ROOT}/skills/reboot/scan.sh</bash>

## Procedure

### 1. Parse scan results

Extract `SYSTEM_ROOT` and dispatcher status from the scan output. The plugin root resolves at tool-call time via harness substitution of `${CLAUDE_PLUGIN_ROOT}` in the dispatcher spawn command below.

- `NO_SYSTEM` → "Not an ALS system." Exit.
- `NO_DELAMAINS` → "No delamains found." Exit.
- `ALL_RUNNING` → "All dispatchers running." Exit.
- `OFFLINE: name1 name2 ...` → proceed to step 2.

### 2. Restart offline dispatchers

For each offline delamain, in parallel:

1. Clear stale status:
   ```bash
   rm -f {SYSTEM_ROOT}/.claude/delamains/{NAME}/status.json
   ```

2. Start the dispatcher as a background shell:
   ```bash
   CLAUDE_PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT} bun run {SYSTEM_ROOT}/.claude/delamains/{NAME}/dispatcher/src/index.ts 2>&1
   ```
   Pass the command literally — the harness substitutes `${CLAUDE_PLUGIN_ROOT}` before Bash executes. Use the Bash tool with `run_in_background: true`.

Start all offline dispatchers in parallel — one Bash call per dispatcher, all in the same message.

### 3. Verify

```bash
sleep 1 && for name in {offline_names}; do sf="{SYSTEM_ROOT}/.claude/delamains/$name/status.json"; [ -f "$sf" ] && echo "$name: ✓" || echo "$name: ✗"; done
```

### 4. Report

One line per restarted dispatcher. No tables, no ceremony.

## Notes

- Delamains run as background shells managed by this Claude session. They die when the session ends.
- Plugin root resolution relies on the harness substituting `${CLAUDE_PLUGIN_ROOT}` in skill bash commands. Tested across Claude Code CLI (marketplace + dev) and Claude Code Desktop.
- For a full restart of everything (kill running + start all), use `/bootup`.
- Speed is the point. The operator invokes this mid-flow.
