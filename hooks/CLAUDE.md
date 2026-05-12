# ALS Hooks

The four compiler-owned hooks now run as Bun TypeScript adapters above the public compiler hook-runtime boundary at `alsc/compiler/src/hook-runtime.ts`. The normative decision is [SDR 053](../sdr/053-public-hook-runtime-api-and-harness-adapter-contract.md); ALS-099's load-bearing rationale note lives at [`../../als-factory/artifacts/ALS-099/hook-runtime-public-api-architecture.md`](../../als-factory/artifacts/ALS-099/hook-runtime-public-api-architecture.md).

ALS-104 adds the Codex hook bundle at [`hooks.json`](./hooks.json) and keeps the same semantic runtime. The load-bearing Codex rationale note is [`../../als-factory/artifacts/ALS-104/codex-hook-wiring-architecture.md`](../../als-factory/artifacts/ALS-104/codex-hook-wiring-architecture.md): plugin-bundled wiring only, no fake `SessionEnd`, and no Codex-specific semantic fork below the adapter seam.

Claude still launches commands from `${CLAUDE_PLUGIN_ROOT}/hooks/*.json`. Codex loads the bundled `./hooks/hooks.json` from the installed plugin copy and launches those same TypeScript entrypoints through `${PLUGIN_ROOT}`. In both cases the adapters derive the plugin root from `import.meta.url` instead of treating child-process env inheritance as the only boundary.

## Hook inventory

### operator-config-session-start.ts (SessionStart)

On session start, walks up from the reported `cwd`, finds the current ALS system root, and resolves the ALS v5 operator-config surface: `<system_root>/.als/operator-roster.ts` plus the machine-local selector at `<system_root>/.als/local/active-operator.json`. If no ALS system root is found or the current ALS system contains `.als/skip-operator-config`, it injects nothing. If the roster or selector is missing or invalid, it injects hard remediation telling the operator to run `/configure-operator` or finish the `v4 -> v5` migration; it never reads legacy `.als/operator.md` at runtime.

### als-validate.ts (PostToolUse — Write|Edit on Claude, apply_patch|Edit|Write on Codex)

After file-edit operations, validates the affected module and blocks further edits if validation fails. This is the inline feedback loop — it catches errors immediately. The adapter only handles harness stdin/stdout and exit-code translation; compiler semantics live in `alsc/compiler/src/hook-runtime.ts`.

Silent on clean success. Warn-only validation stays non-blocking but emits immediate context so deprecated-value usage is visible during the edit loop. On failure, outputs a structured JSON block decision with compiler diagnostics. The Codex adapter parses `tool_input.command` for `*** Add File:`, `*** Update File:`, `*** Delete File:`, and `*** Move to:` entries, then dedupes validation runs by touched module so one multi-file patch does not validate the same module repeatedly.

### als-breadcrumb.ts (PostToolUse — Write|Edit on Claude, apply_patch|Edit|Write on Codex)

After file-edit operations, records which ALS system and module were touched to a session-scoped breadcrumb file at `/tmp/als-touched-${session_id}`. Does not run the compiler. Does not block.

This hook exists so the stop gate knows what to validate without scanning the whole filesystem.

TODO: Does not capture Bash-based file mutations (e.g. `echo ... > file.md`).

### als-stop-gate.ts (Stop)

Before Claude finishes, reads the breadcrumb file for this session. If ALS systems/modules were touched, validates only those. Blocks stop if any have errors.

Claude keeps the warn-only reminder summary through `hookSpecificOutput.additionalContext`. Codex uses the safe ALS-104 contract instead: clean or warn-only success exits silently, and only hard failures emit a JSON block decision. If no breadcrumb file exists (session didn't touch ALS files), exits immediately — no validation, no blocking.

ALS-105 locks the Codex side of that contract and records the rationale in [`../../als-factory/artifacts/ALS-105/codex-stop-no-slot-architecture.md`](../../als-factory/artifacts/ALS-105/codex-stop-no-slot-architecture.md). Current official Codex `Stop` docs only allow common output fields plus `decision: "block"` continuation output on `stdout` ([docs](https://developers.openai.com/codex/hooks)), and the generated `stop.command.output` schema omits `hookSpecificOutput` entirely while setting `additionalProperties: false` ([schema](https://raw.githubusercontent.com/openai/codex/main/codex-rs/hooks/schema/generated/stop.command.output.schema.json)).

That absence is structural, not just undocumented. The generated Codex `PostToolUse`, `SessionStart`, and `UserPromptSubmit` output schemas do declare `hookSpecificOutput.additionalContext`, which is why ALS uses a Codex additional-context writer for `PostToolUse` but not for `Stop`.

ALS therefore treats Codex `Stop` as a confirmed platform limitation:
- no named non-blocking additional-context slot exists there today
- `systemMessage` is not treated as a replacement contract
- `hookSpecificOutput` is invalid on Codex `Stop` and must not be emitted

### delamain-stop.sh (SessionEnd)

On session end, kills running delamain dispatchers and removes their heartbeat files (`status.json`). Skips cleanup when reason is `clear` or `resume` — dispatchers survive those transitions.

The hook also appends one JSONL entry to `{SYSTEM_ROOT}/.claude/scripts/.cache/pulse/sessionend.log` for every invocation, including skipped `clear` / `resume` exits. When pulse is running, the hook records the target PID before attempting the SessionEnd reap signal. Pulse uses that breadcrumb plus its own `shutdown.log` entries to diagnose whether a shutdown came from the hook path or from its parent shell.

Dispatchers live and die with their Claude session. On next session start, `delamain-start.sh` detects them as offline and suggests restarting.

`delamain-stop.sh` is intentionally outside SDR 053's compiler-owned cohort. It stays on its shell/lifecycle boundary until a lifecycle-focused job reopens that contract explicitly.

## Environment variables

### `ALS_DEMO_MODE`

When set to `"1"`, `als-validate.ts` and `als-stop-gate.ts` skip all validation. Used by the reference-system [`/run-demo`](../reference-system/.claude/skills/run-demo/SKILL.md) traffic generators so seed agents can write items without triggering the compiler on every write.

## Requirements

- Bun must be installed and on `$PATH`.
- Claude hook wiring requires `${CLAUDE_PLUGIN_ROOT}` substitution.
- Codex hook wiring requires the installed plugin bundle to resolve `${PLUGIN_ROOT}` in `hooks/hooks.json`.
