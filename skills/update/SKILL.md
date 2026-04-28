---
name: update
description: Update the installed ALS plugin to the latest version published in the marketplace. Refreshes the marketplace clone, then shells out to `claude plugin update als@als-marketplace` — the same CLI primitive the operator would invoke manually. Works for both Claude Code CLI and Claude Code Desktop installs (project or user scope).
allowed-tools: AskUserQuestion, Bash, Read
---

# update

Move the installed ALS plugin from whatever version the operator is currently on to whatever is published as the latest in the `als-marketplace` catalog. The skill is platform-agnostic: it refreshes the marketplace clone, then runs `claude plugin update als@als-marketplace`. That command is the documented universal update primitive — it works the same way across CLI and Desktop, project and user scope.

## Phase 1: Detect platform (informational)

Read the runtime identifier:

```bash
echo "ENTRYPOINT=${CLAUDE_CODE_ENTRYPOINT:-unknown}"
```

Map to a platform code per [`platforms.md`](../docs/references/platforms.md):

| Entrypoint | Platform code |
|------------|---------------|
| `cli` | [`ALS-PLAT-CCLI`](../docs/references/platforms.md) |
| `claude-desktop` | [`ALS-PLAT-CDSK`](../docs/references/platforms.md) |

Report the platform to the operator. The flow is the same regardless, but knowing where we are helps explain what they should expect (e.g., a session restart is required on Desktop for hooks/skills to reload).

## Phase 2: Read current installed version

```bash
jq -r '.plugins["als@als-marketplace"][0].version' ~/.claude/plugins/installed_plugins.json
```

The first entry is read regardless of `scope` — both `user` and `project` scope installs are tracked in this file. Capture the value. Report it: `"Currently installed: <version>"`. If `als@als-marketplace` is not present at all, tell the operator ALS isn't installed yet and they should run `/install` instead.

## Phase 3: Refresh the marketplace clone

This pulls the latest `marketplace.json` and plugin source from origin into the local marketplace clone at `~/.claude/plugins/marketplaces/als-marketplace/`. It does not touch the cached install yet.

```bash
claude plugin marketplace update als-marketplace 2>&1
```

If the command fails, surface the error and stop — the operator likely has a network or auth problem we can't fix from inside a skill.

After success, read the version that the refreshed catalog declares:

```bash
jq -r '.version' ~/.claude/plugins/marketplaces/als-marketplace/.claude-plugin/plugin.json
```

Per the version-resolution waterfall, `plugin.json` wins. Report: `"Latest available: <version>"`.

If the latest version equals the currently-installed version, tell the operator they're already on the newest published release and stop.

## Phase 4: Apply the update

Shell out to the universal CLI primitive:

```bash
claude plugin update als@als-marketplace 2>&1
```

This works regardless of platform or scope. On Desktop, the Bash subprocess inherits cwd from the running Claude Code session, so project-scope installs are picked up automatically.

Surface the command's output to the operator. If the command fails, report the error and stop. The operator can fall back to manual steps from inside a separate `claude` session (start a new session, type `/plugins`, navigate to ALS, update from menu).

## Phase 5: Verify

```bash
jq -r '.plugins["als@als-marketplace"][0].version' ~/.claude/plugins/installed_plugins.json
```

If the version matches what was reported as "Latest available" in Phase 3, tell the operator the update succeeded.

If it doesn't match, tell the operator what version is installed vs what was expected, and ask them to report back so we can investigate what's pinning them.

## Phase 6: Final report

Briefly tell the operator:

- Old version → New version
- Whether a session restart is required (yes on Desktop for hooks/skills/agents to fully reload; usually yes on CLI as well)

## Why this skill exists

The CLI primitive `claude plugin update als@als-marketplace` is the documented universal update path. It works the same way regardless of platform or scope. This skill packages that primitive into an in-session flow with platform reporting, version readouts, and verification — so the operator gets a guided experience without having to remember the exact command or its arguments.

Empirical history: Earlier (2026-04-28) iterations of this skill walked the operator through Claude Code Desktop's GUI Update button. That path was unreliable in user scope (button stayed greyed) and broken in project scope (button activated but apply step failed with a false "192 files modified" warning). The CLI primitive — invoked directly via Bash shellout — worked in both scopes. So the skill was simplified to use only that path.
