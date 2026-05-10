---
name: update
description: Update the installed ALS plugin to the latest version published in whichever marketplace it was installed from when the active harness exposes a plugin-update primitive, then run the post-install language-upgrade and construct-upgrade phases that ALS-066 and ALS-067 require. Claude self-update shells out to `claude plugin update als@<marketplace> --scope <scope>`. Codex self-update is not yet exposed here; Codex runs the runtime follow-through against the currently refreshed plugin root. Output is verbose by design — useful for architect UAT (`/copy` paste into a release report) and edgerunner support (full diagnostic context).
allowed-tools: AskUserQuestion, Bash, Read
---

# update

Move the installed ALS plugin from whatever version the operator is currently on to whatever is published as the latest in the marketplace it was installed from. ALS supports two release channels:

- **`als-marketplace`** (RC channel) — what architects install for pre-release testing. Source: `nfrith/als` repo at default ref (`main`).
- **`als-marketplace-stable`** (stable channel) — what edgerunners install for production use. Source: `https://github.com/nfrith/als-stable`, a thin catalog repo that points at `nfrith/als` at ref `stable`.

This skill detects which channel the operator is on from `${ALS_PLUGIN_ROOT}` and updates within that channel when the harness supports in-session self-update. It does not switch channels — channel switching is a separate operator-driven action (uninstall + reinstall from the other marketplace).

## Output discipline

The skill's output is intentionally verbose. Two audiences depend on the detail:

1. **ALS architect during UAT.** After running `/update` as part of a release smoke test, the architect uses `/copy` to paste the full skill output into a release report or back to the agent that initiated the test. Every phase needs to surface enough info that the report stands alone — version readouts, paths inspected, command outputs, decision points.
2. **Edgerunner experiencing an issue.** When something goes wrong, the edgerunner pastes the skill output to support. Support needs the full diagnostic picture without follow-up questions: platform, channel, scope, paths, file states, command outputs.

Each phase below specifies what to surface. Do not condense or summarize away the diagnostic details.

## Phase 1: Detect platform and runtime

```bash
bash {skill-dir}/../lib/runtime-env.sh plugin
echo "CLAUDE_ENTRYPOINT=${CLAUDE_CODE_ENTRYPOINT:-unknown}"
echo "CODEX_THREAD_ID=${CODEX_THREAD_ID:+set}"
```

Extract `ALS_PLUGIN_ROOT`, `HARNESS`, `ALS_PLATFORM_CODE`, `ALS_PLUGIN_MANIFEST_PATH`, and `ALS_MARKETPLACE_MANIFEST_PATH` from the runtime output.

Use `ALS_PLATFORM_CODE` when present. If it is empty, map per [`platforms.md`](../docs/references/platforms.md): `HARNESS=codex` maps to [`ALS-PLAT-CXCLI`](../docs/references/platforms.md), while `HARNESS=claude` maps `$CLAUDE_CODE_ENTRYPOINT` to the corresponding Claude platform code.

**Surface:**
- `Platform: <code> (<human name>)`
- `Claude entrypoint: <raw $CLAUDE_CODE_ENTRYPOINT value>`
- `Codex thread signal: <set | empty>`
- `Harness: <claude | codex>`
- `ALS_PLUGIN_ROOT: <full path>`
- One sentence on what restart-required means for this platform (Desktop: full session restart; Claude CLI: new `claude` invocation; Codex CLI: new Codex invocation)

## Phase 2: Detect own channel, version, scope

