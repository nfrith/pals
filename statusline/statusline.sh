#!/bin/bash
# statusline.sh - Starship-inspired statusline for Claude Code

# Read JSON input from stdin
input=$(cat)

# Extract data from JSON
cwd=$(echo "$input" | jq -r '.workspace.current_dir')
model=$(echo "$input" | jq -r '.model.display_name')

# Get directory name (truncated path like Starship)
dir=$(basename "$cwd")

# Get git branch if in a git repo (with --git-dir to avoid optional locks)
branch=$(cd "$cwd" 2>/dev/null && git --git-dir="$(git rev-parse --git-dir 2>/dev/null)" branch --show-current 2>/dev/null)

# Detect terminal width — stty hack reads from /dev/tty since Claude pipes stdin
term_width=80
if tw=$(stty size < /dev/tty 2>/dev/null | awk '{print $2}') && [[ -n "$tw" ]] && (( tw > 0 )); then
    term_width=$tw
fi
# Reserve space for right-side notifications (MCP errors, "Approaching limit", etc.)
max_line=$((term_width - 6))

# Calculate context usage with visual progress bar
used_pct=$(echo "$input" | jq '.context_window.used_percentage // empty')
remaining_pct=$(echo "$input" | jq '.context_window.remaining_percentage // empty')
context_info=""
if [[ -n "$used_pct" && "$used_pct" != "null" ]]; then
    pct=${used_pct%.*}
    rem=${remaining_pct%.*}

    bar_width=10
    filled=$((pct * bar_width / 100))
    empty=$((bar_width - filled))

    bar="["
    for ((i=0; i<filled; i++)); do bar+="█"; done
    for ((i=0; i<empty; i++)); do bar+="░"; done
    bar+="]"

    context_info=$(printf ' \033[2;35m%s %d%%\033[0m' "$bar" "$pct")
fi

# ---------------------------------------------------------------------------
# Delamain health badges — discover all, wrap across lines to fit terminal
# ---------------------------------------------------------------------------

# Collect delamain directories to scan:
# 1. Walk up from cwd to find .claude/delamains (project-level)
# 2. Read .claude/delamain-roots for additional paths (e.g., run-demo)
delamain_dirs=()

sys_root="$cwd"
while [[ "$sys_root" != "/" ]]; do
    [[ -d "$sys_root/.claude/delamains" ]] && delamain_dirs+=("$sys_root/.claude/delamains") && break
    sys_root=$(dirname "$sys_root")
done

roots_file="$cwd/.claude/delamain-roots"
if [[ -f "$roots_file" ]]; then
    while IFS= read -r extra_root; do
        [[ -n "$extra_root" && -d "$extra_root/.claude/delamains" ]] && delamain_dirs+=("$extra_root/.claude/delamains")
    done < "$roots_file"
fi

# Collect badge data: parallel arrays for rendered badge and visible width
badge_rendered=()
badge_width=()
delamain_count=0

for delamains_path in "${delamain_dirs[@]}"; do
    for dy in "$delamains_path"/*/delamain.yaml; do
        [[ -f "$dy" ]] || continue
        d_dir=$(dirname "$dy")
        d_name=$(basename "$d_dir")
        sf="$d_dir/status.json"
        delamain_count=$((delamain_count + 1))

        # Determine state
        symbol="○"; color="2;37"  # default: off (dimmed)
        if [[ -f "$sf" ]]; then
            d_pid=$(jq -r '.pid // empty' "$sf" 2>/dev/null)
            d_active=$(jq -r '.active_dispatches // 0' "$sf" 2>/dev/null)
            d_error=$(jq -r '.last_error // empty' "$sf" 2>/dev/null)

            if [[ -n "$d_pid" ]] && kill -0 "$d_pid" 2>/dev/null; then
                if [[ -n "$d_error" ]]; then
                    symbol="✗"; color="1;31"   # errored — red
                elif (( d_active > 0 )); then
                    symbol="⚡"; color="1;32"  # processing — bright green
                else
                    symbol="✓"; color="32"     # on, idle — green
                fi
            else
                symbol="✗"; color="1;31"       # dead PID — red
            fi
        fi

        rendered=$(printf '\033[%sm[%s %s]\033[0m' "$color" "$d_name" "$symbol")
        visible_w=$(( ${#d_name} + 4 ))  # [name S] = name + [ + space + symbol + ]

        badge_rendered+=("$rendered")
        badge_width+=("$visible_w")
    done
done

# ---------------------------------------------------------------------------
# Build output — each echo = separate row in Claude Code statusline
# ---------------------------------------------------------------------------

# Line 1: directory, branch, model, context, clock, OBS
line1=""
line1+=$(printf '\033[1;36m%s\033[0m' "$dir")
[[ -n "$branch" ]] && line1+=$(printf ' \033[1;33m⎇ %s\033[0m' "$branch")
line1+=$(printf ' \033[2;34m(%s)\033[0m' "$model")
line1+="$context_info"

# Clock in dimmed white
line1+=$(printf ' \033[2;37mTIME %s\033[0m' "$(date +%H:%M)")

# OBS streaming/recording indicator (Python stdlib WebSocket, no deps)
obs_script="$(dirname "$0")/obs-status.py"
if [[ -f "$obs_script" ]]; then
    obs_json=$(python3 "$obs_script" 2>/dev/null)
    if [[ -n "$obs_json" ]]; then
        obs_streaming=$(echo "$obs_json" | jq -r '.streaming' 2>/dev/null)
        obs_recording=$(echo "$obs_json" | jq -r '.recording' 2>/dev/null)
    fi
    blink_on=$(( $(date +%s) % 2 ))
    if [[ "$obs_streaming" == "true" ]]; then
        if (( blink_on )); then
            line1+=$(printf ' \033[1;31m● LIVE\033[0m')
        else
            line1+=$(printf ' \033[2;31m○ LIVE\033[0m')
        fi
    elif [[ "$obs_recording" == "true" ]]; then
        if (( blink_on )); then
            line1+=$(printf ' \033[1;33m● REC\033[0m')
        else
            line1+=$(printf ' \033[2;33m○ REC\033[0m')
        fi
    fi
fi

echo "$line1"

# Delamain lines: each echo = one row, wrap badges to fit within max_line
if (( delamain_count > 0 )); then
    line=""
    line_len=0

    for i in "${!badge_rendered[@]}"; do
        bw=${badge_width[$i]}
        needed=$(( bw + 1 ))  # +1 for leading space

        # Wrap to next line if this badge won't fit
        if (( line_len + needed > max_line && line_len > 0 )); then
            echo "$line"
            line=""
            line_len=0
        fi

        line+=" ${badge_rendered[$i]}"
        line_len=$(( line_len + needed ))
    done

    # Flush remaining badges
    [[ -n "$line" ]] && echo "$line"
fi
