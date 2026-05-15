#!/bin/bash
# statusline-daemon.sh - Background data collector for the ALS statusline
#
# Runs as a long-lived background process. Collects delamain badge state,
# git branch, and OBS status every 3 seconds, writing to cache files that
# statusline.sh reads. This decouples expensive scanning from the render
# path, making statusline.sh a pure reader (~5ms execution).
#
# Usage:
#   bash statusline-daemon.sh /path/to/project &
#
# The daemon writes its PID to .cache/daemon.pid for local cleanup/diagnostics.
# Kill it with: kill $(cat .cache/daemon.pid)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CACHE_DIR="$SCRIPT_DIR/.cache"
CWD="${1:-.}"

mkdir -p "$CACHE_DIR"
echo $$ > "$CACHE_DIR/daemon.pid"

cleanup() {
  rm -f "$CACHE_DIR/daemon.pid"
  exit 0
}
trap cleanup TERM INT HUP

while true; do

  # -------------------------------------------------------------------------
  # Delamain badges
  # -------------------------------------------------------------------------
  delamain_dirs=()
  sr="$CWD"
  while [[ "$sr" != "/" ]]; do
    [[ -d "$sr/.claude/delamains" ]] && delamain_dirs+=("$sr/.claude/delamains") && break
    sr=$(dirname "$sr")
  done

  if [[ -f "$CACHE_DIR/test-mode" ]]; then
    # Test mode: mock badges from test-mode file
    badges=""
    widths=""
    while IFS='|' read -r name state; do
      [[ -z "$name" ]] && continue
      case "$state" in
        active)  symbol="⚡"; color="1;32" ;;
        idle)    symbol="✓"; color="32" ;;
        error)   symbol="✗"; color="1;31" ;;
        *)       symbol="○"; color="2;37" ;;
      esac
      badges+="$(printf '\033[%sm[%s %s]\033[0m' "$color" "$name" "$symbol")|"
      widths+="$(( ${#name} + 4 ))|"
    done < "$CACHE_DIR/test-mode"
    echo -n "$badges" > "$CACHE_DIR/badges.tmp" && mv "$CACHE_DIR/badges.tmp" "$CACHE_DIR/badges"
    echo -n "$widths" > "$CACHE_DIR/badges-w.tmp" && mv "$CACHE_DIR/badges-w.tmp" "$CACHE_DIR/badges-w"
  else
    badges=""
    widths=""
    for dp in "${delamain_dirs[@]}"; do
      for dy in "$dp"/*/delamain.yaml; do
        [[ -f "$dy" ]] || continue
        d_dir=$(dirname "$dy")
        d_name=$(basename "$d_dir")
        sf="$d_dir/status.json"

        symbol="○"; color="2;37"
        if [[ -f "$sf" ]]; then
          IFS=$'\t' read -r d_pid d_active d_error < <(
            jq -r '[.pid // "", (.active_dispatches // 0 | tostring), .last_error // ""] | @tsv' "$sf" 2>/dev/null
          )
          if [[ -n "$d_pid" ]] && kill -0 "$d_pid" 2>/dev/null; then
            if [[ -n "$d_error" ]]; then
              symbol="✗"; color="1;31"
            elif (( d_active > 0 )); then
              symbol="⚡"; color="1;32"
            else
              symbol="✓"; color="32"
            fi
          fi
        fi

        badges+="$(printf '\033[%sm[%s %s]\033[0m' "$color" "$d_name" "$symbol")|"
        widths+="$(( ${#d_name} + 4 ))|"
      done
    done
    echo -n "$badges" > "$CACHE_DIR/badges.tmp" && mv "$CACHE_DIR/badges.tmp" "$CACHE_DIR/badges"
    echo -n "$widths" > "$CACHE_DIR/badges-w.tmp" && mv "$CACHE_DIR/badges-w.tmp" "$CACHE_DIR/badges-w"
  fi

  # -------------------------------------------------------------------------
  # Git branch
  # -------------------------------------------------------------------------
  branch=$(cd "$CWD" 2>/dev/null && git branch --show-current 2>/dev/null)
  echo "$branch" > "$CACHE_DIR/git-branch.tmp" && mv "$CACHE_DIR/git-branch.tmp" "$CACHE_DIR/git-branch"

  # -------------------------------------------------------------------------
  # OBS status → simple state string (no JSON parsing needed by statusline)
  # -------------------------------------------------------------------------
  obs_script="$SCRIPT_DIR/obs-status.py"
  obs_state=""
  if [[ -f "$obs_script" ]]; then
    obs_json=$(python3 "$obs_script" 2>/dev/null || echo '{}')
    obs_streaming=$(echo "$obs_json" | jq -r '.streaming' 2>/dev/null)
    obs_recording=$(echo "$obs_json" | jq -r '.recording' 2>/dev/null)
    if [[ "$obs_streaming" == "true" ]]; then
      obs_state="streaming"
    elif [[ "$obs_recording" == "true" ]]; then
      obs_state="recording"
    fi
  fi
  # Test mode: always show streaming
  [[ -f "$CACHE_DIR/test-mode" ]] && obs_state="streaming"
  echo "$obs_state" > "$CACHE_DIR/obs-state.tmp" && mv "$CACHE_DIR/obs-state.tmp" "$CACHE_DIR/obs-state"

  sleep 3
done
