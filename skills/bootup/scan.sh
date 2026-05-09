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

harness="${ALS_HARNESS:-${1:-}}"
case "$harness" in
    claude)
        delamains_root="$sys_root/.claude/delamains"
        ;;
    codex)
        delamains_root="$sys_root/.codex/delamains"
        ;;
    "")
        if [[ -d "$sys_root/.codex/delamains" && ! -d "$sys_root/.claude/delamains" ]]; then
            harness="codex"
            delamains_root="$sys_root/.codex/delamains"
        else
            harness="claude"
            delamains_root="$sys_root/.claude/delamains"
        fi
        ;;
    *)
        echo "UNKNOWN_HARNESS: $harness"
        exit 0
        ;;
esac

echo "HARNESS: $harness"
echo "DELAMAINS_ROOT: $delamains_root"

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
if [[ "$harness" == "claude" ]]; then
    pulse_meta="$sys_root/.claude/scripts/.cache/pulse/meta.json"
else
    pulse_meta=""
fi
if [[ -n "$pulse_meta" && -f "$pulse_meta" ]]; then
    p_pid=$(jq -r '.pid // empty' "$pulse_meta" 2>/dev/null)
    if [[ -n "$p_pid" ]] && kill -0 "$p_pid" 2>/dev/null; then
        echo "PULSE_PID: $p_pid"
    fi
fi
