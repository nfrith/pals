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

# Read breadcrumbs and deduplicate system roots
# Each line is system_root:module_id
# For __system__ entries (metadata edits), validate the whole system
declare -A systems_to_validate
while IFS=: read -r system_root module_id; do
  [[ -n "$system_root" ]] || continue
  if [[ "$module_id" == "__system__" ]]; then
    # Metadata edit — validate full system
    systems_to_validate["$system_root"]="__full__"
  elif [[ "${systems_to_validate[$system_root]:-}" != "__full__" ]]; then
    # Module edit — add to module list (space-separated)
    existing="${systems_to_validate[$system_root]:-}"
    if [[ -z "$existing" ]]; then
      systems_to_validate["$system_root"]="$module_id"
    elif [[ " $existing " != *" $module_id "* ]]; then
      systems_to_validate["$system_root"]="$existing $module_id"
    fi
  fi
done < "$breadcrumb_file"

# Nothing to validate? Allow stop.
[[ ${#systems_to_validate[@]} -gt 0 ]] || exit 0

# Validate each touched system/module
failed=()
for system_root in "${!systems_to_validate[@]}"; do
  modules="${systems_to_validate[$system_root]}"
  if [[ "$modules" == "__full__" ]]; then
    # Full system validation
    bun "$COMPILER/src/index.ts" "$system_root" >/dev/null 2>&1 && rc=0 || rc=$?
    if [[ $rc -eq 1 ]]; then
      failed+=("$system_root")
    fi
  else
    # Per-module validation
    for module_id in $modules; do
      bun "$COMPILER/src/index.ts" "$system_root" "$module_id" >/dev/null 2>&1 && rc=0 || rc=$?
      if [[ $rc -eq 1 ]]; then
        failed+=("$system_root:$module_id")
      fi
    done
  fi
done

# All clean — allow stop
[[ ${#failed[@]} -gt 0 ]] || exit 0

# Something broken — block stop
reason="ALS validation gate: ${#failed[@]} system(s)/module(s) still have errors. Fix all validation errors before finishing."
echo "{\"decision\":\"block\",\"reason\":\"$reason\"}"
exit 2
