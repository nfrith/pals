#!/bin/bash
# Scan delamain status for /bootup
# Reports all delamains with their status (running or offline).

# Walk up from cwd to find system root
sys_root="$(pwd)"
while [[ "$sys_root" != "/" ]]; do
    [[ -f "$sys_root/.als/system.ts" ]] && break
    sys_root=$(dirname "$sys_root")
done

if [[ ! -f "$sys_root/.als/system.ts" ]]; then
    echo "NO_SYSTEM"
    exit 0
fi

echo "SYSTEM_ROOT: $sys_root"

if [[ ! -d "$sys_root/.claude/delamains" ]]; then
    echo "NO_DELAMAINS"
    exit 0
fi

all_names=()
running_pids=()

for dy in "$sys_root"/.claude/delamains/*/delamain.yaml; do
    [[ -f "$dy" ]] || continue
    d_dir=$(dirname "$dy")
    d_name=$(basename "$d_dir")
    sf="$d_dir/status.json"

    [[ -d "$d_dir/dispatcher" ]] || continue

    all_names+=("$d_name")

    if [[ -f "$sf" ]]; then
        d_pid=$(jq -r '.pid // empty' "$sf" 2>/dev/null)
        if [[ -n "$d_pid" ]] && kill -0 "$d_pid" 2>/dev/null; then
            running_pids+=("$d_pid")
        fi
    fi
done

if (( ${#all_names[@]} == 0 )); then
    echo "NO_DELAMAINS"
    exit 0
fi

echo "ALL_DELAMAINS: ${all_names[*]}"

if (( ${#running_pids[@]} > 0 )); then
    echo "RUNNING_PIDS: ${running_pids[*]}"
fi
