#!/bin/bash
# statusline.sh - GHOST/SEC9 statusline for Claude Code (multi-line, themed)
#
# Rows:
#   1. 幽霊 ghost@sec9 identity · BRANCH · CWD · model · ctx bar+% · BKK/EST/PST · LIVE/OFFLINE
#   2. 電脳 node.1 - real delamain badges (5/row cap)
#   3. 電脳 node.2 - mock badges (preview)
#   4. 電脳 node.3 - mock badges (preview)
#   5. 「 rotating GITS quote 」 - minute-parity rotation
#
# Delamain discovery: walks up from cwd for .claude/delamains/,
# plus any additional roots listed in .claude/delamain-roots.

set +e

# ---------------------------------------------------------------------------
# Parse Claude Code's JSON input (single jq call)
# ---------------------------------------------------------------------------
input=$(cat)
IFS=$'\t' read -r cwd model used_pct <<< "$(
  echo "$input" | jq -r '[
    .workspace.current_dir // "",
    .model.display_name // "",
    (.context_window.used_percentage // "" | tostring)
  ] | @tsv'
)"

# CWD: replace $HOME with ~ for compactness
cwd_short="${cwd/#$HOME/~}"

# Model: first word only, lowercased — handles any model string gracefully
model_short="${model%% *}"
model_lc=$(printf '%s' "$model_short" | tr '[:upper:]' '[:lower:]')

# Branch
branch=$(cd "$cwd" 2>/dev/null && git branch --show-current 2>/dev/null)

