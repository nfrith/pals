#!/bin/bash
# Scan delamain status for /bootup
# Reports all delamains with their status (running or offline).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/runtime-env.sh"

if ! als_runtime_init_env "${ALS_HARNESS:-${1:-}}" "$(pwd)"; then
    echo "$ALS_RUNTIME_ERROR"
    exit 0
fi

sys_root="$SYSTEM_ROOT"
harness="$HARNESS"
delamains_root="$DELAMAINS_ROOT"
als_runtime_emit_env

if [[ ! -d "$delamains_root" ]]; then
    echo "NO_DELAMAINS"
    exit 0
fi

all_names=()
running_pids=()

for dy in "$delamains_root"/*/delamain.yaml; do
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

# Detect PULSE (statusline background data producer, GF-034).
# Pulse writes meta.json every tick with its PID; if the file exists and the
# PID is alive, report it so /bootup can kill + respawn it alongside dispatchers.
if [[ "$STATUSLINE_SUPPORTED" == "yes" && -n "$STATUSLINE_CACHE_ROOT" ]]; then
    pulse_meta="$STATUSLINE_CACHE_ROOT/meta.json"
else
    pulse_meta=""
fi
if [[ -n "$pulse_meta" && -f "$pulse_meta" ]]; then
    p_pid=$(jq -r '.pid // empty' "$pulse_meta" 2>/dev/null)
    if [[ -n "$p_pid" ]] && kill -0 "$p_pid" 2>/dev/null; then
        echo "PULSE_PID: $p_pid"
    fi
fi
