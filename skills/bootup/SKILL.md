---
name: bootup
description: The power button. Kill all running dispatchers, start everything fresh as background shells. Always produces the same state.
allowed-tools: Bash(bash *)
---

# bootup

The power button. Kills all running dispatchers, clears all state, starts everything fresh. Idempotent — always produces the same result.

## Scan results

<bash>bash ${CLAUDE_PLUGIN_ROOT}/skills/bootup/scan.sh</bash>

## Procedure

### 1. Parse scan results

Extract `PLUGIN_ROOT`, `SYSTEM_ROOT`, and delamain names from the scan output.

- `NO_SYSTEM` → "Not an ALS system." Exit.
- `NO_DELAMAINS` → "No delamains found." Exit.

### 2. Kill running dispatchers

If `RUNNING_PIDS` is present in the scan output, kill them all:

```bash
kill {pid1} {pid2} {pid3} 2>/dev/null; rm -f {SYSTEM_ROOT}/.claude/delamains/*/status.json
```

If no running PIDs, still clear stale status files.

### 3. Start all dispatchers

For every delamain in `ALL_DELAMAINS`, in parallel:

```bash
CLAUDE_PLUGIN_ROOT={PLUGIN_ROOT} bun run {SYSTEM_ROOT}/.claude/delamains/{NAME}/dispatcher/src/index.ts 2>&1
```

Use the Bash tool with `run_in_background: true`. One call per dispatcher, all in the same message.

### 4. Verify

```bash
sleep 2 && for name in {all_names}; do sf="{SYSTEM_ROOT}/.claude/delamains/$name/status.json"; [ -f "$sf" ] && echo "$name: ✓" || echo "$name: ✗"; done
```

### 5. Report

One line per dispatcher. State the count: "{N} dispatchers running."

## Notes

- Delamains run as background shells managed by this Claude session. They die when the session ends.
- This is the power button — it always kills everything and restarts. For bringing back only crashed dispatchers, use `/reboot`.
- `PLUGIN_ROOT` is derived from the scan script's own path — works regardless of whether `CLAUDE_PLUGIN_ROOT` is in the shell environment.
