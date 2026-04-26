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

Extract `SYSTEM_ROOT` and delamain names from the scan output. The plugin root resolves at tool-call time via harness substitution of `${CLAUDE_PLUGIN_ROOT}` in the dispatcher spawn command below.

- `NO_SYSTEM` → "Not an ALS system." Exit.
- `NO_DELAMAINS` → "No delamains found." Exit.

### 2. Migrate the legacy boot-config filename if needed

If `{SYSTEM_ROOT}/.als/config.md` exists and `{SYSTEM_ROOT}/.als/bootup.md` does not, rename the legacy file in place before proceeding:

```bash
mv {SYSTEM_ROOT}/.als/config.md {SYSTEM_ROOT}/.als/bootup.md
```

This migration is filename-only. Do not rewrite the contents.

### 3. Kill running dispatchers

If `RUNNING_PIDS` is present in the scan output, kill them all. If `PULSE_PID` is also present (statusline background data producer, GF-034), include it in the same kill call:

```bash
kill {pid1} {pid2} {pid3} {PULSE_PID} 2>/dev/null; rm -f {SYSTEM_ROOT}/.claude/delamains/*/status.json {SYSTEM_ROOT}/.claude/scripts/.cache/pulse/meta.json
```

If no running PIDs, still clear stale status files and stale pulse meta.

### 4. Start all dispatchers

For every delamain in `ALL_DELAMAINS`, in parallel:

```bash
CLAUDE_PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT} bun run {SYSTEM_ROOT}/.claude/delamains/{NAME}/dispatcher/src/index.ts 2>&1
```

Pass the command literally — the harness substitutes `${CLAUDE_PLUGIN_ROOT}` to an absolute path before Bash executes. The inline assignment (`CLAUDE_PLUGIN_ROOT=...`) propagates the path into the bun child process env so the dispatcher can read it.

Use the Bash tool with `run_in_background: true`. One call per dispatcher, all in the same message.

In the same message as the dispatcher spawns, also spawn PULSE (statusline background data producer, GF-034 Phase 2) as another `run_in_background: true` Bash call:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/statusline/pulse.ts {SYSTEM_ROOT} 2>&1
```

Pulse probes delamain health and OBS live-stream state every 3s, writing raw state to `{SYSTEM_ROOT}/.claude/scripts/.cache/pulse/{meta,delamains,live}.json`. The statusline face reads this cache on its render path. Pulse shares lifecycle with dispatchers — survives `clear`/`resume`, treats lone termination signals as advisory, and logs shutdown diagnostics to `{SYSTEM_ROOT}/.claude/scripts/.cache/pulse/{shutdown,sessionend}.log` so real SessionEnd cleanup can be distinguished from stray signal noise.

### 5. Verify

Check status files. Dispatchers write `status.json` on startup — if missing, they haven't started yet. Run without sleep; if any show ✗, wait a moment and retry once.

```bash
for name in {all_names}; do sf="{SYSTEM_ROOT}/.claude/delamains/$name/status.json"; [ -f "$sf" ] && echo "$name: ✓" || echo "$name: ✗"; done
```

### 6. Start the delamain dashboard service

The dashboard gives a live view of dispatcher state — served on `http://127.0.0.1:4646` as both a web UI and a TUI snapshot feed. Bootup starts the service so either surface is reachable. Dashboard failure is non-fatal: report it, do not abort the bootup.

Ensure dashboard deps are installed (idempotent, fast when already installed):

```bash
cd ${CLAUDE_PLUGIN_ROOT}/delamain-dashboard && bun install --silent 2>&1 | tail -3
```

Kill any previously running dashboard service (bootup invariant — always fresh):

```bash
pkill -f "delamain-dashboard/src/index.ts service" 2>/dev/null; true
```

Start the service in the background, rooted at the current system:

```bash
CLAUDE_PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT} bun run ${CLAUDE_PLUGIN_ROOT}/delamain-dashboard/src/index.ts service --system-root {SYSTEM_ROOT} 2>&1
```

Use the Bash tool with `run_in_background: true`.

The landing page remains `http://127.0.0.1:4646/`; journey inspection is now available from the web UI at `/journey/{delamainName}` links on each dispatcher card.

### 7. Open the dashboard on Claude Code Desktop

Read `$CLAUDE_CODE_ENTRYPOINT` to identify the current platform per the matrix in [`platforms.md`](../docs/references/platforms.md).

- If the entrypoint is `claude-desktop` ([`ALS-PLAT-CDSK`](../docs/references/platforms.md)): automatically open `http://127.0.0.1:4646` in the Desktop's built-in preview tool — the specific tool name varies by Desktop version, so use whichever preview/browser tool the harness currently exposes for rendering a local URL. Do **not** ask the operator first; they opted in to bootup, the dashboard open is a free side-effect.
- On any other entrypoint (`cli`, `remote`, unobserved): skip the auto-open. The URL is still reported in Step 7 so the operator can open it manually or run the TUI against it.

### 8. Report

One line per dispatcher. State the count: "{N} dispatchers running." Then add the dashboard line: either "Dashboard: http://127.0.0.1:4646 (opened in preview)" on Claude Code Desktop, or "Dashboard: http://127.0.0.1:4646" elsewhere. If the dashboard failed to start, report the failure and the URL the operator would otherwise reach.

## Notes

- Delamains run as background shells managed by this Claude session. They die when the session ends.
- The delamain dashboard service is bound to the same session lifetime as the dispatchers and is also restarted on every bootup.
- This is the power button — it always kills everything and restarts. For bringing back only crashed dispatchers, use `/reboot`.
- The canonical boot configuration filename is `.als/bootup.md`. If a system still has `.als/config.md`, `/bootup` renames it in place before continuing.
- Plugin root resolution relies on the harness substituting `${CLAUDE_PLUGIN_ROOT}` in skill bash commands. Tested across Claude Code CLI (marketplace + dev) and Claude Code Desktop. Works regardless of whether the subprocess env has the var set.
