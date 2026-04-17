# Platform Support

ALS is built to run across multiple Claude platforms. Each platform has a stable `ALS-PLAT-XXXX` code used throughout the codebase and a runtime identifier reported by Claude Code via `$CLAUDE_CODE_ENTRYPOINT`.

The goal is to DESIGN/BRAINSTORM as if every platform were supported. When implementation hits reality, we go by implementation. The matrix below reflects the current implementation state.

## Matrix

| Code | Platform | Entrypoint | Status |
|------|----------|------------|--------|
| `ALS-PLAT-CCLI` | Claude Code CLI | `cli` | Supported |
| `ALS-PLAT-CCWK` | Claude Cowork | *(unknown)* | Planned |
| `ALS-PLAT-CDSK` | Claude Code Desktop | `claude-desktop` | Planned |
| `ALS-PLAT-CWEB` | Claude Code Web | `remote` | Planned |

**Entrypoint** is the value Claude Code exposes as `$CLAUDE_CODE_ENTRYPOINT` when running inside that platform. Observed values were captured via [`/als:whereami`](../../../skills/whereami/SKILL.md) runs on 2026-04-17 (CLI, Desktop, Web). `ALS-PLAT-CCWK` has not been observed yet.

## Referencing a platform

When referencing a platform anywhere in the codebase, use the `Code` column with a formal markdown link back to this file:

```markdown
[`ALS-PLAT-CCLI`](nfrith-repos/als/skills/docs/references/platforms.md)
```

Never use bare platform codes without a link.

## Runtime detection

Skills and tools that need to branch on platform should read `$CLAUDE_CODE_ENTRYPOINT` and map to the corresponding code via the Entrypoint column above. Do not attempt to infer platform from other environment signals (PATH entries, plugin cache paths, presence of `CLAUDE_PLUGIN_ROOT`, etc.) — those vary by install mode, not platform.
