#!/bin/bash
# Fast scan: find offline delamains for /reboot
# Outputs only what's needed — no config, no formatting frills

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
