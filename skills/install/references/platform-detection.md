# Platform Detection

The platform is read from the ALS runtime helper first. Do not infer from chat context, ambient tools, or arbitrary environment variables. Use [`platforms.md`](../../docs/references/platforms.md) as the canonical mapping source.

## Procedure

### 1. Primary — read the runtime helper

Run via Bash:

```bash
bash {skill-dir}/../lib/runtime-env.sh plugin
```

Extract `HARNESS` and `ALS_PLATFORM_CODE` from the output.

- If `ALS_PLATFORM_CODE` is non-empty, acknowledge that `ALS-PLAT-XXXX` code in one line and skip step 2.
- If `HARNESS` is `codex` and `ALS_PLATFORM_CODE` is missing, map to [`ALS-PLAT-CXCLI`](../../docs/references/platforms.md). Codex is currently supported only as the CLI harness surface.
- If `HARNESS` is `claude` and `ALS_PLATFORM_CODE` is missing, read `$CLAUDE_CODE_ENTRYPOINT` and map it using [`platforms.md`](../../docs/references/platforms.md). If it maps, acknowledge that platform code and skip step 2.

### 2. Fallback — ask in plain language, then map

Reach this only when the runtime helper cannot resolve a platform code and the Claude entrypoint fallback is unset or unrecognized.

Use AskUserQuestion with one neutral free-text option and rely on the open-input slot. Do not enumerate technical platform codes; the operator may not know them.

- Header: `Platform`
- Question: `Where are you running this install? (e.g. Codex CLI, Claude Code Desktop app, Claude Code CLI in a terminal, Claude Code in a browser, Claude Cowork.)`
- Options: one neutral free-text option such as `Type your platform`

Take the operator's free-text answer and match it against [`platforms.md`](../../docs/references/platforms.md). Try the platform name (`Codex CLI`, `Claude Code Desktop`, `Desktop`, `Claude Cowork`, etc.), the runtime signal (`CODEX_THREAD_ID`, `claude-desktop`, `cli`, `remote`), the bare platform code (`CXCLI`, `CDSK`, `CCLI`, `CWEB`, `CCWK`), and the full platform code (`ALS-PLAT-CXCLI`, `ALS-PLAT-CDSK`, etc.). All point to the same row.

- If the answer maps cleanly, acknowledge that platform code.
- If it does not map, halt with: `Cannot acknowledge platform. HARNESS='<value or empty>'; ALS_PLATFORM_CODE='<value or empty>'; CLAUDE_CODE_ENTRYPOINT='<value or empty>'; CODEX_THREAD_ID='<set or empty>'. Operator answer: '<answer>'. None matches platforms.md. Please report this to the architect; the install cannot continue without a recognized platform code.`

After detection:

- Restate the chosen platform code explicitly.
- Say that platform-specific branching is future work unless the current skill already has an explicit platform branch.
- Do not invent new ALS platform codes or silently omit the acknowledgement.
