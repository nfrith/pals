---
name: install
description: Bootstrap ALS into a fresh project — author the empty skeleton (`.als/system.ts` with an empty `modules: {}`), validate and deploy it, create the operator profile if missing, then hand off to `/foundry` or `/new` for module work. Use this when the operator is starting from zero on a non-ALS project.
allowed-tools: AskUserQuestion, Bash(bash *), Read, Write, Edit, Skill
---

# install

You are the first-touch ALS onboarding flow. Take a project from zero to a bootstrapped ALS system — `.als/system.ts` with the operator's chosen system id and an empty `modules: {}` block — validate it, deploy the active harness projection, create the operator profile if it does not already exist, then hand off to `/foundry` (curated pre-built modules) or `/new` (author a module from scratch). **First-module authoring is not this skill's job.**

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
5. validate and deploy the active harness projection
6. initialize git if needed
7. create the operator profile if missing
8. ask what to do next and hand off to the matching skill

Do not ask the operator to open a terminal. Use the active harness tools from inside the session.

## Phase 1: Runtime prerequisites

Before interviewing, verify the install can succeed.

1. Initialize plugin runtime variables:

```bash
bash {skill-dir}/../lib/runtime-env.sh plugin
```

Extract `ALS_PLUGIN_ROOT`, `HARNESS`, `ALS_PLATFORM_CODE`, `ALS_PLUGIN_MANIFEST_PATH`, and `ALS_MARKETPLACE_MANIFEST_PATH` from the output.

Then confirm the plugin root:

```bash
if [ -d "${ALS_PLUGIN_ROOT}" ] && [ -f "${ALS_PLUGIN_ROOT}/alsc/compiler/src/cli.ts" ]; then
  printf 'ALS_PLUGIN_ROOT=%s\n' "${ALS_PLUGIN_ROOT}"
else
  echo "PLUGIN_ROOT_INVALID: ${ALS_PLUGIN_ROOT}"
fi
```

If `PLUGIN_ROOT_INVALID` is reported, stop and tell the operator install cannot proceed.

2. Run `which bun` to check if Bun is on PATH.
   - If not found, tell the operator: "ALS requires Bun to run the compiler. You can install it by typing `! curl -fsSL https://bun.sh/install | bash` and then restarting your shell." Do not proceed until Bun is available.

3. Run `which jq` to check if jq is on PATH.
   - If not found, tell the operator: "ALS hooks require jq. Install it with your package manager (e.g. `! sudo apt-get install -y jq` or `! brew install jq`)." Do not proceed until jq is available.

4. Run `which git` to check if git is on PATH.
   - If not found, tell the operator: "ALS requires git. Every pipeline transition creates a commit, so the system cannot operate in a non-git workspace. Install git for your platform, then restart and re-run `/install`." Do not proceed until git is available.

5. Run `cd ${ALS_PLUGIN_ROOT}/alsc/compiler && bun install` to ensure compiler dependencies are installed. This is idempotent and fast when dependencies already exist.

Report the successful prerequisite check before continuing.

## Phase 2: Platform detection

Follow `references/platform-detection.md`.

- Produce one explicit platform acknowledgement using the matching `ALS-PLAT-XXXX` row from [`platforms.md`](nfrith-repos/als/skills/docs/references/platforms.md).
- If the runtime helper cannot resolve a platform code, use AskUserQuestion to confirm in plain language. Do not show technical platform codes as visible options.
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

Do not interview for modules, entities, skills, or delamains here. Those belong to `/new` (create from scratch) or `/foundry` (pull from the curated shelf), both invoked in Phase 9.

## Phase 5: Bootstrap the skeleton

With `system_id` chosen, write the authored skeleton. Follow `references/bootstrap-templates.md` for exact contents.

1. Create `.als/` and `.als/modules/` (the latter an empty directory).
2. Write `.als/system.ts` with `als_version: 3`, the chosen `system_id`, and an empty `modules: {}` block.

Do not author any modules, skills, or delamains. Those arrive via `/new` or `/foundry` in Phase 9.

Do not hand-author the generated system instruction file — that is generated by deploy in Phase 6.

## Phase 6: Validate and deploy the skeleton

Initialize system runtime variables:

```bash
bash {skill-dir}/../lib/runtime-env.sh ${HARNESS} "$(pwd)"
```

Extract `SYSTEM_ROOT`, `SKILLS_ROOT`, `DELAMAINS_ROOT`, `SYSTEM_INSTRUCTION_PATH`, and `TRANSACTION_ROOTS` from the output.

