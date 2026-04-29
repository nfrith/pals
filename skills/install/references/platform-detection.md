# Platform Detection

The platform is read deterministically from `$CLAUDE_CODE_ENTRYPOINT`. Do not infer from chat context, ambient tools, or other environment signals. Use [`nfrith-repos/als/skills/docs/references/platforms.md`](nfrith-repos/als/skills/docs/references/platforms.md) as the canonical mapping source.

## Procedure

### 1. Primary — read the env var

Run via Bash: `echo "$CLAUDE_CODE_ENTRYPOINT"`.

Map the value per the Entrypoint column in [`nfrith-repos/als/skills/docs/references/platforms.md`](nfrith-repos/als/skills/docs/references/platforms.md). If it matches a row, acknowledge the corresponding `ALS-PLAT-XXXX` code in one line and skip step 2.

### 2. Fallback — ask in plain language, then map

Reach this only when `$CLAUDE_CODE_ENTRYPOINT` is unset or holds a value not present in [`nfrith-repos/als/skills/docs/references/platforms.md`](nfrith-repos/als/skills/docs/references/platforms.md).

Use AskUserQuestion with one neutral free-text option and rely on the open-input slot. Do not enumerate technical platform codes; the operator may not know them.

- Header: `Platform`
- Question: `Where are you running this install? (e.g. Claude Code Desktop app, Claude Code CLI in a terminal, Claude Code in a browser, Claude Cowork.)`
- Options: one neutral free-text option such as `Type your platform`

Take the operator's free-text answer and match it against [`nfrith-repos/als/skills/docs/references/platforms.md`](nfrith-repos/als/skills/docs/references/platforms.md). Try the platform name (`Claude Code Desktop`, `Desktop`, `Claude Cowork`, etc.), the entrypoint string (`claude-desktop`, `cli`, `remote`), the bare platform code (`CDSK`, `CCLI`, `CWEB`, `CCWK`), and the full platform code (`ALS-PLAT-CDSK`, etc.). All point to the same row.

- If the answer maps cleanly, acknowledge that platform code.
- If it does not map, halt with: `Cannot acknowledge platform. $CLAUDE_CODE_ENTRYPOINT = '<value or empty>'. Operator answer: '<answer>'. Neither matches platforms.md. Please report this to the architect; the install cannot continue without a recognized platform code.`

After detection:

- Restate the chosen platform code explicitly.
- Say that platform-specific branching is future work.
- Do not invent new ALS platform codes or silently omit the acknowledgement.
