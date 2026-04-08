#!/bin/bash
# reset.sh — One-shot reset of the reference-system demo
#
# Kills all demo processes, removes fabricated items, restores agent files,
# removes delamain-roots, and restores the operator's original statusline.
# Designed to run as a single tool call from /reset-demo.
#
# Usage: bash reset.sh <system-root> <project-root>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SR="${1:-$SCRIPT_DIR/../../reference-system}"
PROJECT="${2:-$(pwd)}"

echo "[reset-demo] system root: $SR"
echo "[reset-demo] project root: $PROJECT"

# --- 1. Kill all demo processes ---

# Daemon
daemon_pid=$(cat "$PROJECT/.claude/scripts/.cache/daemon.pid" 2>/dev/null || true)
[[ -n "$daemon_pid" ]] && kill "$daemon_pid" 2>/dev/null && rm -f "$PROJECT/.claude/scripts/.cache/daemon.pid" && echo "[reset-demo] daemon killed (PID $daemon_pid)"

# Agent SDK children first (they do the actual writes)
sdk_pids=$(ps aux | grep "claude-agent-sdk/cli.js" | grep -v grep | awk '{print $2}' || true)
[[ -n "$sdk_pids" ]] && echo "$sdk_pids" | xargs kill -9 2>/dev/null

# Dispatchers via status.json
for sf in "$SR"/.claude/delamains/*/status.json; do
  [[ -f "$sf" ]] || continue
  pid=$(jq -r '.pid // empty' "$sf" 2>/dev/null)
  [[ -n "$pid" ]] && kill -9 "$pid" 2>/dev/null
  rm -f "$sf"
done

# Remaining bun processes
bun_pids=$(ps aux | grep "bun run src/index.ts" | grep -v grep | awk '{print $2}' || true)
[[ -n "$bun_pids" ]] && echo "$bun_pids" | xargs kill -9 2>/dev/null

# Statusline daemon (grep fallback)
daemon_pids=$(ps aux | grep "statusline-daemon" | grep -v grep | awk '{print $2}' || true)
[[ -n "$daemon_pids" ]] && echo "$daemon_pids" | xargs kill -9 2>/dev/null

# Wait and sweep survivors
sleep 2
survivor_pids=$(ps aux | grep -E "(claude-agent-sdk/cli.js|bun run src/index.ts)" | grep -v grep | awk '{print $2}' || true)
[[ -n "$survivor_pids" ]] && echo "$survivor_pids" | xargs kill -9 2>/dev/null

proc_count=$( (echo "$sdk_pids"; echo "$bun_pids"; echo "$daemon_pids"; echo "$survivor_pids") | grep -c . 2>/dev/null || echo 0)
echo "[reset-demo] killed $proc_count processes"

# --- 2. Remove fabricated items ---
cd "$SR"
removed=$(git clean -f \
  workspace/factory/items/ \
  workspace/incident-response/reports/ \
  workspace/experiments/ \
  operations/postmortems/ \
  infra/ 2>/dev/null | wc -l | tr -d ' ')
echo "[reset-demo] removed $removed fabricated items"

# --- 3. Restore modified records and agent files ---
git checkout -- \
  .claude/delamains/*/agents/ \
  .claude/delamains/*/sub-agents/ \
  workspace/factory/items/ \
  workspace/incident-response/reports/ \
  workspace/experiments/ \
  operations/postmortems/ \
  infra/ 2>/dev/null
echo "[reset-demo] restored agent files and records"

# --- 4. Remove delamain roots ---
rm -f "$PROJECT/.claude/delamain-roots"
echo "[reset-demo] removed delamain-roots"

# --- 5. Restore statusline ---
backup=$(ls -t "$PROJECT/.claude/scripts/statusline.sh.backup-"* 2>/dev/null | head -1 || true)
if [[ -n "$backup" ]]; then
  mv "$backup" "$PROJECT/.claude/scripts/statusline.sh"
  echo "[reset-demo] restored statusline from $(basename "$backup")"
fi
# Clean remaining backups
rm -f "$PROJECT/.claude/scripts/statusline.sh.backup-"* 2>/dev/null

# --- 6. Clean demo logs ---
rm -f /tmp/als-demo-logs/*.log 2>/dev/null

echo "[reset-demo] done — ready for fresh /run-demo"