```bash
echo "ALS_PLUGIN_ROOT=${ALS_PLUGIN_ROOT}"
echo "HARNESS=${HARNESS}"
echo "ALS_PLATFORM_CODE=${ALS_PLATFORM_CODE}"
echo "ALS_PLUGIN_MANIFEST_PATH=${ALS_PLUGIN_MANIFEST_PATH}"
echo "ALS_MARKETPLACE_MANIFEST_PATH=${ALS_MARKETPLACE_MANIFEST_PATH}"
PLUGIN_MANIFEST_VERSION=$(jq -r '.version // empty' "${ALS_PLUGIN_MANIFEST_PATH}" 2>/dev/null)
MARKETPLACE_MANIFEST_NAME=$(jq -r '.name // empty' "${ALS_MARKETPLACE_MANIFEST_PATH}" 2>/dev/null)
echo "Manifest version: $PLUGIN_MANIFEST_VERSION"
echo "Marketplace manifest name: $MARKETPLACE_MANIFEST_NAME"
case "${ALS_PLUGIN_ROOT}" in
  */cache/*/als/*)
    MARKETPLACE=$(echo "${ALS_PLUGIN_ROOT}" | sed 's|.*/cache/||;s|/als/.*||')
    ;;
  *)
    MARKETPLACE="$MARKETPLACE_MANIFEST_NAME"
    ;;
esac
echo "Marketplace: $MARKETPLACE"
if [ -z "$MARKETPLACE" ]; then
  echo "MARKETPLACE_MISSING: could not resolve marketplace from ALS_PLUGIN_ROOT or ALS_MARKETPLACE_MANIFEST_PATH"
  exit 1
fi
KEY="als@$MARKETPLACE"
echo "Lookup key: $KEY"
if [ "$HARNESS" = "codex" ]; then
  echo "CODEX_PLUGIN_SELF_UPDATE_UNSUPPORTED: Codex does not currently expose a stable in-session plugin self-update primitive to this skill."
  echo "Refresh the ALS Codex plugin through Codex's plugin manager first, then rerun \$update for runtime follow-through."
  echo "Skipping Claude installed_plugins.json lookup."
else
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
  ACTIVE_INSTALL_PATH=$(jq -r '.installPath // empty' <<<"$ACTIVE")
  if [ -n "$ACTIVE_INSTALL_PATH" ] && [ "$ACTIVE_INSTALL_PATH" != "$ALS_PLUGIN_ROOT" ]; then
    echo "INSTALL_PATH_MISMATCH: installed_plugins.json matched $KEY, but installPath=$ACTIVE_INSTALL_PATH does not match ALS_PLUGIN_ROOT=$ALS_PLUGIN_ROOT"
    exit 1
  fi
  jq '.' <<<"$ACTIVE"
fi
```

For Claude, the jq read must select the active record for this session: user-scope records match unconditionally; project-scope records only match when `projectPath == $PWD`, and `installPath` must match `${ALS_PLUGIN_ROOT}` when present. The final `ACTIVE` object is the full installed entry (version, scope, installPath, gitCommitSha, installedAt, lastUpdated, `projectPath` if project-scope). For Codex, do not read Claude install state; mark plugin self-update as skipped, skip Phases 3-5, and continue to Phase 6 so runtime follow-through can run against the current plugin root.

**Surface:**
- `ALS_PLUGIN_ROOT: <full path>` — proves which cache the running skill came from
- `HARNESS: <claude | codex>` — controls runtime follow-through projection
- `ALS_PLUGIN_MANIFEST_PATH: <full path>`
- `Manifest version: <version from plugin.json>`
- `Marketplace: <name>` (`als-marketplace` or `als-marketplace-stable`)
- `Channel: <RC | stable>` (derived from marketplace name)
- `Lookup key: <key>` — the JSON path queried
- For Claude: the full installed-plugin entry as JSON (operator can verify gitCommitSha, install timestamps, etc.)
- For Codex: `Plugin self-update: skipped — Codex self-update primitive unavailable to this skill`
- One-line summary: `Installed: <version> (<scope> scope, <channel> channel)` for Claude, or `Installed manifest: <version> (<channel> channel, Codex self-update skipped)` for Codex

