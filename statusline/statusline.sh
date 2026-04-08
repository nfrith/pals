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

input=$(cat)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CACHE_DIR="$SCRIPT_DIR/.cache"
[[ -d "$CACHE_DIR" ]] || mkdir -p "$CACHE_DIR"

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
# Render line 1: dir, branch, model, context, clock, OBS
# ---------------------------------------------------------------------------
line1=""
line1+=$(printf '\033[1;36m%s\033[0m' "$dir")
[[ -n "$branch" ]] && line1+=$(printf ' \033[1;33m⎇ %s\033[0m' "$branch")
line1+=$(printf ' \033[2;34m(%s)\033[0m' "$model")
line1+="$context_info"
line1+=$(printf ' \033[2;37mTIME %s\033[0m' "$(date +%H:%M)")
line1+="$obs_indicator"

echo "$line1"

# ---------------------------------------------------------------------------
# Render delamain badge lines from cache
# ---------------------------------------------------------------------------
badges_raw=$(cat "$badge_cache" 2>/dev/null)
widths_raw=$(cat "$badge_width_cache" 2>/dev/null)

if [[ -n "$badges_raw" ]]; then
    IFS='|' read -ra badge_arr <<< "$badges_raw"
    IFS='|' read -ra width_arr <<< "$widths_raw"

    line=""
    line_len=0
    for i in "${!badge_arr[@]}"; do
        b="${badge_arr[$i]}"
        [[ -z "$b" ]] && continue
        bw="${width_arr[$i]:-20}"
        needed=$(( bw + 1 ))

        if (( line_len + needed > max_line && line_len > 0 )); then
            echo "$line"
            line=""
            line_len=0
        fi
        line+=" $b"
        line_len=$(( line_len + needed ))
    done
    [[ -n "$line" ]] && echo "$line"
fi
