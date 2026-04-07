#!/usr/bin/env bash
# Inject demo-mode override into delamain agent files.
# Replaces the entire agent body with a minimal demo instruction and
# swaps the model to haiku. Haiku only sees the demo instruction +
# the runtime context injected by the dispatcher.
# Skips the first agent-owned state per delamain so items enter
# the pipeline instantly.
# Restored by /reset-demo via `git checkout`.

set -euo pipefail

SYSTEM_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DELAMAINS_DIR="$SYSTEM_ROOT/.claude/delamains"

DEMO_BODY='Run `sleep 5` via Bash, then read the item file. Pick the `advance` transition from legal_transitions in your Runtime Context. Update the status field to its target, set `updated` to today'\''s date, and append an ACTIVITY_LOG entry. That is all.'

# Build list of first agent-owned state files to skip (one per delamain)
SKIP_LIST=""
for delamain_yaml in "$DELAMAINS_DIR"/*/delamain.yaml; do
  delamain_dir="$(dirname "$delamain_yaml")"
  first_path=$(grep -A2 'actor: agent' "$delamain_yaml" | grep 'path:' | head -1 | awk '{print $2}')
  if [ -n "$first_path" ]; then
    SKIP_LIST="$SKIP_LIST|$delamain_dir/$first_path"
  fi
done

count=0
skipped=0
for agent_file in "$DELAMAINS_DIR"/*/agents/*.md "$DELAMAINS_DIR"/*/sub-agents/*.md; do
  [ -f "$agent_file" ] || continue

  # Skip first agent-owned state (items should enter the pipeline instantly)
  if echo "$SKIP_LIST" | grep -qF "$agent_file"; then
    skipped=$((skipped + 1))
    continue
  fi

  # Skip if already injected
  if grep -q "DEMO MODE" "$agent_file" 2>/dev/null; then
    continue
  fi

  # Keep frontmatter, swap model to haiku, replace body with demo instruction
  awk -v body="$DEMO_BODY" '
    BEGIN { fences=0; done=0 }
    /^---$/ {
      fences++
      print
      if (fences == 2) {
        print ""
        print body
        done = 1
      }
      next
    }
    fences < 2 {
      # Inside frontmatter — swap model
      if ($0 ~ /^model:/) { print "model: haiku"; next }
      print
      next
    }
    # After frontmatter — skip original body
  ' "$agent_file" > "$agent_file.tmp" && mv "$agent_file.tmp" "$agent_file"

  count=$((count + 1))
done

echo "[run-demo] injected demo-mode override into $count agent file(s), skipped $skipped initial state agent(s)"
