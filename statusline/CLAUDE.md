# statusline/

Canonical ALS statusline for Claude Code. Installed into operator projects via `/configure-statusline`.

The statusline is the compact badge surface for Delamain health. It is not the canonical monitoring implementation. Rich dispatcher history, queue state, and failure context belong to `nfrith-repos/als/delamain-dashboard/`.

## Architecture: Two-process model

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
