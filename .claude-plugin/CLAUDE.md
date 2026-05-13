# Claude Plugin Surface

Claude Code loads the five per-hook JSON files declared in [`plugin.json`](./plugin.json). Those files live in [`../hooks/`](../hooks/) and are a different launcher surface from Codex's bundled [`../hooks/hooks.json`](../hooks/hooks.json).

The platform split, placeholder families, and adapter map are documented in [`../hooks/CLAUDE.md`](../hooks/CLAUDE.md). On the Claude side, use `${CLAUDE_PLUGIN_ROOT}` only.