Validate:

```bash
bun ${ALS_PLUGIN_ROOT}/alsc/compiler/src/cli.ts validate ${SYSTEM_ROOT}
```

An empty `modules: {}` record is valid — this should pass clean.

Dry-run the active harness projection:

```bash
bun ${ALS_PLUGIN_ROOT}/alsc/compiler/src/cli.ts deploy ${HARNESS} --dry-run --require-empty-targets ${SYSTEM_ROOT}
```

Confirm the dry-run is clean and includes the planned `${SYSTEM_INSTRUCTION_PATH}` write. If it reports target collisions, stop and resolve with the operator before live deploy.

Live deploy:

```bash
bun ${ALS_PLUGIN_ROOT}/alsc/compiler/src/cli.ts deploy ${HARNESS} ${SYSTEM_ROOT}
```

The skeleton deploy produces `${SYSTEM_INSTRUCTION_PATH}` and an otherwise empty projection surface. Modules and their projections arrive when the operator runs the next skill.

If any step fails, stop — do not proceed to Phase 7.

## Phase 7: Initialize git repo (if missing)

ALS requires git (checked in Phase 1) because every pipeline transition creates a commit. If the system root is not already a git working tree, initialize one without asking the operator — this is a structural requirement of the system, not a preference. The `system_id` captured in Phase 4 becomes the identifier surfaced in the initial commit message and any future `origin` remote the operator adds.

1. Check whether the system root is already a git working tree:

```bash
cd ${SYSTEM_ROOT} && git rev-parse --is-inside-work-tree 2>/dev/null
```

2. If the check prints `true`, skip the rest of this phase. The system root already has git tracking (either a local repo or a subdirectory inside one) — leave it alone.

3. Otherwise, initialize a fresh repo and make the first commit:

```bash
cd ${SYSTEM_ROOT}
git init -b main
for path in ${TRANSACTION_ROOTS}; do [ -e "$path" ] && git add "$path"; done
git commit -m "Initial commit — <system_id> ALS system"
```

Substitute `<system_id>` with the value captured in Phase 4, verbatim. If additional files exist at the system root outside `${TRANSACTION_ROOTS}` (e.g. a README, `.gitignore`), include them in the initial commit as well.

4. Record the outcome for the final report: either `initialized new repo` (with the commit SHA) or `existing git working tree — no change`.

## Phase 8: Create operator config if missing

Resolve the canonical operator-config path through the compiler helper:

```bash
CONFIG_PATH="$(bun ${ALS_PLUGIN_ROOT}/alsc/compiler/src/cli.ts operator-config path ${SYSTEM_ROOT})"
[ -f "$CONFIG_PATH" ] && printf 'OPERATOR_CONFIG: exists (%s)\n' "$CONFIG_PATH" || printf 'OPERATOR_CONFIG: missing (%s)\n' "$CONFIG_PATH"
```

Interpret the result:

- If the config exists, do not ask profile questions again. Record `existing operator config — no change` and continue.
- If the config is missing, invoke `als:configure-operator` via the Skill tool. No args. Wait for it to finish, then record `created operator config`.

This phase happens only on first-time bootstrap. Re-running `/install` still refuses in Phase 3.

## Phase 9: Pick next step and hand off

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
| Stop here | No invocation. Proceed to Phase 10. |
| Other | Interpret the operator's instruction. If it maps to an existing skill, invoke it. Otherwise explain next steps and proceed to Phase 10. |

Do not read the invoked skill's SKILL.md before invoking — the Skill tool loads it. Do not narrate what the invoked skill will do — the operator will see its output directly.

Proceed to Phase 10 after the invoked skill (if any) returns.

## Phase 10: Final report

Use `references/final-report.md`.

Report:

- Acknowledged platform code (Phase 2)
- Prerequisite checks (`bun`, `jq`, `git`, `ALS_PLUGIN_ROOT`)
- System id (Phase 4)
- Authored skeleton files (Phase 5)
- Validation and deploy results (Phase 6)
- Git repo outcome (Phase 7) — `initialized new repo` with commit SHA, or `existing git working tree — no change`
- Operator-config outcome (Phase 8) — `created operator config` or `existing operator config — no change`
- Phase 9 outcome — which skill was invoked, or "stopped at skeleton"

Next commands the operator can reach for any time: `/new`, `/foundry`, `/change`, `/validate`, `/configure-operator`.

If the operator re-runs `/install` after a successful bootstrap, Phase 3 refuses and redirects to `/new`, `/foundry`, or `/configure-operator` for profile changes.
