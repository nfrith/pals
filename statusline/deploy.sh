#!/bin/bash
# deploy.sh — Package and deploy ALS statusline to a target project
#
# Usage:
#   ./deploy.sh <target-claude-dir>
#
# Example:
#   ./deploy.sh /Users/me/my-project/.claude
#   ./deploy.sh ~/.claude
#
# What it does:
#   1. Copies statusline.sh + obs-status.py to <target>/.claude/scripts/
#   2. Updates <target>/.claude/settings.json with statusLine config
#   3. Clears statusline caches so the new version takes effect immediately

set -euo pipefail

STATUSLINE_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:?Usage: deploy.sh <target-claude-dir>}"

# Normalize: if they passed the project root, append .claude
if [[ "$(basename "$TARGET")" != ".claude" ]]; then
    TARGET="$TARGET/.claude"
fi

# Verify target looks right
if [[ ! -d "$(dirname "$TARGET")" ]]; then
    echo "ERROR: parent directory $(dirname "$TARGET") does not exist" >&2
    exit 1
fi

echo "[deploy] target: $TARGET"

# 1. Copy statusline files
mkdir -p "$TARGET/scripts"
cp "$STATUSLINE_DIR/statusline.sh" "$TARGET/scripts/statusline.sh"
cp "$STATUSLINE_DIR/obs-status.py" "$TARGET/scripts/obs-status.py"
chmod +x "$TARGET/scripts/statusline.sh"
echo "[deploy] copied statusline.sh + obs-status.py to $TARGET/scripts/"

# 2. Update settings.json
SETTINGS="$TARGET/settings.json"
if [[ -f "$SETTINGS" ]]; then
    # Merge statusLine key into existing settings
    tmp=$(mktemp)
    jq '. + {"statusLine": {"type": "command", "command": ".claude/scripts/statusline.sh"}}' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
    echo "[deploy] updated statusLine in $SETTINGS"
else
    # Create minimal settings.json
    cat > "$SETTINGS" << 'SETTINGS_EOF'
{
  "statusLine": {
    "type": "command",
    "command": ".claude/scripts/statusline.sh"
  }
}
SETTINGS_EOF
    echo "[deploy] created $SETTINGS with statusLine config"
fi

# 3. Clear caches
rm -rf "$TARGET/scripts/.cache" 2>/dev/null
echo "[deploy] cleared statusline caches"

echo "[deploy] done — restart Claude session for changes to take effect"
