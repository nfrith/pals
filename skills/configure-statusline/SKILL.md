---
name: configure-statusline
description: Install the ALS statusline into the operator's project. Shows delamain health badges, context usage, git branch, clock, and OBS streaming indicator.
allowed-tools: AskUserQuestion, Bash(bash *), Read, Write, Edit
---

# configure-statusline

Install the ALS statusline into the operator's project settings. The statusline is critical for operating delamains — without it, the operator has no visibility into what's running.

## Procedure

### 1. Resolve runtime support

Initialize runtime variables:

```bash
bash {skill-dir}/../lib/runtime-env.sh
```

Extract `ALS_PLUGIN_ROOT`, `HARNESS`, and `STATUSLINE_SUPPORTED` from the output. If the output is `NO_SYSTEM`, tell the operator: "This project isn't an ALS system yet. Run `/install` first to bootstrap." Stop.

If `STATUSLINE_SUPPORTED` is not `yes`, tell the operator: "The ALS statusline is not supported for the active harness (`${HARNESS}`)." Stop. Do not install `.claude/scripts` launchers from a non-Claude harness.

### 2. Ask for permission

Use AskUserQuestion to ask the operator:

**Question:** "Install the ALS statusline? It replaces your current statusline with one that shows delamain health badges, context usage, git branch, clock, and OBS streaming status. This is essential for operating delamains — without it you can't tell what's happening."

**Options:**
- "Yes, install it" — Install the statusline
- "No, keep current" — Skip installation

If the operator says no, acknowledge and stop.

### 3. Backup existing statusline

Before installing, check if the operator already has a statusline configured. If `.claude/scripts/statusline.sh` exists, back it up with a timestamp:

```bash
if [[ -f .claude/scripts/statusline.sh ]]; then
  backup=".claude/scripts/statusline.sh.backup-$(date +%Y%m%d-%H%M%S)"
  cp .claude/scripts/statusline.sh "$backup"
fi
```

If a backup was created, tell the operator: "Backed up your existing statusline to `{backup path}`."

### 4. Install statusline scripts

Copy the statusline scripts from the ALS plugin into the operator's project:

```bash
mkdir -p .claude/scripts
cp ${ALS_PLUGIN_ROOT}/statusline/statusline.sh .claude/scripts/statusline.sh
cp ${ALS_PLUGIN_ROOT}/statusline/statusline-daemon.sh .claude/scripts/statusline-daemon.sh
cp ${ALS_PLUGIN_ROOT}/statusline/obs-status.py .claude/scripts/obs-status.py
chmod +x .claude/scripts/statusline.sh .claude/scripts/statusline-daemon.sh
```

### 5. Wire up settings.json

Read the existing `.claude/settings.json` (or create it if missing). Set the `statusLine` key:

```json
{
  "statusLine": {
    "type": "command",
    "command": ".claude/scripts/statusline.sh"
  }
}
```

Merge this into the existing settings — do not overwrite other keys.

### 6. Report

Tell the operator:
- Statusline installed at `.claude/scripts/statusline.sh`
- They may need to restart their Claude session for it to take effect
- Delamain badges will appear automatically when dispatchers are running
