---
name: bootup
description: The power button. Kill all running dispatchers, start everything fresh as background shells. Always produces the same state.
allowed-tools: Bash(bash *)
---

# bootup

The power button. Kills all running dispatchers, clears all state, starts everything fresh. Idempotent — always produces the same result.

## Scan results

<bash>bash {skill-dir}/scan.sh</bash>

## Procedure

### 1. Parse scan results

Extract `ALS_PLUGIN_ROOT`, `SYSTEM_ROOT`, `HARNESS`, `ALS_PLATFORM_CODE`, `DELAMAINS_ROOT`, `STATUSLINE_CACHE_ROOT`, `STATUSLINE_SUPPORTED`, and delamain names from the scan output. Use those names as the shell variables in the commands below.

- `NO_SYSTEM` → "Not an ALS system." Exit.
- `NO_DELAMAINS` → "No delamains found." Exit.

### 2. Kill running dispatchers

If `RUNNING_PIDS` is present in the scan output, kill them all. If `PULSE_PID` is also present (statusline background data producer, GF-034), include it in the same kill call:

```bash
kill {pid1} {pid2} {pid3} {PULSE_PID} 2>/dev/null; rm -f ${DELAMAINS_ROOT}/*/status.json; [ -n "${STATUSLINE_CACHE_ROOT}" ] && rm -f "${STATUSLINE_CACHE_ROOT}/meta.json"
```

If no running PIDs, still clear stale status files and stale pulse meta.

### 3. Start all dispatchers

For every delamain in `ALL_DELAMAINS`, in parallel:

```bash
ALS_PLUGIN_ROOT=${ALS_PLUGIN_ROOT} bun run ${DELAMAINS_ROOT}/{NAME}/dispatcher/src/index.ts 2>&1
```

Pass the command literally. The inline assignment (`ALS_PLUGIN_ROOT=...`) propagates the path into the bun child process env so the dispatcher can read it.

Use the Bash tool with `run_in_background: true`. One call per dispatcher, all in the same message.

If `STATUSLINE_SUPPORTED` is `yes`, in the same message as the dispatcher spawns, also spawn PULSE (statusline background data producer, GF-034 Phase 2) as another `run_in_background: true` Bash call:

```bash
ALS_PLUGIN_ROOT=${ALS_PLUGIN_ROOT} bun run ${ALS_PLUGIN_ROOT}/statusline/pulse.ts ${SYSTEM_ROOT} 2>&1
```

Pulse probes delamain health and OBS live-stream state every 3s, writing raw state to `${STATUSLINE_CACHE_ROOT}/{meta,delamains,live}.json`. The statusline face reads this cache on its render path. Pulse shares lifecycle with dispatchers — survives `clear`/`resume`, treats lone termination signals as advisory, and logs shutdown diagnostics to `${STATUSLINE_CACHE_ROOT}/{shutdown,sessionend}.log` so real SessionEnd cleanup can be distinguished from stray signal noise.

### 4. Verify

Check status files. Dispatchers write `status.json` on startup — if missing, they haven't started yet. Run without sleep; if any show ✗, wait a moment and retry once.

```bash
for name in {all_names}; do sf="${DELAMAINS_ROOT}/${name}/status.json"; [ -f "$sf" ] && echo "$name: ✓" || echo "$name: ✗"; done
```

### 5. Start the delamain dashboard service

The dashboard gives a live view of dispatcher state — served on `http://127.0.0.1:4646` as both a web UI and a TUI snapshot feed. Bootup starts the service so either surface is reachable. Dashboard failure is non-fatal: report it, do not abort the bootup.

Ensure dashboard deps are installed (idempotent, fast when already installed):

```bash
cd ${ALS_PLUGIN_ROOT}/delamain-dashboard && bun install --silent 2>&1 | tail -3
```

Kill any previously running dashboard service (bootup invariant — always fresh):

```bash
pkill -f "delamain-dashboard/src/index.ts service" 2>/dev/null; true
```

Start the service in the background, rooted at the current system:

```bash
ALS_PLUGIN_ROOT=${ALS_PLUGIN_ROOT} bun run ${ALS_PLUGIN_ROOT}/delamain-dashboard/src/index.ts service --system-root ${SYSTEM_ROOT} 2>&1
```

Use the Bash tool with `run_in_background: true`.

The landing page remains `http://127.0.0.1:4646/`; journey inspection is now available from the web UI at `/journey/{delamainName}` links on each dispatcher card.

### 6. Open the dashboard on Claude Code Desktop

Use `ALS_PLATFORM_CODE` from the scan output to identify the current platform per the matrix in [`platforms.md`](../docs/references/platforms.md). If it is empty and `HARNESS` is `claude`, map `$CLAUDE_CODE_ENTRYPOINT` via the same reference. If `HARNESS` is `codex`, treat the platform as [`ALS-PLAT-CXCLI`](../docs/references/platforms.md).

- If the platform is [`ALS-PLAT-CDSK`](../docs/references/platforms.md): automatically open `http://127.0.0.1:4646` in the Desktop's built-in preview tool — the specific tool name varies by Desktop version, so use whichever preview/browser tool the harness currently exposes for rendering a local URL. Do **not** ask the operator first; they opted in to bootup, the dashboard open is a free side-effect.
- On any other platform ([`ALS-PLAT-CCLI`](../docs/references/platforms.md), [`ALS-PLAT-CXCLI`](../docs/references/platforms.md), `remote`, unobserved): skip the auto-open. The URL is still reported in Step 7 so the operator can open it manually or run the TUI against it.

### 7. Report

One line per dispatcher. State the count: "{N} dispatchers running." Then add the dashboard line: either "Dashboard: http://127.0.0.1:4646 (opened in preview)" on Claude Code Desktop, or "Dashboard: http://127.0.0.1:4646" elsewhere. If the dashboard failed to start, report the failure and the URL the operator would otherwise reach.

## Notes

- Delamains run as background shells managed by this harness session. They die when the session ends.
- The delamain dashboard service is bound to the same session lifetime as the dispatchers and is also restarted on every bootup.
- This is the power button — it always kills everything and restarts. For bringing back only crashed dispatchers, use `/reboot`.
- Plugin root resolution comes from the scan output and is passed to child processes as `ALS_PLUGIN_ROOT`.
