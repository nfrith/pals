#!/bin/bash
# delamain-stop.sh — SessionEnd hook
# Kills running delamain dispatchers and cleans up heartbeat files.
# Only runs on real exits — skips clear and resume so dispatchers survive those.

set -euo pipefail

input=$(cat)
reason=$(echo "$input" | jq -r '.reason // "other"')
cwd=$(echo "$input" | jq -r '.cwd // empty')

# Skip cleanup on clear and resume — dispatchers should keep running
case "$reason" in
    clear|resume) exit 0 ;;
esac

[[ -z "$cwd" ]] && exit 0

# Walk up from cwd to find system root
sys_root="$cwd"
while [[ "$sys_root" != "/" ]]; do
    [[ -d "$sys_root/.claude/delamains" ]] && break
    sys_root=$(dirname "$sys_root")
done

[[ ! -d "$sys_root/.claude/delamains" ]] && exit 0

for sf in "$sys_root"/.claude/delamains/*/status.json; do
    [[ -f "$sf" ]] || continue
    pid=$(jq -r '.pid // empty' "$sf" 2>/dev/null)
    d_name=$(jq -r '.name // "unknown"' "$sf" 2>/dev/null)

    # Kill the dispatcher process
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
    fi

    # Clean up heartbeat file
    rm -f "$sf"
done

# Reap PULSE (statusline background data producer, GF-034 Phase 2).
# Shares the same reason filter as dispatchers — already skipped clear|resume
# at the top of this hook, so we only get here on real SessionEnd.
pulse_meta="$sys_root/.claude/scripts/.cache/pulse/meta.json"
if [[ -f "$pulse_meta" ]]; then
    p_pid=$(jq -r '.pid // empty' "$pulse_meta" 2>/dev/null)
    if [[ -n "$p_pid" ]] && kill -0 "$p_pid" 2>/dev/null; then
        kill "$p_pid" 2>/dev/null || true
    fi
    rm -f "$pulse_meta" \
          "$sys_root/.claude/scripts/.cache/pulse/delamains.json" \
          "$sys_root/.claude/scripts/.cache/pulse/live.json"
fi
