# statusline/

Canonical ALS statusline for Claude Code. Installed into operator projects via `/configure-statusline`.

The statusline is the compact badge surface for Delamain health. It is not the canonical monitoring implementation. Rich dispatcher history, queue state, and failure context belong to `nfrith-repos/als/delamain-dashboard/`.

## Architecture — MCP PULSE + FACE (ALS-112, statusline v2)

The statusline is split into two independent halves, connected through a source-agnostic raw-state cache:

```
statusline/mcp-server/index.ts (plugin-resident MCP server, auto-spawned by Claude)
  │
  │  writes every 3s (atomic .tmp + rename)
  ▼
{SYSTEM_ROOT}/.claude/scripts/.cache/pulse/
    meta.json         {pid, last_tick, schema_version, tick_ms}
    delamains.json    {last_tick, delamains: [{name, slug, pid, alive, state, active, blocked, error}]}
    live.json         {last_tick, connected, streaming, recording, state}
    shutdown.log      JSONL diagnostics for advisory/final pulse signals
    sessionend.log    JSONL diagnostics for SessionEnd hook invocations
  │
  │  reads when meta.mtime ≤ PULSE_STALE_SEC (default 10s)
  │  falls back to inline scan otherwise
  ▼
statusline.sh (face, invoked by Claude Code per tick / per event)
```

### PULSE — the background data producer

`statusline/mcp-server/index.ts` is a zero-tool stdio MCP server built on the official `@modelcontextprotocol/sdk`. Claude starts it automatically when the ALS plugin is enabled. The server launches the background pulse loop on startup and lets Claude own the steady-state lifecycle: session start auto-spawns it, `/reload-plugins` refreshes or resurrects it, and server death is visible at the MCP layer.

System-root discovery is MCP-specific:

1. If `ALS_SYSTEM_ROOT` or `SYSTEM_ROOT` is present, use it only when it resolves to a directory containing `.als/system.ts`. This exists for test harnesses and explicit local overrides.
2. Otherwise walk up from `process.cwd()` looking for `.als/system.ts`.
3. If nothing resolves, pulse enters a graceful no-op mode: it stays connected as an MCP server, writes nothing, and never creates `.claude/` garbage in non-ALS projects.

When a system root is present, pulse probes:

- **delamains** — walks `{SYSTEM_ROOT}/.claude/delamains/*/status.json`, reads `pid / active_dispatches / blocked_dispatches / last_error`, maps to 5 states (`offline / idle / active / warn / error`). Same mapping as the face's inline fallback so switching paths yields byte-identical badges.
- **OBS WebSocket v5** — unauthenticated Hello→Identify→GetStreamStatus→GetRecordStatus sequence against `localhost:4455` with a 500ms timeout. Ported from the legacy `obs-status.py` onto bun's native `WebSocket`. Produces `{connected, streaming, recording, state: "live"|"offline"}`.

Every write is atomic (`.tmp + rename`). `meta.json` is written **last** on each tick so its mtime is the canonical freshness signal — when meta looks fresh, the topic files behind it are guaranteed fresh.

Recovery contract: `/bootup` no longer owns pulse. If the statusline cache stays stale or the MCP server dies, run `/reload-plugins`. The face still falls back to inline scan while the cache is stale or missing, so badge rendering degrades cleanly instead of disappearing.

Signal behavior stays the same as GF-034: lone `SIGTERM` / `SIGHUP` / `SIGINT` signals are advisory and logged to `shutdown.log`; pulse only exits on a confirmed shutdown pair inside the signal-confirm window. `hooks/delamain-stop.sh` still emits the SessionEnd reap signal and logs each invocation to `sessionend.log`, which gives operators enough context to tell hook-driven deaths from parent-shell-driven ones.

### FACE — the Claude Code statusline renderer

`statusline.sh` is the first (currently only) face. On each Claude Code tick it:

