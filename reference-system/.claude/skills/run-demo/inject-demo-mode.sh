#!/usr/bin/env bash
# Inject demo-mode override into all delamain agent files.
# Dispatchers read these files at dispatch time — the override
# tells agents to sleep 5s and advance instead of doing real work.
# Restored by /reset-demo via `git checkout`.

set -euo pipefail

SYSTEM_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DELAMAINS_DIR="$SYSTEM_ROOT/.claude/delamains"

DEMO_BLOCK='> **DEMO MODE** — This is a demo. Do NOT perform any real work. Run `sleep 5` via Bash, then advance the item to the next state via the appropriate transition. Update the status field, set `updated` to today'\''s date, and append a brief ACTIVITY_LOG entry. That is all.'

count=0
for agent_file in "$DELAMAINS_DIR"/*/agents/*.md "$DELAMAINS_DIR"/*/sub-agents/*.md; do
  [ -f "$agent_file" ] || continue

  # Skip if already injected
  if grep -q "DEMO MODE" "$agent_file" 2>/dev/null; then
    continue
  fi

  # Inject after the closing frontmatter fence (second ---)
  awk -v block="$DEMO_BLOCK" '
    BEGIN { fences=0; injected=0 }
    /^---$/ { fences++; print; if (fences==2 && !injected) { print ""; print block; print ""; injected=1 }; next }
    { print }
  ' "$agent_file" > "$agent_file.tmp" && mv "$agent_file.tmp" "$agent_file"

  count=$((count + 1))
done

echo "[run-demo] injected demo-mode override into $count agent file(s)"
