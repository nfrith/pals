#!/bin/bash
# statusline.sh - ALS statusline for Claude Code
#
# PERFORMANCE CRITICAL: This script must complete in under 200ms.
# Claude Code debounces statusline updates at 300ms. If a new update
# triggers while this script is still running, the in-flight execution
# is CANCELLED — producing a blank statusline. With many background
# shells (dispatchers, traffic generators), updates trigger rapidly.
#
# Strategy: cache all expensive operations (delamain scan, git, OBS)
# to temp files with TTLs. The hot path only reads cache + renders.
# Measured: ~180ms total execution time.
#
# See CLAUDE.md in this directory for full documentation of the
# statusline system, known issues, and sources.

set +e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CACHE_DIR="$SCRIPT_DIR/.cache"
[[ -d "$CACHE_DIR" ]] || mkdir -p "$CACHE_DIR"

# ---------------------------------------------------------------------------
# TECH DEBT: Signal traps — always exit 0 with cached output
#
# When Claude Code debounces, it cancels the in-flight script (SIGTERM).
# Bash exits 143 and Claude Code DISABLES the statusline for the session.
#
# Fix: trap signals, replay the last cached render (so Claude Code sees
# real output not empty stdout), then exit 0.
#
# If SIGKILL is used (untraceable), this won't help — the render cache
# + pre-warm approach in run-demo is the fallback defense for that case.
# ---------------------------------------------------------------------------
_on_signal() {
  local rc="$CACHE_DIR/last-render"
  [[ -f "$rc" ]] && cat "$rc"
  exit 0
}
trap '_on_signal' TERM INT PIPE

input=$(cat)

# ---------------------------------------------------------------------------
# TECH DEBT: Rapid-fire render guard (Option B)
#
# Problem: When many background shells launch at once (e.g. /run-demo starts
# 10 shells), Claude Code fires statusline updates in rapid succession. Even
# with caching, the script can exceed the 300ms debounce window on the first
# cold-cache run, get cancelled, and Claude Code disables the statusline for
# the entire session. Once disabled, it never comes back without a restart.
#
# Workaround: If we rendered successfully within the last 30 seconds, just
# replay the last output verbatim and exit. This makes rapid-fire invocations
# near-instant (~5ms) — well under the 300ms threshold. The trade-off is that
# the statusline can be up to 30s stale during bursts, but that's invisible
# to the operator and far better than a blank statusline.
#
# 30s (not 2s) because /run-demo launches 10 background shells sequentially
# over ~10-15s. The original 2s TTL expired before the shell burst finished,
# sending the script back to the cold path mid-burst and killing the statusline.
# 30s covers the entire launch sequence. By the time it expires, the burst
# is over and the cold render completes safely in ~73ms.
# TECH DEBT: The real fix is Option C — a separate background process updates
# caches on a timer, and the statusline script ONLY reads cache, never scans.
#
# A proper fix would also be Claude Code supporting a refreshIntervalSeconds
# config or not disabling the statusline after transient errors.
# See: https://github.com/anthropics/claude-code/issues/5685
# ---------------------------------------------------------------------------
render_cache="$CACHE_DIR/last-render"
if [[ -f "$render_cache" ]]; then
    render_mtime=$(stat -f %m "$render_cache" 2>/dev/null || stat -c %Y "$render_cache" 2>/dev/null || echo 0)
    now=$(date +%s)
    if (( now - render_mtime < 30 )); then
        cat "$render_cache"
        exit 0
    fi
fi

# ---------------------------------------------------------------------------
# Extract fields — three jq calls (fast, no subshells beyond jq itself)
# ---------------------------------------------------------------------------
cwd=$(echo "$input" | jq -r '.workspace.current_dir // ""')
model=$(echo "$input" | jq -r '.model.display_name // ""')
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

dir=$(basename "$cwd")

# ---------------------------------------------------------------------------
# Terminal width (cached per-session, stty is slow)
# ---------------------------------------------------------------------------
tw_cache="$CACHE_DIR/tw"
term_width=80
if [[ -f "$tw_cache" ]]; then
    term_width=$(<"$tw_cache")
