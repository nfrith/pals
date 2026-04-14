#!/bin/bash
# PostToolUse hook — run ALS compiler against the module containing the edited file.
# Short-circuits for non-ALS files. Scopes validation to the affected module only.
set -euo pipefail

# Skip validation in demo mode (e.g. /run-demo traffic generators)
[[ "${ALS_DEMO_MODE:-}" == "1" ]] && exit 0

COMPILER="${CLAUDE_PLUGIN_ROOT}/alsc/compiler"

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // ""')

# No file path in tool input? Skip.
[[ -n "$file_path" ]] || exit 0

# --- System root discovery ---
# Walk up from the edited file looking for .als/system.ts
find_system_root() {
  local dir
  dir=$(dirname "$1")
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/.als/system.ts" ]]; then
      echo "$dir"
      return 0
    fi
    dir=$(dirname "$dir")
  done
  return 1
}

system_root=$(find_system_root "$file_path") || exit 0

if ! command -v bun &>/dev/null; then
  exit 0
fi

# --- Module resolution ---
# Make file_path relative to system root
rel_path="${file_path#"$system_root"/}"
# If file_path wasn't under system_root, skip
[[ "$rel_path" != "$file_path" ]] || exit 0

module_id=$(bun -e '
  const { join } = require("node:path");
  const [systemRoot, relPath] = process.argv.slice(1);
  try {
    const requireFn = require;
    const systemPath = join(systemRoot, ".als", "system.ts");
    const resolvedPath = requireFn.resolve(systemPath);
    delete requireFn.cache?.[resolvedPath];
    const loaded = requireFn(resolvedPath);
    const system = loaded.system ?? loaded.default;
    for (const [moduleId, moduleConfig] of Object.entries(system?.modules ?? {})) {
      if (relPath === moduleConfig.path || relPath.startsWith(`${moduleConfig.path}/`)) {
        console.log(moduleId);
        break;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ALS validate hook: could not load ${join(systemRoot, ".als", "system.ts")}: ${message}`);
  }
' "$system_root" "$rel_path")

# File not in any module? Skip.
[[ -n "$module_id" ]] || exit 0

# --- Compiler check ---
if [[ ! -f "$COMPILER/src/index.ts" ]]; then
  exit 0
fi

# --- Run compiler ---
# Capture exit code explicitly — set -e must not kill us on validation failure
output=$(bun "$COMPILER/src/index.ts" "$system_root" "$module_id" 2>&1) && exit_code=0 || exit_code=$?

case $exit_code in
  0)
    # Silent success — no stdout, clean exit
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
