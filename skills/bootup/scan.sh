#!/bin/bash
# Scan for .als/config.md and delamain status for the /bootup skill preprocessor

# Walk up from cwd to find system root
sys_root="$(pwd)"
while [[ "$sys_root" != "/" ]]; do
    [[ -f "$sys_root/.als/system.ts" ]] && break
    sys_root=$(dirname "$sys_root")
done

if [[ ! -f "$sys_root/.als/system.ts" ]]; then
    echo "No .als/system.ts found in parent directories. Not an ALS system."
    exit 0
fi

echo "System root: \`$sys_root\`"
echo ""

# Check for config.md
config_file="$sys_root/.als/config.md"
if [[ -f "$config_file" ]]; then
    echo "CONFIG: found"
    echo ""
    echo "### Operator's Preferences"
    echo ""
    # Extract the Operator's Preferences section content
    awk "/^## Operator's Preferences/{found=1;next} found && /^## /{exit} found{print}" "$config_file"
    echo ""
else
    echo "CONFIG: none"
    echo ""
fi

# Scan delamain status
echo "### Delamain Status"
echo ""

if [[ ! -d "$sys_root/.claude/delamains" ]]; then
    echo "No .claude/delamains/ found. No dispatchers to start."
    exit 0
fi

echo "| Delamain | Status | PID |"
echo "|----------|--------|-----|"

offline_names=()

for dy in "$sys_root"/.claude/delamains/*/delamain.yaml; do
    [[ -f "$dy" ]] || continue
    d_dir=$(dirname "$dy")
    d_name=$(basename "$d_dir")
    sf="$d_dir/status.json"

    [[ -d "$d_dir/dispatcher" ]] || continue

    if [[ -f "$sf" ]]; then
        d_pid=$(jq -r '.pid // empty' "$sf" 2>/dev/null)
        if [[ -n "$d_pid" ]] && kill -0 "$d_pid" 2>/dev/null; then
            echo "| $d_name | running | $d_pid |"
            continue
        fi
    fi

    echo "| $d_name | **offline** | - |"
    offline_names+=("$d_name")
done

echo ""

if (( ${#offline_names[@]} == 0 )); then
    echo "All dispatchers are running. Nothing to do."
else
    echo "OFFLINE_DELAMAINS: ${offline_names[*]}"
fi