If the Claude filtered read returns zero matches: explain that the running ALS install has no `installed_plugins.json` record — likely a `--plugin-dir` development load — and `/update` doesn't apply. Stop. If it returns more than one match: surface the full candidate array and stop.

## Phase 3: Refresh the marketplace clone, read latest

Skip this phase when `HARNESS=codex`; Codex plugin self-update is not implemented in this skill yet.

```bash
claude plugin marketplace update "$MARKETPLACE" 2>&1
MARKETPLACE_ROOT="$HOME/.claude/plugins/marketplaces/$MARKETPLACE"
```

This is the actual command — surface its full output. If it fails, the error message is what support needs.

After refresh, read the latest version. Try in this order:

```bash
# RC source (plugin source = "./") — plugin.json lives in the marketplace clone
jq -r '.version // empty' "$MARKETPLACE_ROOT/.claude-plugin/plugin.json" 2>/dev/null

# Stable source (plugin source = github/url with ref) — fetch plugin.json from the source URL
SOURCE_URL=$(jq -r '.plugins[0].source.url // .plugins[0].source.repo // empty' "$MARKETPLACE_ROOT/.claude-plugin/marketplace.json")
SOURCE_REF=$(jq -r '.plugins[0].source.ref // "main"' "$MARKETPLACE_ROOT/.claude-plugin/marketplace.json")
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

Skip this phase when `HARNESS=codex`; continue to Phase 6.

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
ACTIVE_INSTALL_PATH=$(jq -r '.installPath // empty' <<<"$ACTIVE")
if [ -n "$ACTIVE_INSTALL_PATH" ] && [ "$ACTIVE_INSTALL_PATH" != "$ALS_PLUGIN_ROOT" ]; then
  echo "INSTALL_PATH_MISMATCH: installed_plugins.json matched $KEY, but installPath=$ACTIVE_INSTALL_PATH does not match ALS_PLUGIN_ROOT=$ALS_PLUGIN_ROOT"
  exit 1
fi

SCOPE=$(jq -r '.scope' <<<"$ACTIVE")
claude plugin update "$KEY" --scope "$SCOPE" 2>&1
```

Surface the full command output. The CLI primitive prints status/error directly.

**Surface:**
- The full command being run (with `$KEY` and `$SCOPE` resolved): `claude plugin update als@<marketplace> --scope <scope>`
- The full stdout+stderr of the command
- One-line outcome: `Update applied.` or `Update failed: <one-line summary>`

If the command fails: stop and report. Suggest manual fallback — opening a separate `claude` session, typing `/plugins`, navigating to ALS, updating from the menu.

## Phase 5: Verify the new version landed

Skip this phase when `HARNESS=codex`; continue to Phase 6.

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

## Phase 6: Upgrade runtime surfaces

After the plugin update is verified, drive runtime follow-through through the transaction-wrapper CLI at `${ALS_PLUGIN_ROOT}/alsc/update-transaction/src/cli.ts`. The CLI is the operator-reachable adapter for [SDR 039](../../sdr/039-update-transaction-wrapper-contract.md); the SDR still owns the semantics.

1. Create temp files for the prepared payload, answer map, and final result.

```bash
bash {skill-dir}/../lib/runtime-env.sh ${HARNESS} "$(pwd)"
```

Extract `SYSTEM_ROOT` and `TRANSACTION_ROOTS` from the runtime output. If the output is `NO_SYSTEM`, skip runtime follow-through and report `Runtime follow-through: skipped — no ALS system root found`.

Then create temp files:

```bash
REPO_ROOT=$(git -C "${SYSTEM_ROOT}" rev-parse --show-toplevel)
PREPARED_JSON=$(mktemp -t als-update-prepared.XXXXXX.json)
ANSWERS_JSON=$(mktemp -t als-update-answers.XXXXXX.json)
RESULT_JSON=$(mktemp -t als-update-result.XXXXXX.json)
printf '{}\n' > "$ANSWERS_JSON"
```

