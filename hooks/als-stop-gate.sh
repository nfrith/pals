#!/bin/bash
# Stop hook — final validation gate before Claude can finish its turn.
# Only validates ALS systems and modules that were actually touched during
# this session, as recorded by the breadcrumb PostToolUse hook.
set -euo pipefail

COMPILER="${CLAUDE_PLUGIN_ROOT}/alsc/compiler"

input=$(cat)
session_id=$(echo "$input" | jq -r '.session_id // ""')

# No session id? Can't find breadcrumbs. Allow stop.
[[ -n "$session_id" ]] || exit 0

# Check for breadcrumb file — if none, this session didn't touch ALS files.
breadcrumb_file="/tmp/als-touched-${session_id}"
[[ -f "$breadcrumb_file" ]] || exit 0

# Bail if compiler isn't available
command -v bun &>/dev/null || exit 0
[[ -f "$COMPILER/src/index.ts" ]] || exit 0

# Read breadcrumbs and deduplicate into a flat list of "system_root:module_id" pairs.
# __system__ entries mean full-system validation.
# Compatible with bash 3.2 (no associative arrays).
entries=""
while IFS=: read -r system_root module_id; do
  [[ -n "$system_root" ]] || continue
  pair="${system_root}:${module_id}"
  # Skip duplicates
  case "$entries" in
    *"|${pair}|"*) continue ;;
  esac
  # If __system__, drop any module-specific entries for this root
  if [[ "$module_id" == "__system__" ]]; then
    cleaned=""
    IFS='|' ; for e in $entries; do
      [[ -z "$e" ]] && continue
      e_root="${e%%:*}"
      [[ "$e_root" == "$system_root" ]] && continue
      cleaned="${cleaned}|${e}|"
    done
    unset IFS
    entries="${cleaned}|${pair}|"
  else
    # Skip if this system already has a __full__ entry
    case "$entries" in
      *"|${system_root}:__system__|"*) continue ;;
    esac
    entries="${entries}|${pair}|"
  fi
done < "$breadcrumb_file"

# Nothing to validate? Allow stop.
[[ -n "$entries" ]] || exit 0

# Validate each touched system/module
fail_count=0
IFS='|'
for pair in $entries; do
  [[ -z "$pair" ]] && continue
  system_root="${pair%%:*}"
  module_id="${pair#*:}"
  if [[ "$module_id" == "__system__" ]]; then
    bun "$COMPILER/src/index.ts" "$system_root" >/dev/null 2>&1 && rc=0 || rc=$?
  else
    bun "$COMPILER/src/index.ts" "$system_root" "$module_id" >/dev/null 2>&1 && rc=0 || rc=$?
  fi
  if [[ $rc -eq 1 ]]; then
    fail_count=$((fail_count + 1))
  fi
done
unset IFS

# All clean — clear breadcrumbs and allow stop
if [[ $fail_count -eq 0 ]]; then
  rm -f "$breadcrumb_file"
  exit 0
fi

# Something broken — block stop
reason="ALS validation gate: ${fail_count} system(s)/module(s) still have errors. Fix all validation errors before finishing."
echo "{\"decision\":\"block\",\"reason\":\"$reason\"}"
exit 2