1. Walks up from `cwd` for `.claude/delamains/` to discover SYSTEM_ROOT.
2. Checks `pulse/meta.json` mtime against `PULSE_STALE_SEC`.
3. **Pulse-fresh:** reads raw state from `pulse/delamains.json` + `pulse/live.json`, feeds it into `render_badge()` for the 3-row themed output.
4. **Pulse-stale or missing:** falls back to the original inline filesystem scan. LIVE defaults to OFFLINE when pulse can't report it.

The face owns its own ANSI / blink / glitch / breath-glow concerns. Pulse's cache format is intentionally free of presentation-layer detail — per GF-034 Q3(b), faces translate raw state for their own surface. Future faces (tmux-pane TUI at `ghost-factory/dotfiles/statusline/`, web, service endpoint) read the same cache and render without needing pulse to know about them.

### Cache schema (public API for future faces)

| File | Contents |
|------|----------|
| `meta.json` | `{schema_version: 1, pid: number, last_tick: ms, tick_ms: number}` |
| `delamains.json` | `{schema_version: 1, last_tick: ms, delamains: [{name, slug, pid, alive, state, active, blocked, error}]}` where `state ∈ {offline, idle, active, warn, error}` |
| `live.json` | `{schema_version: 1, last_tick: ms, connected: bool, streaming: bool, recording: bool, state: "live" \| "offline"}` |

A future face reading this cache needs only:

1. Read `meta.json`; check `last_tick` or file mtime against its own freshness budget.
2. Read the topic files it cares about (`delamains.json`, `live.json`, or both).
3. Render the raw state per its own surface's rules.

No pulse changes required to add a face. Adding a new probe (e.g. YouTube live, deferred to Phase 3+) means adding a new topic file; existing faces that don't read it stay unaffected.

### Legacy files (deprecated, pending Phase 3 cleanup)

`statusline-daemon.sh`, `obs-status.py`, and `deploy.sh` still exist on disk as the pre-GF-034 two-process deploy. `pulse.ts` also remains as a legacy compatibility wrapper for smoke tests and migration-era diagnostics, but production ownership is `statusline/mcp-server/`. The history-of-why content below is preserved because the GHOST-163 lessons (stderr kills statusline, `.tmp + mv` atomic writes, render budget discipline) still govern this module.

## Legacy architecture: Two-process model (deprecated)

The statusline is split into two independent pieces:

```
statusline-daemon.sh (background, long-running)
  │
  │  writes every 3s (atomic mv)
  ▼
.cache/badges, .cache/git-branch, .cache/obs-state
  │
  │  reads (~25ms total)
  ▼
statusline.sh (invoked by Claude Code per turn)
```

**statusline-daemon.sh** — Background process that collects delamain badge state (jq on status.json files, kill -0 PID checks), git branch, and OBS streaming/recording status. Writes to cache files every 3 seconds. Can take as long as it needs — it's not on the render path.

**statusline.sh** — Pure reader invoked by Claude Code after each assistant message. Reads JSON from stdin (model, context, cwd), reads daemon's cache files, formats and outputs. No scanning, no jq on delamain files, no git, no python. Execution time: ~25-39ms.

## Why two processes (the hard lessons)

Investigated exhaustively during GHOST-163 (2026-04-08). The statusline disappeared when background shells (dispatchers, generators) were started.

### What we tried and why it failed

| Approach | Result | Why it failed |
|----------|--------|---------------|
| TTL-based caching in script | Failed | Caches expired during shell burst, cold scan took >300ms |
| Signal traps (TERM/INT/PIPE) | Failed | Claude Code may use SIGKILL (untraceable) |
| Render cache replay (2s, 30s TTL) | Failed | TTL expired before burst ended; any cold path during burst killed it |
| Pre-warm before shell launches | Failed | Too many seconds between pre-warm and last shell launch |
| Install statusline AFTER shells | Failed | Ghost already had statusline wired — it ran during setup steps |
| All shells in single nohup call | Worked but... | Hides processes from TUI (no "N shells" indicator) |
| Daemon + pure reader | **Works** | Script is fast enough (~25ms) that it never gets cancelled |

### The root cause chain

