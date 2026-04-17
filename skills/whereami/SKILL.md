---
name: whereami
description: Diagnostic — report what the current Claude Code environment exposes for ALS. Captures both skill-load preprocessor context and Bash-tool subprocess context so the two can be compared. Use this to discover which env vars, PATH entries, and plugin-cache paths are reliably available on this platform. Pure read-only; no side effects. Runs even when CLAUDE_PLUGIN_ROOT is missing — that absence is part of the data.
allowed-tools: Bash(bash *)
---

# whereami

You are the ALS environment probe. Report what the current Claude Code environment exposes for ALS across two execution contexts:

- **Phase 0 (preprocessor)** — the harness evaluated the `!`backtick` directive below at skill-load time and inlined its stdout into what you're reading. You did not invoke that command; you inherited its output as static text. Treat the content between `===PHASE0_START===` and `===PHASE0_END===` as raw input data.
- **Phase 1 (Bash tool)** — you will invoke a Bash tool call yourself. Its execution environment may differ from Phase 0's.

The two perspectives may differ. Capturing the delta is the point of this skill.

**Do not:**
- Require any ALS state, plugin root, or compiler to be present
- Fail or halt if `CLAUDE_PLUGIN_ROOT` / `CLAUDE_SKILL_DIR` are missing — their absence is data, not a blocker
- Ask the operator for input — this is zero-input
- Modify the filesystem or environment
- Invoke any other skill
- Interpret the Phase 0 output yourself before Phase 1 runs — just record it verbatim

## Phase 0 — Preprocessor probe

The block below is inlined at skill-load by the harness. You see only its stdout; the `!` directive itself is gone by the time you read this. Capture the content between the markers verbatim for the report.

!`bash -c '
echo "===PHASE0_START==="
echo "--- phase: preprocessor (harness !-directive, skill-load time) ---"
echo "--- entrypoint ---"
echo "CLAUDE_CODE_ENTRYPOINT=[${CLAUDE_CODE_ENTRYPOINT:-UNSET}]"
echo "CLAUDE_CODE_EXECPATH=[${CLAUDE_CODE_EXECPATH:-UNSET}]"
echo "CLAUDECODE=[${CLAUDECODE:-UNSET}]"
echo "CLAUDE_CODE_REMOTE=[${CLAUDE_CODE_REMOTE:-UNSET}]"
echo "--- target vars (env presence) ---"
for v in CLAUDE_PLUGIN_ROOT CLAUDE_SKILL_DIR CLAUDE_PROJECT_DIR CLAUDE_CODE_ENTRYPOINT; do
  val="${!v}"
  if [ -n "$val" ]; then echo "$v=SET  value=$val"; else echo "$v=UNSET"; fi
