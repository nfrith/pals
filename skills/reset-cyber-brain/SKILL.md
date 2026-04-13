---
name: reset-cyber-brain
description: Reset the cyber-brain's persistent session. Clears conversation history so the next wake starts fresh with the full prompt instead of resuming.
allowed-tools: Bash(bash *)
---

# reset-cyber-brain

Wipe the cyber-brain's persistent session so the next wake starts fresh.

## What it does

The cyber-brain holds a single Agent SDK session that resumes across wakes — it remembers everything from prior conversations. This skill clears that session, forcing a full reboot with the base prompt on the next wake.

The brain's poll loop stays running. The next time it wakes (on new mail or restart), it starts a brand new conversation instead of resuming.

## Procedure

```bash
SESSION_FILE="${CLAUDE_PLUGIN_ROOT}/../../ghost-factory/constructs/cyber-brain/session.json"

# Try direct path first, fall back to search
if [ ! -f "$SESSION_FILE" ]; then
  SESSION_FILE="$(find ~/worktrees/main/ghost-factory/constructs/cyber-brain -name session.json -maxdepth 1 2>/dev/null | head -1)"
fi

if [ -f "$SESSION_FILE" ]; then
  # Read current state before clearing
  WAKE_COUNT=$(cat "$SESSION_FILE" 2>/dev/null | jq -r '.wakeCount // "unknown"' 2>/dev/null)
  SESSION_ID=$(cat "$SESSION_FILE" 2>/dev/null | jq -r '.sessionId // "unknown"' 2>/dev/null)

  # Clear the session
  echo -n "" > "$SESSION_FILE"

  echo "Session cleared."
  echo "  Previous session: ${SESSION_ID:0:12}..."
  echo "  Wakes completed: $WAKE_COUNT"
  echo "  Next wake will do a full boot with base prompt."
else
  echo "No session file found. Brain may not have booted yet."
fi
```

Say only the output.

## Notes

- Safe to run while the brain is running — the poll loop picks up the change live.
- The brain does NOT restart. It keeps polling. The next `runBrain()` call sees no session and does a fresh boot.
- Mail in the inbox is preserved — the brain will process it on the fresh wake.
- Use this when the brain's conversation context has drifted, accumulated stale state, or needs a clean slate.
