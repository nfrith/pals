#!/bin/bash
# Codex PostToolUse adapter. It expands Codex apply_patch payloads into the
# file_path shape consumed by the existing ALS PostToolUse hooks.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  exit 0
fi

target_script="$1"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugin_root="${ALS_PLUGIN_ROOT:-}"
if [[ -z "$plugin_root" ]]; then
  plugin_root="$(cd "$script_dir/.." && pwd)"
fi
export ALS_PLUGIN_ROOT="$plugin_root"

command -v jq >/dev/null 2>&1 || exit 0
[[ -f "$target_script" ]] || exit 0

input=$(cat)
cwd=$(printf '%s' "$input" | jq -r '.cwd // ""' 2>/dev/null || true)
tool_name=$(printf '%s' "$input" | jq -r '.tool_name // ""' 2>/dev/null || true)
direct_file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""' 2>/dev/null || true)
patch_command=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null || true)

resolve_path() {
  local path="$1"
  if [[ "$path" == /* || -z "$cwd" ]]; then
    printf '%s\n' "$path"
  else
    printf '%s/%s\n' "$cwd" "$path"
  fi
}

extract_patch_paths() {
  local line path
  while IFS= read -r line; do
    case "$line" in
      "*** Add File: "*)
        path="${line#"*** Add File: "}"
        ;;
      "*** Update File: "*)
        path="${line#"*** Update File: "}"
        ;;
      "*** Delete File: "*)
        path="${line#"*** Delete File: "}"
        ;;
      "*** Move to: "*)
        path="${line#"*** Move to: "}"
        ;;
      *)
        continue
        ;;
    esac
    [[ -n "$path" ]] && resolve_path "$path"
  done <<< "$patch_command"
}

paths=""
if [[ -n "$direct_file_path" ]]; then
  paths="$(resolve_path "$direct_file_path")"
elif [[ "$tool_name" == "apply_patch" && -n "$patch_command" ]]; then
  paths="$(extract_patch_paths | awk '!seen[$0]++')"
fi

[[ -n "$paths" ]] || exit 0

first_output=""
while IFS= read -r file_path; do
  [[ -n "$file_path" ]] || continue
  normalized_input=$(
    printf '%s' "$input" | jq -c --arg file_path "$file_path" '
      .tool_input = ((.tool_input // {}) + {file_path: $file_path})
    ' 2>/dev/null
  ) || continue

  output=$(printf '%s' "$normalized_input" | bash "$target_script" 2>/dev/null) && rc=0 || rc=$?
  if [[ $rc -eq 2 ]]; then
    [[ -n "$output" ]] && printf '%s\n' "$output"
    exit 2
  fi
  if [[ $rc -ne 0 ]]; then
    continue
  fi
  if [[ -z "$first_output" && -n "$output" ]]; then
    first_output="$output"
  fi
done <<< "$paths"

[[ -n "$first_output" ]] && printf '%s\n' "$first_output"
exit 0
