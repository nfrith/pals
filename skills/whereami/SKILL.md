---
name: whereami
description: Diagnostic — report what the current agent harness exposes for ALS. Centers on the shared ALS runtime helper, then records harness/platform hints and a small optional Claude compatibility probe. Pure read-only; no side effects.
allowed-tools: Bash(bash *)
---

# whereami

You are the ALS environment probe. Report what the current harness exposes for ALS.

The source of truth for ALS plugin-root and harness detection is now `skills/lib/runtime-env.sh plugin`. Claude preprocessor substitution is retained only as optional legacy compatibility evidence.

**Do not:**
- Require an initialized ALS system
- Fail or halt if the runtime helper, plugin root, Claude variables, Codex variables, or cache paths are missing — absence is data
- Ask the operator for input — this is zero-input
- Modify the filesystem or environment
- Invoke any other skill

## Phase 0 — Optional Claude Compatibility Probe

Claude-family harnesses may evaluate the `!`backtick` directive below at skill-load time and inline stdout. Codex and other harnesses may leave it unevaluated. If no `===PHASE0_START===` / `===PHASE0_END===` block is visible in the prompt, record Phase 0 as unavailable.

This section exists only to preserve visibility into legacy Claude substitution behavior. Do not use it as the primary ALS plugin-root resolution mechanism when the runtime helper is available.

!`bash -c '
echo "===PHASE0_START==="
echo "--- phase: optional Claude preprocessor compatibility probe ---"
echo "CLAUDE_CODE_ENTRYPOINT=[${CLAUDE_CODE_ENTRYPOINT:-UNSET}]"
echo "CLAUDE_PLUGIN_ROOT_env=[${CLAUDE_PLUGIN_ROOT:-UNSET}]"
echo "literal_CLAUDE_PLUGIN_ROOT=[${CLAUDE_PLUGIN_ROOT}]"
echo "--- Claude ALS plugin cache on disk ---"
ls -d "$HOME"/.claude/plugins/cache/*/als/* 2>/dev/null | sort -V || echo "no claude als cache match"
echo "--- focused Claude env dump ---"
env | grep -iE "^(CLAUDE_CODE_ENTRYPOINT=|CLAUDE_PLUGIN_ROOT=)" | sort || echo "none"
echo "===PHASE0_END==="
'`

## Phase 1 — Primary Runtime Probe

Run the checks via a Bash tool call that you invoke yourself.

Set `SKILL_DIR` to this skill's base directory if the prompt exposes it. If the prompt only exposes the skill file path, use that file's parent directory. If no skill path is visible, leave `SKILL_DIR` as `__UNAVAILABLE__` and continue; cache and env probes still matter.

Use this command exactly as written except for replacing `__SKILL_DIR__` with the resolved skill directory when one is visible:

```bash
bash <<'DIAGNOSTIC_EOF'
SKILL_DIR="__SKILL_DIR__"

echo "===PHASE1_START==="
echo "--- phase: primary ALS runtime probe ---"
echo "--- runtime helper ---"
echo "SKILL_DIR=[$SKILL_DIR]"
if [ -n "$SKILL_DIR" ] && [ "$SKILL_DIR" != "__SKILL_DIR__" ] && [ "$SKILL_DIR" != "__UNAVAILABLE__" ] && [ -f "$SKILL_DIR/../lib/runtime-env.sh" ]; then
  bash "$SKILL_DIR/../lib/runtime-env.sh" plugin 2>&1
else
  echo "RUNTIME_HELPER_UNAVAILABLE"
fi
echo "--- harness / platform hints ---"
echo "HARNESS=[${HARNESS:-UNSET}]"
echo "ALS_HARNESS=[${ALS_HARNESS:-UNSET}]"
echo "CODEX_THREAD_ID=[${CODEX_THREAD_ID:-UNSET}]"
echo "CLAUDE_CODE_ENTRYPOINT=[${CLAUDE_CODE_ENTRYPOINT:-UNSET}]"
echo "--- ALS plugin cache on disk: codex ---"
ls -d "$HOME"/.codex/plugins/cache/*/als/* 2>/dev/null | sort -V || echo "no codex als cache match"
echo "--- highest ALS version: codex ---"
latest_codex=$(ls -d "$HOME"/.codex/plugins/cache/*/als/* 2>/dev/null | sort -V | tail -1)
if [ -n "$latest_codex" ]; then echo "$latest_codex"; else echo "none"; fi
echo "--- ALS plugin cache on disk: claude ---"
ls -d "$HOME"/.claude/plugins/cache/*/als/* 2>/dev/null | sort -V || echo "no claude als cache match"
echo "--- highest ALS version: claude ---"
latest_claude=$(ls -d "$HOME"/.claude/plugins/cache/*/als/* 2>/dev/null | sort -V | tail -1)
if [ -n "$latest_claude" ]; then echo "$latest_claude"; else echo "none"; fi
echo "--- focused env dump ---"
env | grep -iE "^(ALS_|HARNESS=|CLAUDE_CODE_ENTRYPOINT=|CODEX_)" | sort || echo "none"
echo "===PHASE1_END==="
DIAGNOSTIC_EOF
```

## Phase 2 — Derive

Using the Phase 0 and Phase 1 outputs, determine:

### 2a. Runtime Helper Result

Record:

- whether `skills/lib/runtime-env.sh plugin` was available
- the helper's `ALS_PLUGIN_ROOT`, if reported
- the helper's `HARNESS`, if reported
- the helper's `ALS_PLATFORM_CODE`, if reported
- helper diagnostics, if it returned anything else

### 2b. Harness and Platform Code

Prefer the runtime helper's `ALS_PLATFORM_CODE` value when reported. If it is empty, use the helper's `HARNESS` value. If the helper reports `UNKNOWN_HARNESS` or is unavailable, use `ALS_HARNESS`, `HARNESS`, live env (`CODEX_THREAD_ID` or `CLAUDE_CODE_ENTRYPOINT`), cache/path inference, then projection hints.

When running from a source checkout, `CODEX_THREAD_ID` is the strongest live Codex signal. If neither `CODEX_THREAD_ID` nor `CLAUDE_CODE_ENTRYPOINT` is available, `UNKNOWN_HARNESS` is a valid helper result; use explicit override or cache/path inference for the diagnostic report.

Map as follows:

| signal | platform code |
|--------|---------------|
| runtime helper `HARNESS: codex` | `ALS-PLAT-CXCLI` |
| runtime helper `HARNESS: claude` plus `CLAUDE_CODE_ENTRYPOINT=cli` | `ALS-PLAT-CCLI` |
| runtime helper `HARNESS: claude` plus `CLAUDE_CODE_ENTRYPOINT=claude-desktop` | `ALS-PLAT-CDSK` |
| runtime helper `HARNESS: claude` plus `CLAUDE_CODE_ENTRYPOINT=remote` | `ALS-PLAT-CWEB` |
| `CODEX_THREAD_ID` set | `ALS-PLAT-CXCLI` |
| `CLAUDE_CODE_ENTRYPOINT=cli` | `ALS-PLAT-CCLI` |
| `CLAUDE_CODE_ENTRYPOINT=claude-desktop` | `ALS-PLAT-CDSK` |
| `CLAUDE_CODE_ENTRYPOINT=remote` | `ALS-PLAT-CWEB` |
| Codex cache/path but no helper | `ALS-PLAT-CXCLI` *(inferred)* |
| anything else | `UNKNOWN-{signal}` |

If signals disagree, note the disagreement explicitly.

### 2c. Skill Base-Directory Visibility

Look at the current prompt you were invoked with. Record:

- `Base directory for this skill: <path>` if present
- the parent directory of a visible skill file path if present
- `none visible` if neither is present

### 2d. Best-Available Plugin-Root Resolution

Evaluate these mechanisms in order. The first one that yields a valid ALS plugin path is the "most reliable" for this environment:

1. `skills/lib/runtime-env.sh plugin` reports `ALS_PLUGIN_ROOT`
2. `$ALS_PLUGIN_ROOT` present in subprocess env
3. Filesystem `$HOME/.codex/plugins/cache/*/als/*` present -> pick highest semver directory
4. Filesystem `$HOME/.claude/plugins/cache/*/als/*` present -> pick highest semver directory
5. Legacy Claude compatibility: `${CLAUDE_PLUGIN_ROOT}` was expanded in Phase 0
6. None of the above -> record `none resolvable`

## Phase 3 — Report

Produce the report below as your entire response to the operator. Do not add commentary, follow-up questions, or next-step prompts.

```markdown
# /als:whereami report

**Harness**: `{claude | codex | unknown}`  *(source: {runtime-helper | env | cache/path inference | unknown})*
**Platform**: {CCLI | CXCLI | CDSK | CWEB | UNKNOWN-xxx}
**Runtime helper**: {available | unavailable | diagnostic}
**Resolved plugin root**: `{actual path or "none resolvable"}`
**Skill base directory (from prompt)**: {path or `none visible`}

## Runtime Helper

| Field | Value |
|-------|-------|
| `ALS_PLUGIN_ROOT` | `{path | unavailable}` |
| `HARNESS` | `{claude | codex | unavailable}` |
| `ALS_PLATFORM_CODE` | `{ALS-PLAT-XXXX | unavailable}` |
| `ALS_PLUGIN_MANIFEST_PATH` | `{path | unavailable}` |
| `ALS_MARKETPLACE_MANIFEST_PATH` | `{path | unavailable}` |

## Harness Hints

| Signal | Value |
|--------|-------|
| `$HARNESS` | `{value or UNSET}` |
| `$ALS_HARNESS` | `{value or UNSET}` |
| `$CODEX_THREAD_ID` | `{value or UNSET}` |
| `$CLAUDE_CODE_ENTRYPOINT` | `{value or UNSET}` |

## Cache Surface

| Surface | Phase 1 |
|---------|---------|
| `~/.codex/plugins/cache/*/als/*` on disk | {highest semver path | not found} |
| `~/.claude/plugins/cache/*/als/*` on disk | {highest semver path | not found} |

## Legacy Claude Compatibility

| Signal | Phase 0 |
|--------|---------|
| Phase 0 exposed | {yes | no} |
| `$CLAUDE_CODE_ENTRYPOINT` | `{value or UNSET or unavailable}` |
| `$CLAUDE_PLUGIN_ROOT` env | `{value or UNSET or unavailable}` |
| `${CLAUDE_PLUGIN_ROOT}` literal expansion | `{value or empty or unavailable}` |

## Verdict

**Most reliable ALS-plugin-root resolution mechanism here**: {named mechanism from 2d}
**Which phase exposed it**: {phase-0 only | phase-1 only | both | none}
**Delta between phases**: {summary of differences, "Phase 0 unavailable on this harness", or "no meaningful delta"}

## Phase 0 raw output

\`\`\`
{paste verbatim between ===PHASE0_START=== and ===PHASE0_END===, or "Phase 0 unavailable: no inlined preprocessor output was present."}
\`\`\`

## Phase 1 raw output

\`\`\`
{paste verbatim between ===PHASE1_START=== and ===PHASE1_END===}
\`\`\`
```
