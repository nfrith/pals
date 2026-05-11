# Platform Support

ALS now spans two related axes:

- **Authoring harness** — where ALS is discovered, installed, and invoked as a plugin
- **Runtime platform** — the concrete runtime surface the compiler deploys into and identifies with `ALS-PLAT-XXXX` codes

Codex is now a sibling authoring harness on the install surface. Claude remains the only fully supported runtime harness today, so the concrete `ALS-PLAT-XXXX` codes below still describe Claude runtime platforms only.

The goal is to DESIGN/BRAINSTORM as if every platform were supported. When implementation hits reality, we go by implementation.

## Authoring Harnesses

| Harness | Install surface | Status | Notes |
|---------|-----------------|--------|-------|
| Claude Code | `.claude-plugin/plugin.json` plus Claude marketplace metadata | Supported | Full preview workflow today |
| Codex | `.codex-plugin/plugin.json` plus `.agents/plugins/marketplace.json` | Install surface only | Marketplace discovery/install ship in ALS-097. Skill portability, hooks, and runtime projection stay follow-up work |

## Runtime Platform Matrix

| Code | Harness | Platform | Entrypoint | Status |
|------|---------|----------|------------|--------|
| `ALS-PLAT-CCLI` | Claude Code | Claude Code CLI | `cli` | Supported |
| `ALS-PLAT-CCWK` | Claude Code | Claude Cowork | *(unknown)* | Planned |
| `ALS-PLAT-CDSK` | Claude Code | Claude Code Desktop | `claude-desktop` | Supported |
| `ALS-PLAT-CWEB` | Claude Code | Claude Code Web | `remote` | Planned |

**Entrypoint** is the value Claude Code exposes as `$CLAUDE_CODE_ENTRYPOINT` when running inside that platform. Observed values were captured via [`/als:whereami`](../../../skills/whereami/SKILL.md) runs on 2026-04-17 (CLI, Desktop, Web). `ALS-PLAT-CCWK` has not been observed yet.

## Codex Placeholder

ALS does **not** have a locked `ALS-PLAT-XXXX` code for Codex yet.

- Codex is real on the **authoring-harness install surface**
- Codex is **not** yet a locked ALS runtime-platform code
- The exact Codex runtime-detection signal for future console/runtime branching is still **TBD**

## Referencing a platform

When referencing a platform anywhere in the codebase, use the `Code` column with a formal markdown link back to this file:

```markdown
[`ALS-PLAT-CCLI`](nfrith-repos/als/skills/docs/references/platforms.md)
```

Never use bare platform codes without a link.

## Runtime detection

For the current Claude runtime surfaces, skills and tools that need to branch on platform should read `$CLAUDE_CODE_ENTRYPOINT` and map to the corresponding code via the runtime matrix above.

Do not attempt to infer a future Codex runtime-platform code from cache paths, plugin roots, PATH entries, or other install-mode signals. ALS has not locked that contract yet. When documentation needs to mention Codex today, describe it as an authoring-harness install surface, not as a settled runtime-platform code.
