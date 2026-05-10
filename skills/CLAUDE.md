# ALS Skills

Shared conventions for ALS skill authoring.

## Runtime Resolution

Operational skills resolve ALS paths through the shared runtime helper:

```bash
bash {skill-dir}/../lib/runtime-env.sh plugin
bash {skill-dir}/../lib/runtime-env.sh <system-root-or-current-directory>
```

Use the emitted `ALS_PLUGIN_ROOT`, `HARNESS`, `ALS_PLATFORM_CODE`, `SYSTEM_ROOT`, `SKILLS_ROOT`, `DELAMAINS_ROOT`, `SYSTEM_INSTRUCTION_PATH`, and `TRANSACTION_ROOTS` values instead of hard-coding Claude-only paths. `HARNESS` is currently `claude` or `codex`; code and instructions should treat harnesses as an open set where possible.

Harness detection uses, in order: explicit request / `ALS_HARNESS`, live process env (`CODEX_THREAD_ID` or `CLAUDE_CODE_ENTRYPOINT`), installed plugin cache path, then system projection roots. When running directly from a source checkout with no live harness env, pass an explicit harness (`plugin codex`, `plugin claude`, or `ALS_HARNESS=codex`) unless a system projection already makes the harness unambiguous. The helper must not silently invent `claude` for source checkouts.

Manifest paths are also harness-specific. For `claude`, `ALS_PLUGIN_MANIFEST_PATH` points at `.claude-plugin/plugin.json` and `ALS_MARKETPLACE_MANIFEST_PATH` points at `.claude-plugin/marketplace.json`. For `codex`, they point at `.codex-plugin/plugin.json` and `.agents/plugins/marketplace.json`.

For sourced scripts, use:

```bash
source "$SCRIPT_DIR/../lib/runtime-env.sh"
als_runtime_init_env "${ALS_HARNESS:-}" "$(pwd)"
```

If the script intentionally accepts a `claude|codex` harness override as its first argument, pass that argument as the first parameter to `als_runtime_init_env`.

## Legacy Claude Substitution

Older Claude-only skills resolved the plugin root via harness substitution of `${CLAUDE_PLUGIN_ROOT}` in Bash commands. Keep this only for legacy diagnostics such as `/whereami` or docs that are explicitly describing Claude Code behavior.

When you must probe Claude substitution, use the bare form `${CLAUDE_PLUGIN_ROOT}`. The following forms are not equivalent because Bash may fall back to an empty subprocess env:

- `$CLAUDE_PLUGIN_ROOT` (missing braces)
- `${CLAUDE_PLUGIN_ROOT:-default}` or other parameter-expansion forms (`:-`, `:?`, `:+`, etc.)

When propagating a resolved plugin root to child processes, prefer the harness-neutral variable:

```bash
ALS_PLUGIN_ROOT=${ALS_PLUGIN_ROOT} bun run ...
```

Claude substitution behavior was confirmed on [`ALS-PLAT-CCLI`](docs/references/platforms.md) and [`ALS-PLAT-CDSK`](docs/references/platforms.md) (2026-04-17 via [`/als:whereami`](whereami/SKILL.md)). Codex support uses the runtime helper and Codex-native projection roots instead of Claude substitution.