2. Prepare the transaction. Add `--target-als-version <N>` only if the operator asked to pin a specific ALS target. Without it, the CLI auto-discovers the latest reachable recipe chain under `${ALS_PLUGIN_ROOT}/language-upgrades/recipes/`.

```bash
set +e
bun ${ALS_PLUGIN_ROOT}/alsc/update-transaction/src/cli.ts prepare \
  --repo-root "$REPO_ROOT" \
  --system-root "$SYSTEM_ROOT" \
  --plugin-root "${ALS_PLUGIN_ROOT}" \
  --harness "${HARNESS}" \
  > "$PREPARED_JSON"
PREPARE_EXIT=$?
set -e
cat "$PREPARED_JSON"
```

Then inspect the payload:

```bash
PREPARED_STATUS=$(jq -r '.status // empty' "$PREPARED_JSON" 2>/dev/null || true)
PREPARED_REASON=$(jq -r '.reason // empty' "$PREPARED_JSON" 2>/dev/null || true)
PREPARED_DIAGNOSTIC=$(jq -r '.diagnostic // empty' "$PREPARED_JSON" 2>/dev/null || true)
```

If `PREPARED_STATUS` is `blocked` or `PREPARE_EXIT` is non-zero, do not stop cold. `/update` must always turn prepare-time blockers into an AskUserQuestion conversation.

- Always surface the raw JSON plus any stderr so support still has the full diagnostic record.
- Always include the blocker `reason` and `diagnostic` in the AskUserQuestion body.
- If the payload is not valid JSON, AskUserQuestion with the raw stdout+stderr and options `Retry` or `Abort`.

For `reason: "dirty-live-tree"`:

```bash
git -C "$REPO_ROOT" status --porcelain --untracked-files=no -- ${TRANSACTION_ROOTS}
```

- By the time this blocker surfaces, prepare has already auto-repaired the canonical transient-runtime taxonomy (`runtime/`, `status.json`, pulse cache JSON, telemetry `events.jsonl`, and dispatcher `drain-request.json`) if those were the only tracked runtime offenders. Treat the remaining list as user-authored drift or other non-transient projected-state divergence.
- Show the exact dirty path list in the AskUserQuestion body.
- Offer these options:
  - `Commit the dirty files and proceed`
  - `Walk through them with me`
  - `Abort`
- If the operator chooses `Commit the dirty files and proceed`, stage only the listed tracked paths and commit them with a clear checkpoint message such as `chore: checkpoint local ALS state before /update`, then rerun Step 2.
- If the operator chooses `Walk through them with me`, iterate the path list one file at a time via AskUserQuestion. For each path, offer options like `Commit this file`, `Discard this file`, or `Stop here`. After each requested action, re-check the dirty-path list. When the list is empty, rerun Step 2.
- If the operator chooses `Abort`, stop cleanly.

For every other prepare blocker, still use AskUserQuestion rather than terminating:

- `live-validation-failed`: offer to run `/validate` together and retry, or abort.
- `language-plan-mismatch`: offer to re-read the current ALS version / reachable target and retry, or abort.
- Any future blocker reason: surface the raw `reason` + `diagnostic`, offer `Retry after investigation`, and `Abort`.

Do not proceed to execute until prepare returns a valid payload with `status: "ready"`.

3. If the prepared payload contains prompts, batch them into one AskUserQuestion round before execute. Use `$PREPARED_JSON` as the source of truth:
   - Prompt key: `.prompts[].key`
   - Prompt body: `.prompts[].markdown`
   - Options: `.prompts[].options[]`

Use this helper to inspect the pending prompt batch:

```bash
jq '.prompts' "$PREPARED_JSON"
```

Write the AskUserQuestion answers back to `$ANSWERS_JSON` as one JSON object keyed exactly by prompt key. Example:

```json
{
  "v1-to-v2:confirm-live-apply": "confirm",
  "dispatcher-lifecycle:orders": "drain"
}
```

