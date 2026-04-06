#!/bin/bash
# delamain-start.sh — SessionStart hook
# Scans .claude/delamains/ for dispatchers and starts any that are offline.
# SessionEnd hook (delamain-stop.sh) handles cleanup on real exit.

set -euo pipefail

input=$(cat)
cwd=$(echo "$input" | jq -r '.cwd // empty')
[[ -z "$cwd" ]] && exit 0

# Walk up from cwd to find system root
sys_root="$cwd"
while [[ "$sys_root" != "/" ]]; do
    [[ -d "$sys_root/.claude/delamains" ]] && break
    sys_root=$(dirname "$sys_root")
done

[[ ! -d "$sys_root/.claude/delamains" ]] && exit 0

now=$(date +%s)
started=()
already_running=()

for dy in "$sys_root"/.claude/delamains/*/delamain.yaml; do
    [[ -f "$dy" ]] || continue
    d_dir=$(dirname "$dy")
    d_name=$(basename "$d_dir")
    sf="$d_dir/status.json"
    dispatcher_dir="$d_dir/dispatcher"

    # Must have a dispatcher directory
    [[ -d "$dispatcher_dir" ]] || continue

    # Check if already running via heartbeat
    if [[ -f "$sf" ]]; then
        d_tick=$(jq -r '.last_tick // empty' "$sf" 2>/dev/null)
        d_poll=$(jq -r '.poll_ms // 30000' "$sf" 2>/dev/null)

        if [[ -n "$d_tick" ]]; then
            tick_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${d_tick%%.*}" +%s 2>/dev/null || echo 0)
            stale_threshold=$(( d_poll * 2 / 1000 ))
            age=$(( now - tick_epoch ))

            if (( age <= stale_threshold )); then
                already_running+=("$d_name")
                continue
            fi
        fi

        # Stale heartbeat — clean it up before restart
        rm -f "$sf"
    fi

    # Start the dispatcher in the background
    cd "$dispatcher_dir"
    bun install --silent 2>/dev/null
    nohup bun run src/index.ts > /tmp/als-dispatcher-${d_name}.log 2>&1 &
    started+=("$d_name")
done

# Report to Claude via stdout
if (( ${#started[@]} > 0 || ${#already_running[@]} > 0 )); then
    if (( ${#already_running[@]} > 0 )); then
        echo "Delamain running: ${already_running[*]}"
    fi
    if (( ${#started[@]} > 0 )); then
        echo "Delamain started: ${started[*]}"
    fi
fi
