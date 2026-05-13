# Claude Plugin Surface

Claude Code loads the five per-hook JSON files declared in [`plugin.json`](./plugin.json). Those files now live under [`../hooks/claude/`](../hooks/claude/) and are a different launcher surface from Codex's bundled [`../hooks/codex/hooks.json`](../hooks/codex/hooks.json).

The platform split, placeholder families, poisoned-root-path rule, and adapter map are documented in [`../hooks/CLAUDE.md`](../hooks/CLAUDE.md). On the Claude side, use `${CLAUDE_PLUGIN_ROOT}` only.
