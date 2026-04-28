---
name: update
description: Update the installed ALS plugin to the latest version published in the marketplace. Detects whether the operator is on Claude Code CLI or Claude Code Desktop and walks them through the right path. Necessary on Desktop because the platform's GUI update-detection is unreliable as of 2026-04-28 — this skill works around that gap using only documented `claude plugin` subcommands.
allowed-tools: AskUserQuestion, Bash, Read
---

# update

Move the installed ALS plugin from whatever version the operator is currently on to whatever is published as the latest in the `als-marketplace` catalog. The skill is platform-aware: on [`ALS-PLAT-CCLI`](../docs/references/platforms.md) it does the work directly; on [`ALS-PLAT-CDSK`](../docs/references/platforms.md) it refreshes the marketplace clone and walks the operator through a GUI step that finishes the job.

## Phase 1: Detect platform

Read the runtime identifier:

```bash
echo "ENTRYPOINT=${CLAUDE_CODE_ENTRYPOINT:-unknown}"
```

Map to a platform code per [`platforms.md`](../docs/references/platforms.md):

| Entrypoint | Platform code |
|------------|---------------|
| `cli` | [`ALS-PLAT-CCLI`](../docs/references/platforms.md) |
| `claude-desktop` | [`ALS-PLAT-CDSK`](../docs/references/platforms.md) |

If the entrypoint is anything else (`remote`, unknown, missing): tell the operator this skill currently supports only CLI and Desktop, then stop. The operator can fall back to manual steps from the platform's own update UI.

## Phase 2: Read current installed version

```bash
jq -r '.plugins["als@als-marketplace"][0].version' ~/.claude/plugins/installed_plugins.json
```

Capture the value. Report it: `"Currently installed: <version>"`. If `als@als-marketplace` is not present at all, tell the operator ALS isn't installed yet and they should run `/install` instead.

## Phase 3: Refresh the marketplace clone

This pulls the latest `marketplace.json` and plugin source from origin into the local marketplace clone at `~/.claude/plugins/marketplaces/als-marketplace/`. It does not touch the cached install yet.

```bash
claude plugin marketplace update als-marketplace 2>&1
```

If the command fails, surface the error and stop — the operator likely has a network or auth problem we can't fix from inside a skill.

After success, read the version that the refreshed catalog declares:

```bash
jq -r '.plugins[0].version' ~/.claude/plugins/marketplaces/als-marketplace/.claude-plugin/marketplace.json
jq -r '.version' ~/.claude/plugins/marketplaces/als-marketplace/.claude-plugin/plugin.json
```

The plugin.json value wins per the resolution waterfall. Report: `"Latest available: <version>"`.

If the latest version equals the currently-installed version, tell the operator they're already on the newest published release and stop.

## Phase 4a: Apply the update on [`ALS-PLAT-CCLI`](../docs/references/platforms.md)

```bash
claude plugin update als@als-marketplace 2>&1
```

After success, tell the operator:

> Update applied. Restart this Claude Code session (or open a new one) for hooks, agents, and the new skill set to take effect.

Then proceed to Phase 5.

## Phase 4b: Apply the update on [`ALS-PLAT-CDSK`](../docs/references/platforms.md)

Claude Code Desktop's GUI update detection does not reliably notice when the marketplace clone has been refreshed. The operator has to take a manual step. Try the cleanest path first.

### 4b.1: Ask whether the Update button is now active

Use AskUserQuestion:

- **Header**: Update button check
- **Question**: "I've just refreshed the ALS marketplace. Open Customize → ALS in Claude Code Desktop. Is the Update button active (clickable, not greyed out and showing 'On latest version')?"
- **Options**:
  1. **Active** — `Yes, the Update button is clickable. I can press it.`
  2. **Greyed** — `No, still greyed out / "On latest version".`

### 4b.2: If active

Tell the operator:

> Click the Update button. When it finishes, the Version row should show <latest version>. Confirm and we'll verify together.

Wait for confirmation, then proceed to Phase 5.

### 4b.3: If greyed out

Desktop did not pick up the marketplace refresh. Fall back to uninstall + reinstall — Desktop's reinstall pulls from the now-fresh marketplace clone, so the new version lands.

Tell the operator, step by step:

1. Customize → Plugins → ALS → Uninstall (or click the toggle off, then the trash/uninstall option in the menu)
2. Customize → Add plugin → choose `als-marketplace` → click Install on ALS
3. Confirm ALS reappears in Personal plugins

After the operator confirms the reinstall, proceed to Phase 5.

## Phase 5: Verify

```bash
jq -r '.plugins["als@als-marketplace"][0].version' ~/.claude/plugins/installed_plugins.json
```

If the version matches what was reported as "Latest available" in Phase 3, tell the operator the update succeeded.

If it doesn't match, tell the operator what version is installed vs what was expected, and that they may need to fully restart Claude Code Desktop and try again — or report back so we can investigate what's pinning them.

## Phase 6: Final report

Briefly tell the operator:

- Old version → New version
- Platform path used (CLI direct, Desktop via Update button, Desktop via uninstall+reinstall)
- That a session restart finishes propagating hook changes (especially on Desktop)

## Why this skill exists

As of 2026-04-28 the empirical findings (`als-factory/docs/plugin-system-empirical-findings.md`) confirm that Claude Code Desktop has no GUI-only path to receive plugin updates. `autoUpdate: true` does not fire on restart, the Update button stays greyed out even when newer versions are pushed, and full uninstall + reinstall reuses the stale on-disk marketplace clone. The only working refresh primitive is `claude plugin marketplace update <name>` from a terminal. This skill packages that primitive into an in-session flow so the operator never has to touch a terminal — they invoke `/update`, Claude runs the refresh, and Claude guides them through the smallest GUI step that completes the swap.

When Anthropic fixes Desktop's update detection, this skill becomes a thin wrapper around `claude plugin update`. Until then, it is the supported edgerunner update path.
