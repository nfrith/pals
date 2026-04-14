#!/bin/bash
# PostToolUse hook — records which ALS systems/modules were touched during this session.
# The stop gate reads these breadcrumbs to know what to validate.
#
# This hook does NOT run the compiler. It only records filesystem context.
#
# TODO: This hook only fires on Write|Edit tool calls. Bash-based file mutations
# (e.g. `echo ... > file.md`) are not captured. Supporting Bash would require
# parsing shell commands to extract file paths, which is fragile.
set -euo pipefail

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // ""')
session_id=$(echo "$input" | jq -r '.session_id // ""')

# No file path or session id? Skip.
[[ -n "$file_path" ]] || exit 0
[[ -n "$session_id" ]] || exit 0

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
rel_path="${file_path#"$system_root"/}"
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
    console.error(`ALS breadcrumb hook: could not load ${join(systemRoot, ".als", "system.ts")}: ${message}`);
  }
' "$system_root" "$rel_path")

# Also catch writes to .als/ metadata (module entrypoints, system.ts, etc.)
if [[ -z "$module_id" && "$rel_path" == ".als/"* ]]; then
  module_id="__system__"
fi

# Not in a module or .als/? Skip.
[[ -n "$module_id" ]] || exit 0

# --- Record breadcrumb ---
breadcrumb_file="/tmp/als-touched-${session_id}"
entry="${system_root}:${module_id}"

# Append only if not already recorded
grep -qxF "$entry" "$breadcrumb_file" 2>/dev/null || echo "$entry" >> "$breadcrumb_file"

exit 0