elif tw=$( (stty size < /dev/tty) 2>/dev/null | awk '{print $2}') && [[ -n "$tw" ]] && (( tw > 0 )); then
    term_width=$tw
    echo "$tw" > "$tw_cache"
fi
max_line=$((term_width - 6))

# ---------------------------------------------------------------------------
# Context bar (inline math, no subshells)
# ---------------------------------------------------------------------------
context_info=""
if [[ -n "$used_pct" && "$used_pct" != "null" ]]; then
    pct=${used_pct%.*}
    filled=$((pct * 10 / 100))
    empty=$((10 - filled))
    bar="["
    for ((i=0; i<filled; i++)); do bar+="█"; done
    for ((i=0; i<empty; i++)); do bar+="░"; done
    bar+="]"
    context_info=$(printf ' \033[2;35m%s %d%%\033[0m' "$bar" "$pct")
fi

# ---------------------------------------------------------------------------
# Git branch (cached 10s)
# ---------------------------------------------------------------------------
git_cache="$CACHE_DIR/git-branch"
branch=""
if [[ ! -f "$git_cache" ]] || (( $(date +%s) - $(stat -f %m "$git_cache" 2>/dev/null || stat -c %Y "$git_cache" 2>/dev/null || echo 0) > 10 )); then
    branch=$(cd "$cwd" 2>/dev/null && git branch --show-current 2>/dev/null)
    echo "$branch" > "$git_cache"
else
    branch=$(<"$git_cache")
fi

# ---------------------------------------------------------------------------
# Delamain badges (cached 5s — the expensive part)
# ---------------------------------------------------------------------------
badge_cache="$CACHE_DIR/badges"
badge_width_cache="$CACHE_DIR/badges-w"

if [[ -f $CACHE_DIR/test-mode ]]; then
    # TEST MODE: generate mock badges without real delamain scan
    badges=""
    widths=""
    while IFS='|' read -r name state; do
        [[ -z "$name" ]] && continue
        case "$state" in
            active)  symbol="⚡"; color="1;32" ;;
            idle)    symbol="✓"; color="32" ;;
            error)   symbol="✗"; color="1;31" ;;
            *)       symbol="○"; color="2;37" ;;
        esac
        badges+="$(printf '\033[%sm[%s %s]\033[0m' "$color" "$name" "$symbol")|"
        widths+="$(( ${#name} + 4 ))|"
    done < $CACHE_DIR/test-mode
    echo -n "$badges" > "$badge_cache"
    echo -n "$widths" > "$badge_width_cache"