done
echo "--- substitution probe (literal placeholders) ---"
echo "literal_CLAUDE_PLUGIN_ROOT=[${CLAUDE_PLUGIN_ROOT}]"
echo "literal_CLAUDE_SKILL_DIR=[${CLAUDE_SKILL_DIR}]"
echo "--- parameter-expansion probe (bash syntax variants) ---"
echo "probe_no_braces=[$CLAUDE_PLUGIN_ROOT]"
echo "probe_default_form=[${CLAUDE_PLUGIN_ROOT:-SENTINEL_DEFAULT_HIT}]"
echo "probe_fake_default=[${NONEXISTENT_ALS_PROBE_VAR:-DEFAULT_TAKEN}]"
echo "--- PATH entries (plugin/als/claude) ---"
echo "$PATH" | tr ":" "\n" | grep -iE "(plugin|als|claude)" || echo "none"
echo "--- ALS plugin cache on disk ---"
ls -d "$HOME"/.claude/plugins/cache/*/als/* 2>/dev/null | sort -V || echo "no als cache match"
echo "--- highest ALS version ---"
latest=$(ls -d "$HOME"/.claude/plugins/cache/*/als/* 2>/dev/null | sort -V | tail -1)
if [ -n "$latest" ]; then echo "$latest"; else echo "none"; fi
echo "--- full CLAUDE_* / CLAUDECODE env dump ---"
env | grep -iE "^(CLAUDE|CLAUDECODE)" | sort || echo "none"
echo "===PHASE0_END==="
'`

## Phase 1 — Bash-tool probe

Now run the same checks via a Bash tool call that you invoke yourself. Use this command exactly as written — do not pre-expand the `${...}` placeholders, they must reach Bash literally so the probe can distinguish harness-side substitution from Bash-side env expansion:

```bash
bash <<'DIAGNOSTIC_EOF'
echo "===PHASE1_START==="
echo "--- phase: Bash-tool (agent-invoked, turn time) ---"
echo "--- entrypoint ---"
echo "CLAUDE_CODE_ENTRYPOINT=[${CLAUDE_CODE_ENTRYPOINT:-UNSET}]"
echo "CLAUDE_CODE_EXECPATH=[${CLAUDE_CODE_EXECPATH:-UNSET}]"
echo "CLAUDECODE=[${CLAUDECODE:-UNSET}]"
echo "CLAUDE_CODE_REMOTE=[${CLAUDE_CODE_REMOTE:-UNSET}]"
echo "--- target vars (env presence) ---"
for v in CLAUDE_PLUGIN_ROOT CLAUDE_SKILL_DIR CLAUDE_PROJECT_DIR CLAUDE_CODE_ENTRYPOINT; do
  val="${!v}"
  if [ -n "$val" ]; then echo "$v=SET  value=$val"; else echo "$v=UNSET"; fi
done
echo "--- substitution probe (literal placeholders) ---"
echo "literal_CLAUDE_PLUGIN_ROOT=[${CLAUDE_PLUGIN_ROOT}]"
echo "literal_CLAUDE_SKILL_DIR=[${CLAUDE_SKILL_DIR}]"
echo "--- parameter-expansion probe (bash syntax variants) ---"
echo "probe_no_braces=[$CLAUDE_PLUGIN_ROOT]"
echo "probe_default_form=[${CLAUDE_PLUGIN_ROOT:-SENTINEL_DEFAULT_HIT}]"
echo "probe_fake_default=[${NONEXISTENT_ALS_PROBE_VAR:-DEFAULT_TAKEN}]"
echo "--- PATH entries (plugin/als/claude) ---"
echo "$PATH" | tr ':' '\n' | grep -iE "(plugin|als|claude)" || echo "none"
echo "--- ALS plugin cache on disk ---"
ls -d "$HOME"/.claude/plugins/cache/*/als/* 2>/dev/null | sort -V || echo "no als cache match"
echo "--- highest ALS version ---"
latest=$(ls -d "$HOME"/.claude/plugins/cache/*/als/* 2>/dev/null | sort -V | tail -1)
if [ -n "$latest" ]; then echo "$latest"; else echo "none"; fi
echo "--- full CLAUDE_* / CLAUDECODE env dump ---"
env | grep -iE "^(CLAUDE|CLAUDECODE)" | sort || echo "none"
echo "===PHASE1_END==="
DIAGNOSTIC_EOF
```

## Phase 2 — Derive

Using the Phase 0 and Phase 1 outputs, determine:

### 2a. Platform code

From `CLAUDE_CODE_ENTRYPOINT` (use whichever phase reports it; if they disagree, note it):

| entrypoint value | platform code |
|------------------|---------------|
| `cli` | `ALS-PLAT-CCLI` |
| `claude-desktop` | `ALS-PLAT-CDSK` |
| `remote` | `ALS-PLAT-CWEB` *(cloud runner / web)* |
| anything else | `UNKNOWN-{entrypoint}` |

### 2b. Substitution behavior per phase

For each of `CLAUDE_PLUGIN_ROOT` and `CLAUDE_SKILL_DIR`, compare the literal-placeholder probe to env presence in **each phase**:

- `literal_X=[/some/path]` → harness **expanded** `${X}` before the script saw it.
- `literal_X=[]` AND env var UNSET → harness did NOT expand; the shell fell back to env, which was empty.
- `literal_X=[/some/path]` AND env var SET → harness did not necessarily expand; the shell expanded from env. Still a usable mechanism.

### 2c. Skill base-directory visibility in prompt

Look at the current prompt you (the model) were invoked with. If a line like `Base directory for this skill: <path>` is present, record the path. If absent, record `none visible`.

### 2d. Best-available plugin-root resolution

Evaluate these mechanisms in order. The first one that yields a valid path (in **either** phase) is the "most reliable" for this environment. Note which phase it worked in:

1. `$CLAUDE_PLUGIN_ROOT` present in subprocess env
2. `${CLAUDE_PLUGIN_ROOT}` harness-expanded into the command
3. `$CLAUDE_SKILL_DIR` present → derive plugin root as `$(dirname $(dirname "$CLAUDE_SKILL_DIR"))`
4. `${CLAUDE_SKILL_DIR}` harness-expanded into the command → derive as above
5. PATH contains `.../plugins/cache/*/als/*/bin` → strip trailing `/bin`
6. Filesystem `$HOME/.claude/plugins/cache/*/als/*` present → pick highest semver directory
7. None of the above → record `none resolvable`

## Phase 3 — Report

Produce the report below as your entire response to the operator. Do not add commentary, follow-up questions, or next-step prompts.

```markdown
# /als:whereami report

**Platform**: {CCLI | CDSK | CWEB | UNKNOWN-xxx}
**Entrypoint**: `{value}`  *(phase-0: {value}, phase-1: {value} — note if different)*
**Claude Code execpath**: `{value or UNSET}`
**Skill base directory (from prompt)**: {path or `none visible`}

## Per-phase substitution / env matrix

| Mechanism | Phase 0 (preprocessor) |   | Phase 1 (Bash-tool) |   |
|-----------|:----------------------:|:-:|:--------------------:|:-:|
|           | harness-expanded?      | env-set? | harness-expanded? | env-set? |
| `${CLAUDE_PLUGIN_ROOT}` | {y/n} | {y/n} | {y/n} | {y/n} |
| `${CLAUDE_SKILL_DIR}`   | {y/n} | {y/n} | {y/n} | {y/n} |
| `$CLAUDE_PROJECT_DIR`   | n/a   | {y/n} | n/a   | {y/n} |

## Environment surface

| Surface | Phase 0 | Phase 1 |
|---------|---------|---------|
| PATH contains plugin bin | {yes + value \| no} | {yes + value \| no} |
| `~/.claude/plugins/cache/*/als/*` on disk | {highest semver path \| not found} | {highest semver path \| not found} |

## Verdict

**Most reliable ALS-plugin-root resolution mechanism here**: {named mechanism from 2d}
**Which phase exposed it**: {phase-0 only | phase-1 only | both}
**Resolved plugin root**: `{actual path or "none resolvable"}`

**Delta between phases**: {summary of any differences — e.g., "Phase 0 had `CLAUDE_SKILL_DIR` set but Phase 1 did not", or "identical"}

## Phase 0 raw output

\`\`\`
{paste verbatim between ===PHASE0_START=== and ===PHASE0_END===}
\`\`\`

## Phase 1 raw output

\`\`\`
{paste verbatim between ===PHASE1_START=== and ===PHASE1_END===}
\`\`\`
```
