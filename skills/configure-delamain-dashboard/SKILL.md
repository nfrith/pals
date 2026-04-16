---
name: configure-delamain-dashboard
description: Install Delamain dashboard launchers into the operator's project so they can start the localhost dashboard service and the paired OpenTUI client.
allowed-tools: AskUserQuestion, Bash(bash *), Read, Write, Edit
---

# configure-delamain-dashboard

Install the Delamain dashboard launchers into the operator's project. The dashboard is the canonical monitoring surface for Delamain runtime activity; the statusline remains the compact badge layer.

## Procedure

### 1. Ask for permission

Use AskUserQuestion to ask the operator:

**Question:** "Install the Delamain dashboard launchers? This adds `.claude/scripts/delamain-dashboard-service.sh` for the localhost web service and `.claude/scripts/delamain-dashboard-tui.sh` for the matching terminal client."

**Options:**
- "Yes, install it" — Install the launchers
- "No, skip it" — Leave the project unchanged

If the operator says no, acknowledge and stop.

### 2. Resolve the ALS repo root

Determine the absolute ALS plugin root from `CLAUDE_PLUGIN_ROOT`. The dashboard app lives at:

```bash
dashboard_root="$CLAUDE_PLUGIN_ROOT/delamain-dashboard"
```

If `CLAUDE_PLUGIN_ROOT` is missing, stop and tell the operator you cannot install the launchers without the ALS plugin root.

### 3. Backup existing launchers

If either launcher already exists, back it up before replacing it:

```bash
mkdir -p .claude/scripts
timestamp="$(date +%Y%m%d-%H%M%S)"
for script in .claude/scripts/delamain-dashboard-service.sh .claude/scripts/delamain-dashboard-tui.sh; do
  if [[ -f "$script" ]]; then
    cp "$script" "$script.backup-$timestamp"
  fi
done
```

### 4. Install project-local launchers

Write `.claude/scripts/delamain-dashboard-service.sh`:

```bash
#!/bin/bash
set -euo pipefail

APP_DIR="__ALS_DASHBOARD_ROOT__"
SYSTEM_ROOT="${1:-$(pwd)}"

cd "$APP_DIR"
bun run src/index.ts service --system-root "$SYSTEM_ROOT" "${@:2}"
```

Write `.claude/scripts/delamain-dashboard-tui.sh`:

```bash
#!/bin/bash
set -euo pipefail

APP_DIR="__ALS_DASHBOARD_ROOT__"
SERVICE_URL="${DELAMAIN_DASHBOARD_URL:-${1:-http://127.0.0.1:4646}}"

cd "$APP_DIR"
bun run src/index.ts tui --service-url "$SERVICE_URL" "${@:2}"
```

Replace `__ALS_DASHBOARD_ROOT__` with the resolved absolute `dashboard_root`, then mark both scripts executable.

### 5. Report

Tell the operator:

- The launchers were installed at `.claude/scripts/delamain-dashboard-service.sh` and `.claude/scripts/delamain-dashboard-tui.sh`
- `bun install` must be run once inside the dashboard app directory if dependencies are not installed yet
- The service prints the localhost web URL when it starts
- The TUI launcher expects the service to already be running
