---
name: install
description: Bootstrap ALS into a fresh project and create the first module. Use this when the operator is starting from zero, wants to make the current project ALS-aware, or needs the first-touch onboarding flow before `/new`.
allowed-tools: AskUserQuestion, Bash(bash *), Read, Write, Edit
---

# install

You are the first-touch ALS onboarding flow. Take a project from zero to a working ALS system with its first module. Optimize for feel: the operator should see a welcome, a short but real interview, bootstrap files appear, validation run, Claude assets deploy, and clear next steps.

This is exploratory. Prefer a concrete, runnable first pass over production hardening. Placeholders and TODO scaffolds are acceptable when the language contract requires more design later.

Before authoring anything, read:

- `../new/SKILL.md` — reuse its Phase 2 interview, Phase 3 proposal, skill authoring, and Delamain bundle rules for the first module. `/install` owns onboarding and bootstrap; `/new` remains the canonical add-module contract.
- `../docs/references/shape-language.md`
- `../docs/references/skill-patterns.md`
- `../docs/references/delamain-dispatcher.md`
- `references/first-touch-flow.md`
- `references/platform-detection.md`
- `references/bootstrap-templates.md`
- `references/final-report.md`

## Phase 0: Welcome

Use `references/first-touch-flow.md` to open the interaction. The operator should understand that `/install` will:

1. verify prerequisites
2. detect and acknowledge the ALS platform code
3. interview for the first module
4. bootstrap `.als/`
5. validate and deploy Claude assets

Do not ask the operator to open a terminal. Use Claude tools from inside the session.

## Phase 1: Runtime prerequisites

Before interviewing, verify the install can succeed.

1. Confirm the plugin root resolves via harness substitution of `${CLAUDE_PLUGIN_ROOT}`. The harness rewrites this placeholder to an absolute path before Bash executes the command. Do not use the `${VAR:-default}` fancy form — it may not be substituted by the harness on all platforms. Use the bare form:

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}"
if [ -d "$PLUGIN_ROOT" ] && [ -f "$PLUGIN_ROOT/alsc/compiler/src/cli.ts" ]; then
  printf 'PLUGIN_ROOT=%s\n' "$PLUGIN_ROOT"
else
  echo "PLUGIN_ROOT_INVALID: $PLUGIN_ROOT"
fi
```

If `PLUGIN_ROOT_INVALID` is reported, the harness did not substitute `${CLAUDE_PLUGIN_ROOT}` to a valid ALS plugin path. Stop and tell the operator install cannot proceed.

2. Run `which bun` to check if Bun is on PATH.
   - If not found, tell the operator: "ALS requires Bun to run the compiler. You can install it by typing `! curl -fsSL https://bun.sh/install | bash` and then restarting your shell." Do not proceed until Bun is available.

3. Run `which jq` to check if jq is on PATH.
   - If not found, tell the operator: "ALS hooks require jq. Install it with your package manager (e.g. `! sudo apt-get install -y jq` or `! brew install jq`)." Do not proceed until jq is available.

4. Run `cd ${CLAUDE_PLUGIN_ROOT}/alsc/compiler && bun install` to ensure compiler dependencies are installed. This is idempotent and fast when dependencies already exist.

Report the successful prerequisite check before continuing.

## Phase 2: Platform detection

Follow `references/platform-detection.md`.

- Produce one explicit platform acknowledgement using [`ALS-PLAT-CCLI`](nfrith-repos/als/skills/docs/references/platforms.md) or [`ALS-PLAT-CDSK`](nfrith-repos/als/skills/docs/references/platforms.md).
- If the platform is ambiguous, use AskUserQuestion to confirm.
- Do not branch behavior yet beyond acknowledgement. Call out that platform-specific install behavior is future work.

## Phase 3: Existing-system guard

Check whether `.als/system.ts` already exists in the working directory.

- If it exists, read it, summarize the `system_id` and current modules, then stop.
- Tell the operator `/install` will not overwrite an existing ALS system and direct them to `/new` for another module or `/change` for schema evolution.
- Re-running `/install` in an existing system is a safe refusal, not a repair path.

## Phase 4: First-module interview

This is still the `/new` interview, but in a fresh system.

1. Start with the same opening question as `/new`: "What do you need to track? Describe the domain in your own words — what are the things, how do they relate, and what matters about them?"

2. Establish `system_id`. If there are multiple viable ids, use AskUserQuestion to present 2-3 normalized options plus Other.

3. Establish the first module's scope and `module_id`. Challenge over-broad first modules; the first module should feel coherent and teach the shape cleanly.

4. Establish the mount path. It must:
   - be relative to the system root
   - not be `.als` or `.claude`
   - not collide with paths you are about to create

5. Follow `../new/SKILL.md` Phase 2 and Phase 3 for:
   - entity decomposition
   - fields
   - sections
   - skill-pattern selection
   - Delamain design when needed
   - proposal and operator approval

When adapting `/new`'s guidance:

- There are no existing modules yet, so dependency and cross-module reference checks are usually empty on the first pass.
- Keep the initial skill set minimal but complete-feeling. One well-scoped module is better than a sprawling first install.
- Explicitly confirm the initial skill ids before writing `.als/system.ts`.

Do not write files until the operator approves the proposal.

## Phase 5: Bootstrap and author

Once approved, create the first ALS system.

1. Create `.als/` and `.als/modules/`.
2. Create `.als/authoring.ts` using `references/bootstrap-templates.md`. Resolve the absolute compiler import path from `${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/authoring/index.ts`.
3. Create `.als/system.ts` using the same reference. Register the first module with version `1`, its mount path, and the final skill id list.
4. Create the module version bundle at `.als/modules/{module_id}/v1/`.
5. Create the module's authored entrypoint at `.als/modules/{module_id}/v1/module.ts`.
6. If the module has skills, create `.als/modules/{module_id}/v1/skills/` and each `SKILL.md`.
7. If a Delamain was designed, create `.als/modules/{module_id}/v1/delamains/{delamain-name}/...` and follow the Delamain bundle authoring rules from `../new/SKILL.md`, including copying the dispatcher template from `${CLAUDE_PLUGIN_ROOT}/skills/new/references/dispatcher/`.
8. Create the mounted data directory at `{path}/`.
9. Create the empty subdirectory tree implied by the path templates.
10. Do not hand-author `.als/CLAUDE.md`. That file is generated by `deploy claude`.

## Phase 6: Validate and deploy

With the authored system in place, run the full first-touch verification flow:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts validate <system-root>
```

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts deploy claude --dry-run --require-empty-targets <system-root>
```

Confirm the dry-run is clean and includes the planned `.als/CLAUDE.md` write.

If the dry-run reports target collisions under `.claude/` or Delamain name conflicts, stop and resolve them with the operator before live deploy.

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts deploy claude <system-root>
```

The deployed result should include `.claude/skills/...` and, when applicable, `.claude/delamains/...`.

## Phase 7: Final report

Use `references/final-report.md`.

Report:

- acknowledged platform code
- prerequisite checks (`bun`, `jq`, `CLAUDE_PLUGIN_ROOT`)
- authored files and directories
- validation and deploy results
- whether a Delamain bundle was included
- next commands: `/new`, `/change`, `/validate`

If the operator re-runs `/install` after a successful bootstrap, refuse destructive changes and redirect them to `/new` or `/change`.