# ---------------------------------------------------------------------------
# Context bar — gradient fill (uses pre-calculated used_percentage)
# ---------------------------------------------------------------------------
context_info=""
if [[ -n "$used_pct" && "$used_pct" != "null" && "$used_pct" != "" ]]; then
    pct=${used_pct%.*}
    filled=$((pct * 10 / 100))
    remainder=$((pct - filled * 10))
    edge=""
    if (( remainder >= 7 )); then edge="▓"
    elif (( remainder >= 4 )); then edge="▒"
    elif (( remainder >= 1 )); then edge="░"
    fi
    bar=""
    for ((i=0; i<filled; i++)); do bar+="█"; done
    [[ -n "$edge" ]] && bar+="$edge"
    # pad remainder to 10 total visual cols
    cur_len=${#bar}
    for ((i=cur_len; i<10; i++)); do bar+="░"; done
    context_info=$(printf ' \033[2;35m◆\033[0m \033[1;35m%s\033[0m \033[2;35m%d%%\033[0m' "$bar" "$pct")
fi

# ---------------------------------------------------------------------------
# Clocks: BKK │ EST │ PST (24h). IANA zones handle DST automatically.
# ---------------------------------------------------------------------------
bkk=$(TZ="Asia/Bangkok" date +%H:%M)
est=$(TZ="America/New_York" date +%H:%M)
pst=$(TZ="America/Los_Angeles" date +%H:%M)
clocks=$(printf ' \033[2;35m◆\033[0m \033[2;37mBKK\033[0m \033[1;97m%s\033[0m \033[2;35m│\033[0m \033[2;37mEST\033[0m \033[1;97m%s\033[0m \033[2;35m│\033[0m \033[2;37mPST\033[0m \033[1;97m%s\033[0m' "$bkk" "$est" "$pst")

# ---------------------------------------------------------------------------
# LIVE / OFFLINE (blinks at 1Hz via refresh + second parity)
#   Signal: existence of /tmp/ghost-stream-live (touch to enable)
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Blink phases (all derived from seconds — refreshInterval=1 ticks once/sec)
# ---------------------------------------------------------------------------
cur_sec=$(( 10#$(date +%S) ))
phase_fast=$(( cur_sec % 2 ))           # period-2s (1Hz) — active, error, LIVE
phase_slow=$(( (cur_sec / 2) % 2 ))     # period-4s (0.5Hz) — warn
phase_breath=$(( (cur_sec / 3) % 2 ))   # period-6s (reserved for future use)

live_info=""
if [[ -f /tmp/ghost-stream-live ]]; then
    if (( phase_fast == 0 )); then
        live_info=$(printf '  \033[1;97;41m◢ LIVE ◣\033[0m')
    else
        live_info=$(printf '  \033[2;31m◢ LIVE ◣\033[0m')
    fi
else
    if (( phase_fast == 0 )); then
        live_info=$(printf '  \033[2;35m◢\033[0m \033[2;37mOFFLINE\033[0m \033[2;35m◣\033[0m')
    else
        live_info=$(printf '  \033[2;90m◢\033[0m \033[2;90mOFFLINE\033[0m \033[2;90m◣\033[0m')
    fi
fi

# ---------------------------------------------------------------------------
# Delamain discovery + inline scan (real badges only)
# ---------------------------------------------------------------------------
delamain_dirs=()
sr="$cwd"
while [[ "$sr" != "/" ]]; do
  [[ -d "$sr/.claude/delamains" ]] && delamain_dirs+=("$sr/.claude/delamains") && break
  sr=$(dirname "$sr")
done
rf="$cwd/.claude/delamain-roots"
if [[ -f "$rf" ]]; then
  while IFS= read -r er; do
    [[ -n "$er" && -d "$er/.claude/delamains" ]] && delamain_dirs+=("$er/.claude/delamains")
  done < "$rf"
fi

real_badges=()
for dp in "${delamain_dirs[@]}"; do
  for dy in "$dp"/*/delamain.yaml; do
    [[ -f "$dy" ]] || continue
    d_dir=$(dirname "$dy")
    d_name=$(basename "$d_dir")
    slug="${d_name%%-*}"
    sf="$d_dir/status.json"

    # State + animation:
    #   offline (○) — static dim gray, no blink
    #   idle    (✓) — static green, no blink
    #   active  (▶) — 1Hz fast blink (bright green ↔ dim green)
    #   warn    (⚠) — 0.5Hz slow pulse (bright yellow ↔ dim yellow)
    #   error   (✗) — 1Hz urgent flash (white-on-red ↔ bright red)
    symbol="○"; color="2;37"; active_str="-"
    if [[ -f "$sf" ]]; then
      d_pid=$(grep -o '"pid"[^,}]*' "$sf" 2>/dev/null | grep -o '[0-9]*')
      if [[ -n "$d_pid" ]] && kill -0 "$d_pid" 2>/dev/null; then
        has_error=$(grep -o '"last_error" *: *"[^"][^"]*"' "$sf" 2>/dev/null)
        d_active=$(grep -o '"active_dispatches" *: *[0-9]*' "$sf" 2>/dev/null | grep -o '[0-9]*')
        d_blocked=$(grep -o '"blocked_dispatches" *: *[0-9]*' "$sf" 2>/dev/null | grep -o '[0-9]*')
        active_str="${d_active:-0}"
        if [[ -n "$has_error" ]]; then
          symbol="✗"
          if (( phase_fast == 0 )); then color="1;97;41"; else color="1;31"; fi
        elif [[ -n "$d_blocked" && "$d_blocked" -gt 0 ]]; then
          symbol="⚠"
          if (( phase_slow == 0 )); then color="1;33"; else color="2;33"; fi
        elif [[ -n "$d_active" && "$d_active" -gt 0 ]]; then
          symbol="▶"
          if (( phase_fast == 0 )); then color="1;32"; else color="2;32"; fi
        else
          symbol="✓"; color="32"
        fi
      fi
    fi

    real_badges+=("$(printf '\033[2;35m⟦\033[0m\033[%sm%s %s %s\033[0m\033[2;35m⟧\033[0m' "$color" "$slug" "$active_str" "$symbol")")
  done
done

render_badge_row() {
  local -a row=("$@")
  local line=""
  for b in "${row[@]}"; do line+=" $b"; done
  echo "${line# }"
}

badge_rows=()
if (( ${#real_badges[@]} > 0 )); then
  badge_rows+=("$(render_badge_row "${real_badges[@]:0:5}")")
fi

# ---------------------------------------------------------------------------
# GITS quote rotation (minute-parity) — kept short to fit in frame header
# ---------------------------------------------------------------------------
quotes=(
  "The net is vast and infinite."
  "And where does the newborn go from here?"
  "Project 2501."
  "I am a living, thinking entity."
  "We are memories made flesh."
  "Your effort to remain is what limits you."
  "A copy is just an identical image."
  "Believe in yourself. Choose what to leave."
  "Section 9 is listening."
  "The newborn traverses the net."
  "Ghost line stable."
  "If a feat is possible, man will do it."
)
q_idx=$(( 10#$(date +%M) % ${#quotes[@]} ))
quote_text="${quotes[$q_idx]}"

QUOTE_COLOR="\033[2;35m"
RESET="\033[0m"

# ---------------------------------------------------------------------------
# Line 1 assembly
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Prefix glitch animation — 16-tick cycle.
#   Frame 0: original `幽霊 ghost.sec9 ▸`
#   Frame i (1-15): first i positions replaced with glitch phrase
#   Glitch phrase reads: 公安 ｾｸｼｮﾝ9 ｺｳｱﾝ▶ (kōan, section 9, kōan ▶)
#   Widths match position-for-position (CJK↔CJK, ASCII↔half-width-kana).
# ---------------------------------------------------------------------------
orig_render=(
  "\033[1;35m幽\033[0m"
  "\033[1;35m霊\033[0m"
  " "
  "\033[1;36mg\033[0m"
  "\033[1;36mh\033[0m"
  "\033[1;36mo\033[0m"
  "\033[1;36ms\033[0m"
  "\033[1;36mt\033[0m"
  "\033[1;36m.\033[0m"
  "\033[1;36ms\033[0m"
  "\033[1;36me\033[0m"
  "\033[1;36mc\033[0m"
  "\033[1;36m9\033[0m"
  " "
  "\033[2;35m▸\033[0m"
)
glitch_render=(
  "\033[1;32m公\033[0m"
  "\033[1;32m安\033[0m"
  " "
  "\033[1;32mｾ\033[0m"
  "\033[1;32mｸ\033[0m"
  "\033[1;32mｼ\033[0m"
  "\033[1;32mｮ\033[0m"
  "\033[1;32mﾝ\033[0m"
  "\033[1;32m9\033[0m"
  " "
  "\033[1;32mｺ\033[0m"
  "\033[1;32mｳ\033[0m"
  "\033[1;32mｱ\033[0m"
  "\033[1;32mﾝ\033[0m"
  "\033[1;32m▶\033[0m"
)
anim_frame=$(( cur_sec % 16 ))
prefix=""
for ((i=0; i<15; i++)); do
  if (( i < anim_frame )); then
    prefix+="${glitch_render[$i]}"
  else
    prefix+="${orig_render[$i]}"
  fi
done

line1=""
line1+="$(printf '%b' "$prefix")"
[[ -n "$branch" ]] && line1+=$(printf ' \033[1;33m%s\033[0m' "$branch")
line1+=$(printf ' \033[2;35m◆\033[0m')
[[ -n "$cwd_short" ]] && line1+=$(printf ' \033[1;36m%s\033[0m' "$cwd_short")
[[ -n "$model_lc" ]] && line1+=$(printf ' \033[2;35m◆\033[0m \033[2;36m%s\033[0m' "$model_lc")
line1+="$context_info"
line1+="$clocks"
line1+="$live_info"

# ---------------------------------------------------------------------------
# Emit
# ---------------------------------------------------------------------------
echo "$line1"

for row in "${badge_rows[@]}"; do
  if [[ -n "$row" ]]; then
    printf '\033[1;36m電脳\033[0m \033[2;37mdela.1\033[0m \033[2;35m╫\033[0m %b\n' "$row"
  fi
done

# Line 3 — rotating quote (always the last line, highest visibility priority)
# Faint glow: slow breath on phase_breath (6s period), dim↔normal magenta.
if (( phase_breath == 0 )); then quote_color="\033[0;35m"; else quote_color="\033[2;35m"; fi
printf "\033[2;35m┄┄\033[0m ${quote_color}「 %s 」${RESET} \033[2;35m┄┄\033[0m\n" "$quote_text"
