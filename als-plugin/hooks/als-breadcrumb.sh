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
rel_path="${file_path#"$system_root"/}"
[[ "$rel_path" != "$file_path" ]] || exit 0

module_id=""
while IFS=: read -r mod mod_path; do
  if [[ "$rel_path" == "$mod_path/"* ]]; then
    module_id="$mod"
    break
  fi
done < <(awk '/^  [^ ].*:$/ { mod = $1; sub(/:$/, "", mod) } /^    path:/ { p = $2; gsub(/["'"'"']/, "", p); print mod ":" p }' "$system_root/.als/system.yaml")

# Also catch writes to .als/ metadata (shape files, system.yaml, etc.)
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
