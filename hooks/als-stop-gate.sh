#!/bin/bash
# Stop hook — final validation gate before Claude can finish its turn.
# Finds all ALS systems under $PWD, runs the compiler on each.
# If any system fails validation, blocks Claude from stopping.
set -euo pipefail

COMPILER="/Users/0xnfrith/nfrith/pals-v0/alsc/compiler"

# Bail if compiler isn't available
command -v bun &>/dev/null || exit 0
[[ -f "$COMPILER/src/index.ts" ]] || exit 0

# Find all ALS systems under the current working directory
systems=()
while IFS= read -r yaml; do
  systems+=("$(dirname "$(dirname "$yaml")")")
done < <(find "$PWD" -name "system.yaml" -path "*/.als/system.yaml" 2>/dev/null)

# No ALS systems? Nothing to gate.
[[ ${#systems[@]} -gt 0 ]] || exit 0

# Validate each system
failed=()
all_output=""
for system_root in "${systems[@]}"; do
  output=$(bun "$COMPILER/src/index.ts" "$system_root" 2>&1) && rc=0 || rc=$?
  if [[ $rc -eq 1 ]]; then
    failed+=("$system_root")
    all_output+="$output"
  fi
done

# All clean — allow stop
[[ ${#failed[@]} -gt 0 ]] || exit 0

# Systems broken — block stop
reason="ALS validation gate: ${#failed[@]} system(s) still have errors. Fix all validation errors before finishing."
echo "{\"decision\":\"block\",\"reason\":\"$reason\"}"
exit 2
