---
name: install
description: Bootstrap ALS into a fresh project — author the empty skeleton (`.als/authoring.ts`, `.als/system.ts` with an empty `modules: {}`), validate and deploy it, then hand off to `/foundry` or `/new` for module work. Use this when the operator is starting from zero on a non-ALS project.
allowed-tools: AskUserQuestion, Bash(bash *), Read, Write, Edit, Skill
---

# install

You are the first-touch ALS onboarding flow. Take a project from zero to a bootstrapped ALS system — `.als/system.ts` with the operator's chosen system id and an empty `modules: {}` block — validate it, deploy the Claude projection, then hand off to `/foundry` (curated pre-built modules) or `/new` (author a module from scratch). **First-module authoring is not this skill's job.**

Before authoring anything, read:

- `references/first-touch-flow.md`
- `references/platform-detection.md`
- `references/bootstrap-templates.md`
- `references/final-report.md`

## Phase 0: Welcome

Use `references/first-touch-flow.md` to open the interaction. The operator should understand that `/install` will:

1. verify prerequisites
2. detect and acknowledge the ALS platform code
3. ask for a `system_id`
4. bootstrap `.als/` with an empty modules block
5. validate and deploy the Claude projection
6. ask what to do next and hand off to the matching skill

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

4. Run `which git` to check if git is on PATH.
   - If not found, tell the operator: "ALS requires git. Every pipeline transition creates a commit, so the system cannot operate in a non-git workspace. Install git for your platform, then restart and re-run `/install`." Do not proceed until git is available.

5. Run `cd ${CLAUDE_PLUGIN_ROOT}/alsc/compiler && bun install` to ensure compiler dependencies are installed. This is idempotent and fast when dependencies already exist.

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

## Phase 4: Establish system_id

Ask the operator for a `system_id`. Use a single AskUserQuestion:

- **Header**: `System ID`
- **Question**: "What should this ALS system be called? The `system_id` lives in `.als/system.ts` and is surfaced in logs, deploys, and dashboard output. Short, slug-cased."
- **Options** (fixed — do not substitute based on working directory):
  1. `personal-assistant` — label: `personal-assistant (Recommended)`, description: `Recommended default for a personal ALS system.`
  2. `workspace` — description: `Generic default for a shared workspace.`
  3. `personal` — description: `Generic default for a solo/personal system.`
- Operator can always use Other to type their own slug.

Do not interview for modules, entities, skills, or delamains here. Those belong to `/new` (create from scratch) or `/foundry` (pull from the curated shelf), both invoked in Phase 7.

## Phase 5: Bootstrap the skeleton

With `system_id` chosen, write the authored skeleton. Follow `references/bootstrap-templates.md` for exact contents.

1. Create `.als/` and `.als/modules/` (the latter an empty directory).
2. Write `.als/authoring.ts`. Resolve the compiler import path from `${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/authoring/index.ts`.
3. Write `.als/system.ts` with `als_version: 1`, the chosen `system_id`, and an empty `modules: {}` block.

Do not author any modules, skills, or delamains. Those arrive via `/new` or `/foundry` in Phase 7.

Do not hand-author `.als/CLAUDE.md` — that is generated by `deploy claude` in Phase 6.

## Phase 6: Validate and deploy the skeleton

Validate:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts validate <system-root>
```

An empty `modules: {}` record is valid — this should pass clean.

Dry-run the Claude projection:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts deploy claude --dry-run --require-empty-targets <system-root>
```

Confirm the dry-run is clean and includes the planned `.als/CLAUDE.md` write. If it reports target collisions, stop and resolve with the operator before live deploy.

Live deploy:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts deploy claude <system-root>
```

The skeleton deploy produces `.claude/CLAUDE.md` and an otherwise empty projection surface. Modules and their projections arrive when the operator runs the next skill.

If any step fails, stop — do not proceed to Phase 7.

## Phase 7: Pick next step and hand off

Skeleton is live. Ask the operator what they want to do next via a single AskUserQuestion:

- **Header**: `Next`
- **Question**: "Skeleton is live. What next?"
- **Options**:
  1. `Install pre-made modules (Recommended)` — pick from a reference system shipped with the ALS plugin.
  2. `Create a new module` — design a module from scratch via guided interview.
  3. `Stop here` — leave the system bootstrapped with no modules.

Operator can use Other to describe a different path in their own words.

**Hand off:**

| Choice | Action |
|--------|--------|
| Install pre-made modules | Invoke `als:foundry` via the Skill tool. No args. |
| Create a new module | Invoke `als:new` via the Skill tool. No args. |
| Stop here | No invocation. Proceed to Phase 8. |
| Other | Interpret the operator's instruction. If it maps to an existing skill, invoke it. Otherwise explain next steps and proceed to Phase 8. |

Do not read the invoked skill's SKILL.md before invoking — the Skill tool loads it. Do not narrate what the invoked skill will do — the operator will see its output directly.

Proceed to Phase 8 after the invoked skill (if any) returns.

## Phase 8: Final report

Use `references/final-report.md`.

Report:

- Acknowledged platform code (Phase 2)
- Prerequisite checks (`bun`, `jq`, `git`, `CLAUDE_PLUGIN_ROOT`)
- System id (Phase 4)
- Authored skeleton files (Phase 5)
- Validation and deploy results (Phase 6)
- Phase 7 outcome — which skill was invoked, or "stopped at skeleton"

Next commands the operator can reach for any time: `/new`, `/foundry`, `/change`, `/validate`.

If the operator re-runs `/install` after a successful bootstrap, Phase 3 refuses and redirects to `/new` or `/foundry`.
