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

Extract `PLUGIN_ROOT`, `SYSTEM_ROOT`, and dispatcher status from the scan output.

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
   CLAUDE_PLUGIN_ROOT={PLUGIN_ROOT} bun run {SYSTEM_ROOT}/.claude/delamains/{NAME}/dispatcher/src/index.ts 2>&1
   ```
   Use the Bash tool with `run_in_background: true`.

Start all offline dispatchers in parallel — one Bash call per dispatcher, all in the same message.

### 3. Verify

```bash
sleep 1 && for name in {offline_names}; do sf="{SYSTEM_ROOT}/.claude/delamains/$name/status.json"; [ -f "$sf" ] && echo "$name: ✓" || echo "$name: ✗"; done
```

### 4. Report

One line per restarted dispatcher. No tables, no ceremony.

## Notes

- Delamains run as background shells managed by this Claude session. They die when the session ends.
- `PLUGIN_ROOT` is derived from the scan script's own path — it works regardless of whether `CLAUDE_PLUGIN_ROOT` is in the shell environment.
- For a full restart of everything (kill running + start all), use `/bootup`.
- Speed is the point. The operator invokes this mid-flow.