1. Claude Code invokes statusline script after each assistant message
2. Each `run_in_background: true` tool call triggers a statusline update
3. If a previous invocation is still running, Claude Code cancels it
4. Cancelled scripts exit non-zero → Claude Code disables statusline for the session
5. Once disabled, it never comes back without restarting Claude Code

### What actually fixed it

1. **Separate the scanning from the rendering** — the daemon does all expensive work (jq, git, python, kill -0). The statusline script just reads files and formats output.
2. **Atomic file writes in the daemon** — `echo > file` is NOT atomic (shell truncates then writes). If the statusline reads mid-write, it gets truncated ANSI escape codes → garbled rendering → Claude Code disables. Fix: write to `.tmp` then `mv` (atomic rename on POSIX).
3. **Start daemon before shell burst** — daemon must complete its first write cycle before any `run_in_background` shells are launched. This ensures cache files exist and are complete.

### Critical constraint from Anthropic docs

> "Multi-line status lines with escape codes are more prone to rendering issues than single-line plain text"

Our statusline uses 3 lines with heavy ANSI. This is at the edge of what Claude Code handles well. The daemon architecture makes it work by ensuring the render path is trivially fast (~25ms) with no subprocess spawning beyond one jq call for stdin parsing.

## How Claude Code statusline works

The statusline is a shell script that Claude Code runs after each assistant message. Claude Code pipes session JSON to stdin and displays whatever stdout produces. Each `echo` = one row.

**Official docs:** https://docs.anthropic.com/en/docs/claude-code/configuration#status-line

### Constraints

- **300ms debounce**: If a new update triggers while the script is still running, the in-flight execution is cancelled
- **Non-zero exit or no output = blank**: Script errors or empty output cause the statusline to disappear
- **Once disabled, stays disabled**: If Claude Code disables the statusline (due to error/cancellation), it never re-enables for the session. Restart required.
- **Each invocation is a new process**: No persistent state via PID (`$$` changes every time). Use stable file paths for caching.
- **stderr kills rendering**: Any stderr output causes blank statusline. All commands must redirect stderr.

### Other known behaviors

- Hides during UI interactions: autocomplete, help menu, permission prompts
- Right-side notifications share the row: MCP errors, token warnings can truncate output
- tmux: statusline renders fine in tmux (previously thought it didn't — that was a speed issue, not a tmux issue)

## Files

| File | Purpose |
|------|---------|
| `statusline.sh` | Pure reader — invoked by Claude Code, reads cache files, outputs formatted statusline |
| `statusline-daemon.sh` | Background collector — scans delamains, git, OBS every 3s, writes cache files |
| `obs-status.py` | Pure Python WebSocket client for OBS v5 status (streaming/recording) |
| `deploy.sh` | Deploys statusline + daemon + obs-status to target project |
| `test.sh` | UAT test with mock delamains |
| `test-animate.sh` | Background state animator for test mode |

## Cache files

All stored in `$SCRIPT_DIR/.cache/` (under the deployed scripts directory):

| File | Writer | Contents |
|------|--------|----------|
| `badges` | daemon | Pre-rendered ANSI badge strings (pipe-separated) |
| `badges-w` | daemon | Visible character widths for padding (pipe-separated) |
| `git-branch` | daemon | Current git branch name |
| `obs-state` | daemon | "streaming", "recording", or empty |
| `daemon.pid` | daemon | Daemon PID for cleanup |
| `last-render` | statusline.sh | Last rendered output (for signal trap replay) |
| `test-mode` | test.sh | Mock delamain `name\|state` pairs |

## Delamain discovery

The daemon discovers delamains from two sources:

1. **Walk up from cwd** — finds `.claude/delamains/` in the project tree
2. **`.claude/delamain-roots`** — a file listing additional system roots to scan (one path per line). Written by `/run-demo`, removed by `/reset-demo`.

## References

- Official statusline docs: https://docs.anthropic.com/en/docs/claude-code/configuration#status-line
- ccstatusline project: https://github.com/sirmalloc/ccstatusline
- Feature request for refreshIntervalSeconds: https://github.com/anthropics/claude-code/issues/5685
