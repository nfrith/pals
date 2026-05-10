# Codex Harness Projection Contract

## Status

Accepted

## Context

- ALS already projects Claude Code runtime assets through `alsc deploy claude`.
- Codex has different native locations for repo skills, lifecycle hooks, and project instructions.
- ALS needs Codex support without changing the ALS language, authored data model, or existing Claude behavior.

## Decision

- ALS has registered harness targets. The current supported targets are `claude` and `codex`.
- `alsc deploy claude` remains the Claude projection command.
- `alsc deploy codex` is the Codex projection command.
- Claude projection writes generated skills to `.claude/skills`, Delamain runtime bundles to `.claude/delamains`, and system guidance to `.als/CLAUDE.md`.
- Codex projection writes generated skills to `.agents/skills`, Delamain runtime bundles to `.codex/delamains`, and system guidance to `.als/AGENTS.md`.
- Codex plugin packaging uses `.codex-plugin/plugin.json`, bundled skills through `skills`, and bundled lifecycle config through `hooks/codex-hooks.json`.
- The canonical ALS plugin root environment variable is `ALS_PLUGIN_ROOT`. `CLAUDE_PLUGIN_ROOT` is accepted as a Claude compatibility alias.

## Normative Effect

- Required: Codex-generated files must not use `.claude` as their harness namespace.
- Required: Codex PostToolUse hooks must adapt Codex file edit payloads into the shared ALS file-path validation contract.
- Required: Codex `apply_patch` inputs must recognize `*** Add File:`, `*** Update File:`, `*** Delete File:`, and `*** Move to:` headers as changed files.
- Required: Codex Stop hooks must emit valid JSON when they emit stdout.
- Required: Claude plugin and projection behavior remains supported.
- Allowed: Projects may carry both Claude and Codex projections at the same time.
- Allowed: Claude compatibility code may continue to read `CLAUDE_PLUGIN_ROOT` after checking `ALS_PLUGIN_ROOT`.
- Rejected: Codex workflows depending on `CLAUDE_CODE_ENTRYPOINT` for platform detection.
- Rejected: Adding fake Codex SessionEnd hooks.

## Compiler Impact

- The deploy planner must be harness-aware.
- `deploy claude` keeps the existing public output shape and paths.
- `deploy codex` emits Codex paths and the `als-codex-deploy-output@1` schema.
- Delamain runtime manifests may record the harness target.
- Transient runtime hygiene must ignore equivalent Codex runtime files under `.codex/delamains`.

## Docs and Fixture Impact

- Platform reference docs must describe harness and surface separately.
- Codex CLI is the first Codex-supported surface.
- Tests must cover Codex projection paths, Codex hook path extraction, and Claude regression behavior.
- User-facing install/update docs must stop presenting slash commands as the only invocation surface when documenting Codex.

## Alternatives Considered

- Reuse `.claude` for Codex runtime files. Rejected because it hides harness ownership and couples Codex behavior to Claude implementation details.
- Rename the OpenAI Delamain provider to `codex`. Rejected because provider names currently describe model vendors, while harness names describe runtime surfaces.
- Depend on an undocumented Codex plugin-root environment variable. Rejected because Codex docs do not define one.
