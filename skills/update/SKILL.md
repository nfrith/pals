---
name: update
description: Update the installed ALS plugin to the latest version published in whichever marketplace it was installed from. Detects the marketplace name (RC `als-marketplace` for architects, stable `als-marketplace-stable` for edgerunners) and the install scope, then shells out to `claude plugin update als@<marketplace> --scope <scope>` — the universal CLI primitive. Works for Claude Code CLI and Desktop, project and user scope, both channels.
allowed-tools: AskUserQuestion, Bash, Read
---

# update

Move the installed ALS plugin from whatever version the operator is currently on to whatever is published as the latest in the marketplace it was installed from. ALS supports two release channels:

- **`als-marketplace`** (RC channel) — what architects install for pre-release testing. Source: `nfrith/als` repo at default ref (`main`).
- **`als-marketplace-stable`** (stable channel) — what edgerunners install for production use. Source: `nfrith/als-stable` repo, which points at `nfrith/als` at ref `stable`.

This skill detects which channel the operator is on (by scanning `installed_plugins.json` for any `als@*` key) and updates within that channel. It does not switch channels — channel switching is a separate operator-driven action (uninstall + reinstall from the other marketplace).

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

Report the platform. The flow is the same regardless, but knowing where we are helps explain what to expect (e.g., a session restart is required on Desktop for hooks/skills to reload).

## Phase 2: Detect own channel, then read version and scope for THAT channel

The skill operates only on the channel it was loaded from. This avoids cross-channel confusion when both `als@als-marketplace` (RC) and `als@als-marketplace-stable` (stable) are installed simultaneously on the same machine.

Detect the marketplace name from `${CLAUDE_PLUGIN_ROOT}`. The plugin install path is `~/.claude/plugins/cache/<marketplace>/als/<version>/`, so:

```bash
MARKETPLACE=$(echo "${CLAUDE_PLUGIN_ROOT}" | sed 's|.*/cache/||;s|/als/.*||')
echo "Marketplace: $MARKETPLACE"
```

Construct the lookup key:

```bash
KEY="als@$MARKETPLACE"
```

Read the install version and scope for THIS key only:

```bash
jq -r --arg k "$KEY" '.plugins[$k][0].version' ~/.claude/plugins/installed_plugins.json
jq -r --arg k "$KEY" '.plugins[$k][0].scope' ~/.claude/plugins/installed_plugins.json
```

Report: `"Currently installed: <version> (<scope> scope, <channel> channel)"`. If the key is not present in `installed_plugins.json`, tell the operator the running ALS install was loaded from a marketplace that has no record in `installed_plugins.json` — likely a `--plugin-dir` development load — and `/update` doesn't apply.

The scope value gates Phase 4 — `claude plugin update` defaults to user scope, so a project-scoped install must pass `--scope project` explicitly or the apply step fails.

## Phase 3: Refresh the marketplace clone

Pull the latest `marketplace.json` and plugin source from origin into the local marketplace clone at `~/.claude/plugins/marketplaces/<marketplace-name>/`. Use the marketplace name detected in Phase 2:

```bash
claude plugin marketplace update <marketplace-name> 2>&1
```

If the command fails, surface the error and stop — the operator likely has a network or auth problem we can't fix from inside a skill.

After success, read the latest version. The plugin source path differs by channel:

- **RC (`als-marketplace`):** plugin source is the same repo (`source: "./"`), so plugin.json lives at `~/.claude/plugins/marketplaces/als-marketplace/.claude-plugin/plugin.json`.
- **Stable (`als-marketplace-stable`):** plugin source points to `nfrith/als@stable` (a different repo), so the plugin clone lives separately. The marketplace.json's `plugins[0].version` field is the served version if explicitly declared; otherwise read from the resolved plugin clone.

The simplest read that works for both channels — read the version that ends up being served:

```bash
# Try plugin.json in the marketplace clone first (works for RC, source: "./")
jq -r '.version // empty' ~/.claude/plugins/marketplaces/<marketplace-name>/.claude-plugin/plugin.json 2>/dev/null
# If empty, fall back to checking the marketplace catalog's declared version
jq -r '.plugins[0].version // empty' ~/.claude/plugins/marketplaces/<marketplace-name>/.claude-plugin/marketplace.json 2>/dev/null
```

Per the version-resolution waterfall, `plugin.json` wins when present. Report: `"Latest available: <version>"`.

If the latest version equals the currently-installed version, tell the operator they're already on the newest published release and stop.

## Phase 4: Apply the update

Shell out to the CLI primitive, passing the marketplace name from Phase 2 and the scope:

```bash
claude plugin update als@<marketplace-name> --scope <scope> 2>&1
```

Examples:
- Architect on RC (project scope): `claude plugin update als@als-marketplace --scope project`
- Edgerunner on stable (user scope): `claude plugin update als@als-marketplace-stable --scope user`

The `--scope` flag is required — `claude plugin update` defaults to user scope, so omitting the flag fails for project-scoped installs. Verified empirically 2026-04-28.

Surface the command's output to the operator. If the command fails, report the error and stop. The operator can fall back to manual steps from inside a separate `claude` session (start a new session, type `/plugins`, navigate to ALS, update from menu).

## Phase 5: Verify

```bash
KEY="als@<marketplace-name>"
jq -r --arg k "$KEY" '.plugins[$k][0].version' ~/.claude/plugins/installed_plugins.json
```

If the version matches what was reported as "Latest available" in Phase 3, tell the operator the update succeeded.

If it doesn't match, tell the operator what version is installed vs what was expected, and ask them to report back so we can investigate what's pinning them.

## Phase 6: Final report

Briefly tell the operator:

- Channel (RC or stable)
- Old version → New version
- Whether a session restart is required (yes on Desktop for hooks/skills/agents to fully reload; usually yes on CLI as well)

## Why this skill exists

The CLI primitive `claude plugin update als@<marketplace> --scope <scope>` is the documented universal update path. It works the same way regardless of platform, scope, or channel. This skill packages that primitive into an in-session flow with platform reporting, version readouts, and verification — so the operator gets a guided experience without having to remember the exact command or its arguments.

Empirical history: Earlier (2026-04-28) iterations walked the operator through Claude Code Desktop's GUI Update button. That path was unreliable in user scope (button stayed greyed) and broken in project scope (button activated after Cmd+R refresh but apply step failed with a false "192 files modified" warning). The CLI primitive — invoked directly via Bash shellout — worked in both scopes once the `--scope` flag was passed correctly. Channels were added later (2026-04-28) to give the architect a pre-release test surface (RC) without affecting edgerunners (stable).
