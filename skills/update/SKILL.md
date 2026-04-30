---
name: update
description: Update the installed ALS plugin to the latest version published in whichever marketplace it was installed from. Self-detects channel (RC `als-marketplace` for architects, stable `als-marketplace-stable` for edgerunners) via `${CLAUDE_PLUGIN_ROOT}`, refreshes the right marketplace clone, then shells out to `claude plugin update als@<marketplace> --scope <scope>` — the universal CLI primitive. Works across CLI and Desktop, project and user scope, both channels. Output is verbose by design — useful for architect UAT (`/copy` paste into a release report) and edgerunner support (full diagnostic context).
allowed-tools: AskUserQuestion, Bash, Read
---

# update

Move the installed ALS plugin from whatever version the operator is currently on to whatever is published as the latest in the marketplace it was installed from. ALS supports two release channels:

- **`als-marketplace`** (RC channel) — what architects install for pre-release testing. Source: `nfrith/als` repo at default ref (`main`).
- **`als-marketplace-stable`** (stable channel) — what edgerunners install for production use. Source: `nfrith/als-marketplace-stable`, a thin catalog repo that points at `nfrith/als` at ref `stable`.

This skill detects which channel the operator is on (via `${CLAUDE_PLUGIN_ROOT}`) and updates within that channel. It does not switch channels — channel switching is a separate operator-driven action (uninstall + reinstall from the other marketplace).

## Output discipline

The skill's output is intentionally verbose. Two audiences depend on the detail:

1. **ALS architect during UAT.** After running `/update` as part of a release smoke test, the architect uses `/copy` to paste the full skill output into a release report or back to the agent that initiated the test. Every phase needs to surface enough info that the report stands alone — version readouts, paths inspected, command outputs, decision points.
2. **Edgerunner experiencing an issue.** When something goes wrong, the edgerunner pastes the skill output to support. Support needs the full diagnostic picture without follow-up questions: platform, channel, scope, paths, file states, command outputs.

Each phase below specifies what to surface. Do not condense or summarize away the diagnostic details.

## Phase 1: Detect platform

```bash
echo "ENTRYPOINT=${CLAUDE_CODE_ENTRYPOINT:-unknown}"
```

Map per [`platforms.md`](../docs/references/platforms.md):

| Entrypoint | Platform code |
|------------|---------------|
| `cli` | [`ALS-PLAT-CCLI`](../docs/references/platforms.md) |
| `claude-desktop` | [`ALS-PLAT-CDSK`](../docs/references/platforms.md) |

**Surface:**
- `Platform: <code> (<human name>)`
- `Entrypoint: <raw $CLAUDE_CODE_ENTRYPOINT value>`
- One sentence on what restart-required means for this platform (Desktop: full session restart; CLI: new `claude` invocation)

## Phase 2: Detect own channel, version, scope

```bash
echo "CLAUDE_PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT}"
MARKETPLACE=$(echo "${CLAUDE_PLUGIN_ROOT}" | sed 's|.*/cache/||;s|/als/.*||')
echo "Marketplace: $MARKETPLACE"
KEY="als@$MARKETPLACE"
echo "Lookup key: $KEY"

MATCHES=$(jq -c --arg k "$KEY" --arg cwd "$PWD" '
  (.plugins[$k] // [])
  | map(select(.scope == "user" or .projectPath == $cwd))
' ~/.claude/plugins/installed_plugins.json)
MATCH_COUNT=$(jq 'length' <<<"$MATCHES")

if [ "$MATCH_COUNT" -eq 0 ]; then
  echo "The running ALS install has no installed_plugins.json record — likely a --plugin-dir development load — and /update doesn't apply."
  exit 1
fi

if [ "$MATCH_COUNT" -gt 1 ]; then
  echo "Multiple installed_plugins.json records matched key=$KEY cwd=$PWD. Refusing to guess."
  jq '.' <<<"$MATCHES"
  exit 1
fi

ACTIVE=$(jq '.[0]' <<<"$MATCHES")
jq '.' <<<"$ACTIVE"
```