If any answer is a cancel or abort choice, stop before execute.

4. Execute the prepared transaction with the answer map.

```bash
set +e
bun ${ALS_PLUGIN_ROOT}/alsc/update-transaction/src/cli.ts execute \
  --prepared-file "$PREPARED_JSON" \
  --answers-file "$ANSWERS_JSON" \
  > "$RESULT_JSON"
EXECUTE_EXIT=$?
set -e
cat "$RESULT_JSON"
```

If `EXECUTE_EXIT` is non-zero, stop and surface the `failure_surface`, `diagnostic`, `staging_worktree_path`, and any `manual_follow_up_note` from `$RESULT_JSON`.

5. On success, surface the `commit_oid`, `action_count`, and any `manual_follow_up_note` from `$RESULT_JSON`.

See [SDR 039](../../sdr/039-update-transaction-wrapper-contract.md) for the full `/update` transaction contract and [SDR 038](../../sdr/038-construct-upgrade-engine-contract.md) for construct-upgrade semantics. Do not restate or special-case that orchestration here.

Known v1 gap: if statusline data goes stale after a successful run, the operator may still need `/bootup` or `/reboot` until pulse becomes a construct participant.

## Phase 7: Final report

Surface a single, formatted summary block that captures the whole run. This is what the architect copies into a release report or the edgerunner pastes to support:

```
## ALS /update report

- **Platform:** <code> (<human name>)
- **Harness:** <claude | codex>
- **Channel:** <RC | stable> (`<marketplace name>`)
- **Scope:** <user | project | codex-unavailable>
- **Marketplace clone path:** <path, or "skipped for Codex">
- **Plugin install path:** <installPath from installed_plugins.json, or ALS_PLUGIN_ROOT for Codex>
- **ALS plugin root:** <ALS_PLUGIN_ROOT>
- **Version:** <old> → <new>  (or: <version> — no change)
- **Git commit SHA:** <new gitCommitSha, or "unavailable for Codex self-update skip">
- **Action taken:** <"Update applied" | "Already on latest, no action" | "Failed" | "Plugin self-update skipped for Codex">
- **Runtime follow-through:** <"Language-upgrade run" | "Construct-upgrade run" | "No follow-up needed" | "Failed during follow-through">
- **Restart required:** yes — <one-line reason for this platform>

<If applicable: any non-fatal warnings or notes from Phase 3 or Phase 4 outputs>
```

The architect uses `/copy` to grab this. Edgerunner support can read this and reconstruct the full state without needing to ask follow-up questions.

## Why this skill exists

The CLI primitive `claude plugin update als@<marketplace> --scope <scope>` is the documented update path for Claude Code. It works the same way regardless of Claude Code platform, scope, or channel. This skill packages that primitive into an in-session flow with channel self-detection, scope resolution, version readouts, verbose diagnostics, and verification — so the operator gets a guided experience and a complete release/support trail in one command. Codex support currently covers runtime follow-through only; plugin self-update waits for a stable Codex update primitive.

Empirical history: Earlier (2026-04-28) iterations walked the operator through Claude Code Desktop's GUI Update button. That path was unreliable in user scope (button stayed greyed) and broken in project scope (button activated after Cmd+R refresh but apply step failed with a false "192 files modified" warning). The CLI primitive — invoked directly via Bash shellout — worked in both scopes once the `--scope` flag was passed correctly. Channels were added (2026-04-28) to give the architect a pre-release test surface (RC) without affecting edgerunners (stable). Channel self-detection via the ALS plugin root (also 2026-04-28) eliminated the need for any "single-install" testing rule on the architect's machine.

The verbose-by-design output is for: (1) architect UAT — the architect runs this skill as part of release smoke tests and uses `/copy` to ship the full output into a release report; (2) edgerunner support — when something goes wrong, the edgerunner pastes the output and support sees the full diagnostic picture without follow-ups.
