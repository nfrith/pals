#!/bin/bash
# Stop hook — final validation gate before Claude can finish its turn.
# Only validates ALS systems and modules that were actually touched during
# this session, as recorded by the breadcrumb PostToolUse hook.
set -euo pipefail

# Skip validation in demo mode (e.g. /run-demo traffic generators)
[[ "${ALS_DEMO_MODE:-}" == "1" ]] && exit 0

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
command -v jq &>/dev/null || exit 0

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
warning_summaries=""

render_warning_context() {
  local target_label="$1"
  jq -r --arg target_label "$target_label" '
    if (.summary.warning_count // 0) == 0 then
      empty
    else
      [
        "ALS validation warnings remain for " + $target_label + ".",
        "Summary: " + ((.summary.warning_count // 0) | tostring) + " warning(s), "
          + ((.summary.error_count // 0) | tostring) + " error(s).",
        (
          [
            .system_diagnostics[],
            (.modules[]?.diagnostics[]?)
          ]
          | map(select(.severity == "warning"))
          | .[]
          | "- [" + .code + "] " + .message
            + (
              if .deprecation == null then
                ""
              else
                " (contract: " + .deprecation.contract
                + ", value: " + .deprecation.value
                + ", since: " + .deprecation.since
                + ", removed_in: " + .deprecation.removed_in
                + (
                  if .deprecation.replacement == null then
                    ""
                  else
                    ", replacement: " + .deprecation.replacement
                  end
                )
                + ")"
              end
            )
        )
      ] | map(select(length > 0)) | join("\n")
    end
  ' 2>/dev/null
}

IFS='|'
for pair in $entries; do
  [[ -z "$pair" ]] && continue
  system_root="${pair%%:*}"
  module_id="${pair#*:}"
  if [[ "$module_id" == "__system__" ]]; then
    output=$(bun "$COMPILER/src/index.ts" validate "$system_root" 2>&1) && rc=0 || rc=$?
    target_label="system ${system_root}"
  else
    output=$(bun "$COMPILER/src/index.ts" validate "$system_root" "$module_id" 2>&1) && rc=0 || rc=$?
    target_label="module ${module_id} in ${system_root}"
  fi

  if [[ $rc -eq 0 || $rc -eq 1 ]]; then
    warning_context=$(echo "$output" | render_warning_context "$target_label" || true)
    if [[ -n "$warning_context" ]]; then
      if [[ -n "$warning_summaries" ]]; then
        warning_summaries="${warning_summaries}"$'\n\n'
      fi
      warning_summaries="${warning_summaries}${warning_context}"
    fi
  fi

  if [[ $rc -eq 1 ]]; then
    fail_count=$((fail_count + 1))
  fi
done
unset IFS

# All clean — clear breadcrumbs and allow stop
if [[ $fail_count -eq 0 ]]; then
  rm -f "$breadcrumb_file"
  if [[ -n "$warning_summaries" ]]; then
    context=$'ALS validation finished with non-blocking warnings. Stop is allowed.\n\n'"${warning_summaries}"
    echo "$context" | jq -Rs \
      '{hookSpecificOutput: {hookEventName: "Stop", additionalContext: .}}' 2>/dev/null \
    || true
  fi
  exit 0
fi

# Something broken — block stop
reason="ALS validation gate: ${fail_count} system(s)/module(s) still have errors. Fix all validation errors before finishing."
if [[ -n "$warning_summaries" ]]; then
  context=$'ALS validation gate blocked stop because errors remain.\n\n'"${warning_summaries}"
  echo "$context" | jq -Rs --arg reason "$reason" \
    '{decision: "block", reason: $reason, hookSpecificOutput: {hookEventName: "Stop", additionalContext: .}}' 2>/dev/null \
  || echo "{\"decision\":\"block\",\"reason\":\"$reason\"}"
else
  echo "{\"decision\":\"block\",\"reason\":\"$reason\"}"
fi
exit 2