The jq read must select the active record for this session: user-scope records match unconditionally; project-scope records only match when `projectPath == $PWD`. The final `ACTIVE` object is the full installed entry (version, scope, installPath, gitCommitSha, installedAt, lastUpdated, `projectPath` if project-scope).

**Surface:**
- `CLAUDE_PLUGIN_ROOT: <full path>` — proves which cache the running skill came from
- `Marketplace: <name>` (`als-marketplace` or `als-marketplace-stable`)
- `Channel: <RC | stable>` (derived from marketplace name)
- `Lookup key: <key>` — the JSON path queried
- The full installed-plugin entry as JSON (operator can verify gitCommitSha, install timestamps, etc.)
- One-line summary: `Installed: <version> (<scope> scope, <channel> channel)`

If the filtered read returns zero matches: explain that the running ALS install has no `installed_plugins.json` record — likely a `--plugin-dir` development load — and `/update` doesn't apply. Stop. If it returns more than one match: surface the full candidate array and stop.

## Phase 3: Refresh the marketplace clone, read latest

```bash
claude plugin marketplace update "$MARKETPLACE" 2>&1
```

This is the actual command — surface its full output. If it fails, the error message is what support needs.

After refresh, read the latest version. Try in this order:

```bash
# RC source (plugin source = "./") — plugin.json lives in the marketplace clone
jq -r '.version // empty' ~/.claude/plugins/marketplaces/$MARKETPLACE/.claude-plugin/plugin.json 2>/dev/null

# Stable source (plugin source = github/url with ref) — fetch plugin.json from the source URL
SOURCE_URL=$(jq -r '.plugins[0].source.url // .plugins[0].source.repo // empty' ~/.claude/plugins/marketplaces/$MARKETPLACE/.claude-plugin/marketplace.json)
SOURCE_REF=$(jq -r '.plugins[0].source.ref // "main"' ~/.claude/plugins/marketplaces/$MARKETPLACE/.claude-plugin/marketplace.json)
# Convert https://github.com/owner/repo.git → owner/repo, or owner/repo (already)
REPO=$(echo "$SOURCE_URL" | sed 's|https://github.com/||;s|\.git$||')
curl -sL "https://raw.githubusercontent.com/$REPO/$SOURCE_REF/.claude-plugin/plugin.json" | jq -r '.version // empty' 2>/dev/null
```

**Surface:**
- `Refreshing marketplace clone: $MARKETPLACE`
- The full output of `claude plugin marketplace update` (whatever it returns — success line, error, etc.)
- For stable channel, the source URL and ref being fetched (so support can verify the curl target)
- `Latest available: <version>` — the resolved version
- If the latest matches the installed version: `Already on latest. No update needed.` Stop here for clean output.

## Phase 4: Apply the update

```bash
MATCHES=$(jq -c --arg k "$KEY" --arg cwd "$PWD" '
  (.plugins[$k] // [])
  | map(select(.scope == "user" or .projectPath == $cwd))
' ~/.claude/plugins/installed_plugins.json)
MATCH_COUNT=$(jq 'length' <<<"$MATCHES")

if [ "$MATCH_COUNT" -eq 0 ]; then
  echo "The running ALS install has no installed_plugins.json record — likely a --plugin-dir development load — and /update doesn't apply."
  exit 1
fi

if [ "$MATCH_COUNT" -gt 1 ]; then
  echo "Multiple installed_plugins.json records matched key=$KEY cwd=$PWD. Refusing to guess."
  jq '.' <<<"$MATCHES"
  exit 1
fi

SCOPE=$(jq -r '.[0].scope' <<<"$MATCHES")
claude plugin update "$KEY" --scope "$SCOPE" 2>&1
```

Surface the full command output. The CLI primitive prints status/error directly.

