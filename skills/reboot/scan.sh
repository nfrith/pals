#!/bin/bash
# Fast scan: find offline delamains for /reboot
# Outputs only what's needed — no config, no formatting frills

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/runtime-env.sh"

if ! als_runtime_init_env "${ALS_HARNESS:-${1:-}}" "$(pwd)"; then
    echo "$ALS_RUNTIME_ERROR"
    exit 0
fi

delamains_root="$DELAMAINS_ROOT"
als_runtime_emit_env

if [[ ! -d "$delamains_root" ]]; then
    echo "NO_DELAMAINS"
    exit 0
fi

offline_names=()
running_names=()

for dy in "$delamains_root"/*/delamain.yaml; do
    [[ -f "$dy" ]] || continue
    d_dir=$(dirname "$dy")
    d_name=$(basename "$d_dir")
    sf="$d_dir/status.json"

    [[ -d "$d_dir/dispatcher" ]] || continue

    if [[ -f "$sf" ]]; then
        d_pid=$(jq -r '.pid // empty' "$sf" 2>/dev/null)
        if [[ -n "$d_pid" ]] && kill -0 "$d_pid" 2>/dev/null; then
            running_names+=("$d_name")
            continue
        fi
    fi

    offline_names+=("$d_name")
done

if (( ${#running_names[@]} > 0 )); then
    echo "RUNNING: ${running_names[*]}"
fi

if (( ${#offline_names[@]} == 0 )); then
    echo "ALL_RUNNING"
else
    echo "OFFLINE: ${offline_names[*]}"
fi
