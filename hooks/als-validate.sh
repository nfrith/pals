#!/bin/bash
# PostToolUse hook — run ALS compiler against the module containing the edited file.
# Short-circuits for non-ALS files. Scopes validation to the affected module only.
set -euo pipefail

COMPILER="${CLAUDE_PLUGIN_ROOT}/alsc/compiler"

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // ""')

# No file path in tool input? Skip.
[[ -n "$file_path" ]] || exit 0

# --- System root discovery ---
# Walk up from the edited file looking for .als/system.yaml
find_system_root() {
  local dir
  dir=$(dirname "$1")
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/.als/system.yaml" ]]; then
      echo "$dir"
      return 0
    fi
    dir=$(dirname "$dir")
  done
  return 1
}

system_root=$(find_system_root "$file_path") || exit 0

# --- Module resolution ---
# Make file_path relative to system root
rel_path="${file_path#"$system_root"/}"
# If file_path wasn't under system_root, skip
[[ "$rel_path" != "$file_path" ]] || exit 0

# Parse system.yaml to extract module_id:path pairs, match against relative path
module_id=""
while IFS=: read -r mod mod_path; do
  if [[ "$rel_path" == "$mod_path/"* ]]; then
    module_id="$mod"
    break
  fi
done < <(awk '/^  [^ ].*:$/ { mod = $1; sub(/:$/, "", mod) } /^    path:/ { p = $2; gsub(/["'"'"']/, "", p); print mod ":" p }' "$system_root/.als/system.yaml")

# File not in any module? Skip.
[[ -n "$module_id" ]] || exit 0

# --- Compiler check ---
if ! command -v bun &>/dev/null; then
  exit 0
fi

if [[ ! -f "$COMPILER/src/index.ts" ]]; then
  exit 0
fi

# --- Run compiler ---
# Capture exit code explicitly — set -e must not kill us on validation failure
output=$(bun "$COMPILER/src/index.ts" "$system_root" "$module_id" 2>&1) && exit_code=0 || exit_code=$?

case $exit_code in
  0)
    echo "ALS: module '$module_id' validates OK"
    ;;
  1)
    # Validation failed — structured block decision with compiler diagnostics
    reason="ALS validation failed for module '$module_id'. STOP: fix all errors before making any more edits."
    echo "$output" | jq -Rs --arg reason "$reason" \
      '{decision: "block", reason: $reason, hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: .}}' 2>/dev/null \
    || echo "{\"decision\":\"block\",\"reason\":\"$reason\"}"
    exit 2
    ;;
  *)
    # Compiler infrastructure error — don't burden the agent
    exit 0
    ;;
esac
