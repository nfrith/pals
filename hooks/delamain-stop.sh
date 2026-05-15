#!/bin/bash
# delamain-stop.sh — SessionEnd hook
# Kills running delamain dispatchers and cleans up heartbeat files.
# Only runs on real exits — skips clear and resume so dispatchers survive those.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

input=$(cat)
reason=$(echo "$input" | jq -r '.reason // "other"')
cwd=$(echo "$input" | jq -r '.cwd // empty')
session_id=$(echo "$input" | jq -r '.session_id // .sessionId // empty')

[[ -z "$cwd" ]] && exit 0

# Walk up from cwd to find system root
sys_root="$cwd"
while [[ "$sys_root" != "/" ]]; do
    [[ -f "$sys_root/.als/system.ts" ]] && break
    sys_root=$(dirname "$sys_root")
done

[[ ! -f "$sys_root/.als/system.ts" ]] && exit 0
[[ ! -d "$sys_root/.claude/delamains" ]] && exit 0

pulse_cache_dir="$sys_root/.claude/scripts/.cache/pulse"
mkdir -p "$pulse_cache_dir"
pulse_meta="$pulse_cache_dir/meta.json"
p_pid=""
if [[ -f "$pulse_meta" ]]; then
    p_pid=$(jq -r '.pid // empty' "$pulse_meta" 2>/dev/null)
fi

append_sessionend_log() {
    local action="$1"
    local pulse_signal_sent_json="$2"
    jq -cn \
        --arg timestamp "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
        --arg reason "$reason" \
        --arg session_id "$session_id" \
        --arg cwd "$cwd" \
        --arg sys_root "$sys_root" \
        --arg hook_pid "$$" \
        --argjson pulse_pid "${p_pid:-null}" \
        --argjson pulse_signal_sent "$pulse_signal_sent_json" \
        --arg action "$action" \
        '{
            timestamp: $timestamp,
            reason: $reason,
            session_id: (if $session_id == "" then null else $session_id end),
            cwd: $cwd,
            sys_root: $sys_root,
            hook_pid: ($hook_pid | tonumber),
            pulse_pid: $pulse_pid,
            pulse_signal_sent: $pulse_signal_sent,
            action: $action
        }' >> "$pulse_cache_dir/sessionend.log"
}

# Skip cleanup on clear and resume — dispatchers should keep running
case "$reason" in
    clear|resume)
        append_sessionend_log "skipped_clear_resume" "false"
        exit 0
        ;;
esac

bash "$SCRIPT_DIR/delamain-fleet.sh" cleanup --system-root "$sys_root" --caller session-end --quiet || true

# Reap PULSE (statusline background data producer, GF-034 Phase 2).
# Shares the same reason filter as dispatchers — already skipped clear|resume
# at the top of this hook, so we only get here on real SessionEnd.
log_action="pulse_meta_missing"
signal_sent="false"
if [[ -f "$pulse_meta" ]]; then
    if [[ -n "$p_pid" ]] && kill -0 "$p_pid" 2>/dev/null; then
        log_action="pulse_signal_sent"
        signal_sent="true"
    else
        log_action="pulse_not_running"
    fi
fi
append_sessionend_log "$log_action" "$signal_sent"
if [[ "$signal_sent" == "true" ]]; then
    kill "$p_pid" 2>/dev/null || true
fi
rm -f "$pulse_meta" \
      "$pulse_cache_dir/delamains.json" \
      "$pulse_cache_dir/live.json"