**Surface:**
- The full command being run (with `$KEY` and `$SCOPE` resolved): `claude plugin update als@<marketplace> --scope <scope>`
- The full stdout+stderr of the command
- One-line outcome: `Update applied.` or `Update failed: <one-line summary>`

If the command fails: stop and report. Suggest manual fallback — opening a separate `claude` session, typing `/plugins`, navigating to ALS, updating from the menu.

## Phase 5: Verify the new version landed

```bash
MATCHES=$(jq -c --arg k "$KEY" --arg cwd "$PWD" '
  (.plugins[$k] // [])
  | map(select(.scope == "user" or .projectPath == $cwd))
' ~/.claude/plugins/installed_plugins.json)
MATCH_COUNT=$(jq 'length' <<<"$MATCHES")

if [ "$MATCH_COUNT" -eq 0 ]; then
  echo "The running ALS install has no installed_plugins.json record — likely a --plugin-dir development load — and /update doesn't apply."
  exit 1
fi

if [ "$MATCH_COUNT" -gt 1 ]; then
  echo "Multiple installed_plugins.json records matched key=$KEY cwd=$PWD. Refusing to guess."
  jq '.' <<<"$MATCHES"
  exit 1
fi

ACTIVE=$(jq '.[0]' <<<"$MATCHES")
jq '.' <<<"$ACTIVE"
```

Read the full entry again — version, gitCommitSha, lastUpdated should all reflect the new state.

**Surface:**
- The full updated installed-plugin entry as JSON
- One-line confirmation: `Verified: <new version> installed.`
- If the installed version doesn't match the "Latest available" reported in Phase 3: surface the mismatch and ask the operator to investigate (could be a partial update, cache state issue, etc.)

## Phase 6: Final report

Surface a single, formatted summary block that captures the whole run. This is what the architect copies into a release report or the edgerunner pastes to support:

```
## ALS /update report

- **Platform:** <code> (<human name>)
- **Channel:** <RC | stable> (`<marketplace name>`)
- **Scope:** <user | project>
- **Marketplace clone path:** ~/.claude/plugins/marketplaces/<marketplace>/
- **Plugin install path:** <installPath from installed_plugins.json>
- **Version:** <old> → <new>  (or: <version> — no change)
- **Git commit SHA:** <new gitCommitSha>
- **Action taken:** <"Update applied" | "Already on latest, no action" | "Failed">
- **Restart required:** yes — <one-line reason for this platform>

<If applicable: any non-fatal warnings or notes from Phase 3 or Phase 4 outputs>
```

The architect uses `/copy` to grab this. Edgerunner support can read this and reconstruct the full state without needing to ask follow-up questions.

## Why this skill exists

The CLI primitive `claude plugin update als@<marketplace> --scope <scope>` is the documented universal update path. It works the same way regardless of platform, scope, or channel. This skill packages that primitive into an in-session flow with channel self-detection, scope resolution, version readouts, verbose diagnostics, and verification — so the operator gets a guided experience and a complete release/support trail in one command.

Empirical history: Earlier (2026-04-28) iterations walked the operator through Claude Code Desktop's GUI Update button. That path was unreliable in user scope (button stayed greyed) and broken in project scope (button activated after Cmd+R refresh but apply step failed with a false "192 files modified" warning). The CLI primitive — invoked directly via Bash shellout — worked in both scopes once the `--scope` flag was passed correctly. Channels were added (2026-04-28) to give the architect a pre-release test surface (RC) without affecting edgerunners (stable). Channel self-detection via `${CLAUDE_PLUGIN_ROOT}` (also 2026-04-28) eliminated the need for any "single-install" testing rule on the architect's machine.

The verbose-by-design output is for: (1) architect UAT — the architect runs this skill as part of release smoke tests and uses `/copy` to ship the full output into a release report; (2) edgerunner support — when something goes wrong, the edgerunner pastes the output and support sees the full diagnostic picture without follow-ups.