elif [[ ! -f "$badge_cache" ]] || (( $(date +%s) - $(stat -f %m "$badge_cache" 2>/dev/null || stat -c %Y "$badge_cache" 2>/dev/null || echo 0) > 5 )); then
    # Discover delamain directories
    delamain_dirs=()
    sr="$cwd"
    while [[ "$sr" != "/" ]]; do
        [[ -d "$sr/.claude/delamains" ]] && delamain_dirs+=("$sr/.claude/delamains") && break
        sr=$(dirname "$sr")
    done
    rf="$cwd/.claude/delamain-roots"
    if [[ -f "$rf" ]]; then
        while IFS= read -r er; do
            [[ -n "$er" && -d "$er/.claude/delamains" ]] && delamain_dirs+=("$er/.claude/delamains")
        done < "$rf"
    fi

    badges=""
    widths=""
    for dp in "${delamain_dirs[@]}"; do
        for dy in "$dp"/*/delamain.yaml; do
            [[ -f "$dy" ]] || continue
            d_dir=$(dirname "$dy")
            d_name=$(basename "$d_dir")
            sf="$d_dir/status.json"

            symbol="○"; color="2;37"
            if [[ -f "$sf" ]]; then
                d_pid=$(jq -r '.pid // empty' "$sf" 2>/dev/null)
                d_active=$(jq -r '.active_dispatches // 0' "$sf" 2>/dev/null)
                d_error=$(jq -r '.last_error // empty' "$sf" 2>/dev/null)
                if [[ -n "$d_pid" ]] && kill -0 "$d_pid" 2>/dev/null; then
                    if [[ -n "$d_error" ]]; then
                        symbol="✗"; color="1;31"
                    elif (( d_active > 0 )); then
                        symbol="⚡"; color="1;32"
                    else
                        symbol="✓"; color="32"
                    fi
                else
                    symbol="✗"; color="1;31"
                fi
            fi

            badges+="$(printf '\033[%sm[%s %s]\033[0m' "$color" "$d_name" "$symbol")|"
            widths+="$(( ${#d_name} + 4 ))|"
        done
    done
    echo -n "$badges" > "$badge_cache"
    echo -n "$widths" > "$badge_width_cache"
fi

# ---------------------------------------------------------------------------
# OBS indicator (cached 5s — calls python + websocket)
# ---------------------------------------------------------------------------
obs_indicator=""
obs_cache="$CACHE_DIR/obs"
obs_script="$SCRIPT_DIR/obs-status.py"
if [[ -f "$obs_script" ]]; then
    if [[ ! -f "$obs_cache" ]] || (( $(date +%s) - $(stat -f %m "$obs_cache" 2>/dev/null || stat -c %Y "$obs_cache" 2>/dev/null || echo 0) > 5 )); then
        python3 "$obs_script" > "$obs_cache" 2>/dev/null || echo '{}' > "$obs_cache"
    fi
    obs_json=$(<"$obs_cache")
    if [[ -n "$obs_json" && "$obs_json" != "{}" ]]; then
        obs_streaming=$(echo "$obs_json" | jq -r '.streaming' 2>/dev/null)
        obs_recording=$(echo "$obs_json" | jq -r '.recording' 2>/dev/null)
        blink_on=$(( $(date +%s) % 2 ))
        if [[ "$obs_streaming" == "true" ]]; then
            if (( blink_on )); then obs_indicator=$(printf ' \033[1;31m● LIVE\033[0m')
            else obs_indicator=$(printf ' \033[2;31m○ LIVE\033[0m'); fi
        elif [[ "$obs_recording" == "true" ]]; then
            if (( blink_on )); then obs_indicator=$(printf ' \033[1;33m● REC\033[0m')
            else obs_indicator=$(printf ' \033[2;33m○ REC\033[0m'); fi
        fi
    fi
fi

# ---------------------------------------------------------------------------
# Render to buffer, then output + cache in one shot
# ---------------------------------------------------------------------------
output=""

line1=""
line1+=$(printf '\033[1;36m%s\033[0m' "$dir")
[[ -n "$branch" ]] && line1+=$(printf ' \033[1;33m⎇ %s\033[0m' "$branch")
line1+=$(printf ' \033[2;34m(%s)\033[0m' "$model")
line1+="$context_info"
line1+=$(printf ' \033[2;37mTIME %s\033[0m' "$(date +%H:%M)")
line1+="$obs_indicator"

output+="$line1"

badges_raw=$(cat "$badge_cache" 2>/dev/null)
widths_raw=$(cat "$badge_width_cache" 2>/dev/null)

badges_per_line=4

if [[ -n "$badges_raw" ]]; then
    IFS='|' read -ra badge_arr <<< "$badges_raw"
    IFS='|' read -ra width_arr <<< "$widths_raw"

    max_w=0
    for w in "${width_arr[@]}"; do
        [[ -n "$w" ]] && (( w > max_w )) && max_w=$w
    done

    line=""
    count=0
    for i in "${!badge_arr[@]}"; do
        b="${badge_arr[$i]}"
        [[ -z "$b" ]] && continue
        bw="${width_arr[$i]:-0}"

        pad=$(( max_w - bw ))
        padding=""
        (( pad > 0 )) && printf -v padding "%${pad}s" ""

        if (( count > 0 && count % badges_per_line == 0 )); then
            output+=$'\n'"$line"
            line=""
        fi
        line+=" ${b}${padding}"
        count=$((count + 1))
    done
    [[ -n "$line" ]] && output+=$'\n'"$line"
fi

# Output to stdout and cache the render for the rapid-fire guard (Option B)
echo "$output"
echo "$output" > "$render_cache"
