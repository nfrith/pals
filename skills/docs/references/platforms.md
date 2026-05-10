# Platform Support

ALS is built to run across multiple agent harnesses and surfaces. Each supported surface has a stable `ALS-PLAT-XXXX` code used throughout the codebase.

The goal is to DESIGN/BRAINSTORM as if every platform were supported. When implementation hits reality, we go by implementation. The matrix below reflects the current implementation state.

## Matrix

| Code | Harness | Surface | Runtime signal | Status |
|------|---------|---------|----------------|--------|
| `ALS-PLAT-CCLI` | Claude Code | CLI | `$CLAUDE_CODE_ENTRYPOINT=cli` | Supported |
| `ALS-PLAT-CXCLI` | Codex | CLI | `$CODEX_THREAD_ID` | Supported |
| `ALS-PLAT-CCWK` | Claude Cowork | Desktop/app | *(unknown)* | Planned |
| `ALS-PLAT-CDSK` | Claude Code Desktop | Desktop | `$CLAUDE_CODE_ENTRYPOINT=claude-desktop` | Planned |
| `ALS-PLAT-CWEB` | Claude Code Web | Web | `$CLAUDE_CODE_ENTRYPOINT=remote` | Planned |

**Runtime signal** is the harness-specific signal used when one is available. For Claude Code, the listed `$CLAUDE_CODE_ENTRYPOINT` values were observed via [`/als:whereami`](../../../skills/whereami/SKILL.md) runs on 2026-04-17 for CLI, Desktop, and Web. `ALS-PLAT-CCWK` has not been observed yet. For Codex CLI, `$CODEX_THREAD_ID` is the strongest live-process signal observed in Codex-run Bash tool subprocesses; installed plugin paths and Codex-native projections remain valid fallback signals.

## Referencing a platform

When referencing a platform anywhere in the codebase, use the `Code` column with a formal markdown link back to this file:

```markdown
[`ALS-PLAT-CCLI`](nfrith-repos/als/skills/docs/references/platforms.md)
```

Never use bare platform codes without a link.

## Runtime detection

Skills and tools that need to branch on platform should first read `ALS_PLATFORM_CODE` from `skills/lib/runtime-env.sh`. If the helper cannot provide a platform code, identify the registered harness target and derive the platform from the strongest harness-specific signal. The current supported targets are `claude` and `codex`.

For Claude, read `$CLAUDE_CODE_ENTRYPOINT` and map to the corresponding code via the Runtime signal column above. Do not infer Claude platform from install-mode signals.

For Codex, prefer `$CODEX_THREAD_ID` when detecting the live harness in a subprocess. Fall back to the Codex harness target selected by plugin packaging, skill projection, or `alsc deploy codex`.
