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
