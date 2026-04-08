#!/bin/bash
# test.sh — UAT test for the ALS statusline
#
# Usage:
#   ./test.sh <target-claude-dir>
#
# What it does:
#   1. Deploys the statusline to the target
#   2. Activates test mode with mock delamain data
#   3. Waits for operator feedback
#   4. Cleans up test mode on exit
#
# The mock data simulates 8 delamains in various states so the operator
# can verify rendering, wrapping, and badge colors without running
# real dispatchers.

set -euo pipefail

STATUSLINE_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:?Usage: test.sh <target-claude-dir>}"

# Normalize
if [[ "$(basename "$TARGET")" != ".claude" ]]; then
    TARGET="$TARGET/.claude"
fi

# 1. Deploy
echo "[test] deploying statusline..."
bash "$STATUSLINE_DIR/deploy.sh" "$TARGET"

# 2. Write mock delamain data (name|state per line)
cat > $TARGET/scripts/.cache/test-mode << 'MOCK'
development-pipeline|active
incident-lifecycle|active
postmortem-lifecycle|idle
release-lifecycle|active
run-lifecycle|idle
decisions|off
protocols|error
planning|active
MOCK

# 3. Write mock OBS status (streaming live)
echo '{"streaming":true,"recording":false,"connected":true}' > "$TARGET/scripts/.cache/obs"

# Clear badge cache so mock takes effect immediately
rm -f $TARGET/scripts/.cache/badges $TARGET/scripts/.cache/badges-w 2>/dev/null

echo "[test] test mode activated with 8 mock delamains + LIVE indicator"
echo "[test] restart or interact with Claude Code to see the statusline"
echo ""
echo "  Mock delamains:"
echo "    development-pipeline  ⚡ active"
echo "    incident-lifecycle    ⚡ active"
echo "    postmortem-lifecycle  ✓ idle"
echo "    release-lifecycle     ⚡ active"
echo "    run-lifecycle         ✓ idle"
echo "    decisions             ○ off"
echo "    protocols             ✗ error"
echo "    planning              ⚡ active"
echo ""
echo "[test] press Enter to clean up test mode, or Ctrl+C to leave it active"
read -r

# 4. Cleanup
rm -f $TARGET/scripts/.cache/test-mode $TARGET/scripts/.cache/badges $TARGET/scripts/.cache/badges-w $TARGET/scripts/.cache/obs 2>/dev/null
echo "[test] test mode deactivated"
