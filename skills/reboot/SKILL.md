---
name: reboot
description: Quickly restart downed delamain dispatchers. Finds what's offline, brings it back. Fast — keeps the operator in flow.
allowed-tools: Bash(bash *)
---

# reboot

Find offline delamain dispatchers and restart them. Does not touch running dispatchers.

## Scan results

<bash>bash {skill-dir}/scan.sh</bash>

## Procedure

### 1. Parse scan results

Extract `ALS_PLUGIN_ROOT`, `SYSTEM_ROOT`, `DELAMAINS_ROOT`, and dispatcher status from the scan output. Use those names as the shell variables in the commands below.

- `NO_SYSTEM` → "Not an ALS system." Exit.
- `NO_DELAMAINS` → "No delamains found." Exit.
- `ALL_RUNNING` → "All dispatchers running." Exit.
- `OFFLINE: name1 name2 ...` → proceed to step 2.

### 2. Restart offline dispatchers

For each offline delamain, in parallel:

1. Clear stale status:
   ```bash
   rm -f ${DELAMAINS_ROOT}/{NAME}/status.json
   ```

2. Start the dispatcher as a background shell:
   ```bash
   ALS_PLUGIN_ROOT=${ALS_PLUGIN_ROOT} bun run ${DELAMAINS_ROOT}/{NAME}/dispatcher/src/index.ts 2>&1
   ```
   Pass the command literally. Use the Bash tool with `run_in_background: true`.

Start all offline dispatchers in parallel — one Bash call per dispatcher, all in the same message.

### 3. Verify

```bash
sleep 1 && for name in {offline_names}; do sf="${DELAMAINS_ROOT}/${name}/status.json"; [ -f "$sf" ] && echo "$name: ✓" || echo "$name: ✗"; done
```

### 4. Report

One line per restarted dispatcher. No tables, no ceremony.

## Notes

- Delamains run as background shells managed by this harness session. They die when the session ends.
- Plugin root resolution comes from the scan output and is passed to child processes as `ALS_PLUGIN_ROOT`.
- For a full restart of everything (kill running + start all), use `/bootup`.
- Speed is the point. The operator invokes this mid-flow.
