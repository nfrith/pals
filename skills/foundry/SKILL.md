---
name: foundry
description: Install curated modules from the ALS plugin's bundled Foundry shelf. Lets the operator pick one or many modules, copies them into the current project, validates, and auto-deploys the active harness projection. Re-runnable any time — not an onboarding-only flow.
allowed-tools: AskUserQuestion, Bash(bash *), Read, Write, Edit, Skill
---

# foundry

Import curated modules from the Foundry shelf (bundled with the ALS plugin) into the operator's current project. The operator picks from the shelf declared at `${ALS_PLUGIN_ROOT}/foundry/.als/system.ts`.

This skill is a peer to `/new` (which authors a module from scratch). Use this one when the operator wants something ready-made. Do not duplicate `/new`'s authoring logic here — if the operator wants to create from scratch, hand off to `/new` and exit.

## Inputs

- "open Foundry"
- "install from Foundry"
- "install pre-built modules"
- "bring in the factory module" (or any module name from Foundry)

## Phase 0 — Prereqs

Initialize runtime variables:

```bash
bash {skill-dir}/../lib/runtime-env.sh
```

Extract `ALS_PLUGIN_ROOT`, `SYSTEM_ROOT`, `HARNESS`, `ALS_PLATFORM_CODE`, `SKILLS_ROOT`, and `DELAMAINS_ROOT` from the output. If the output is `NO_SYSTEM`, tell the operator: "This project isn't an ALS system yet. Run `/install` first to bootstrap." Do not attempt to bootstrap from Foundry — that's a separate flow and pulling bundled modules into nothing is not a sane default.

Then confirm the plugin root:

```bash
if [ -d "${ALS_PLUGIN_ROOT}" ] && [ -f "${ALS_PLUGIN_ROOT}/alsc/compiler/src/cli.ts" ]; then
  printf 'ALS_PLUGIN_ROOT=%s\n' "${ALS_PLUGIN_ROOT}"
else
  echo "PLUGIN_ROOT_INVALID: ${ALS_PLUGIN_ROOT}"
fi
```

If `PLUGIN_ROOT_INVALID`, stop.

## Phase 1 — Resolve Foundry

There is exactly one Foundry shelf bundled with this plugin: `${ALS_PLUGIN_ROOT}/foundry`. This skill does not scan, does not offer a picker, and does not support variants. Use the canonical path directly:

```bash
FOUNDRY_ROOT="${ALS_PLUGIN_ROOT}/foundry"
if [ -f "$FOUNDRY_ROOT/.als/system.ts" ]; then
  printf 'FOUNDRY_ROOT=%s\n' "$FOUNDRY_ROOT"
else
  echo "FOUNDRY_MISSING: $FOUNDRY_ROOT"
fi
```

If the manifest is missing, stop and tell the operator the plugin is malformed. Do not fall back to other paths or search elsewhere — Foundry's location is part of the plugin contract.

## Phase 2 — Enumerate modules

Read Foundry's `.als/system.ts` and extract the `modules` object. For each module record:

- module id (the key)
- `path`
- `version`
- `skills` array
- required `description`

If the parsed `modules` object has zero keys, stop and tell the operator: "The Foundry shelf is empty. The operator populates it by hand over time — no modules are available to install today. Exiting." Do not proceed to Phase 3.

## Phase 3 — Select modules

When Foundry declares **13 or fewer modules**, present them all in a single AskUserQuestion call using the layout below. AskUserQuestion caps at 16 option slots per call and meta-options (`[ALL]` + `[CANCEL]`) consume 2 — so 13 is the largest module count that fits without paging.

When Foundry has **14 or more modules**, fall back to paged rounds (see [Paged fallback](#paged-fallback-14-modules) below).

The 13-module threshold is a **display constraint of this skill**, not an ALS language rule. An ALS system can declare any number of modules — this skill just prefers a tighter picker UX when the module count allows it.

### Single-call layout (≤13 modules)

**Layout rules:**

- `[ALL]` is always the first option of **Q1** and carries `(Recommended)`.
- Modules pack in stable alphabetical order across Q1–Q_last, 4 options per question.
- `[CANCEL]` is always the last explicit option of **Q_last**.
- `[Other]` is auto-added by the tool as the final option of every question — never include it explicitly.
- Every question uses `multiSelect: true`.

**Example layout for a 13-module Foundry shelf:**

| Q | Header | Options |
|---|--------|---------|
| Q1 | `Scope` | `[ALL] (Recommended)`, mod 1, mod 2, mod 3 |
| Q2 | `Modules 2` | mod 4, mod 5, mod 6, mod 7 |
| Q3 | `Modules 3` | mod 8, mod 9, mod 10, mod 11 |
| Q4 | `Modules 4` | mod 12, mod 13, `[CANCEL]` |

For smaller systems, collapse into fewer questions while keeping the same rules. Minimum per question is 2 — if the tail would be 0 or 1 options, shift meta-options up to the previous question.

**Option metadata:**

- label = module id
- description = `<description>. <path>, v<version>, <N> skill(s)`

**Answer handling:**

- If `[ALL]` is checked → candidate list = every module. Ignore other module checks.
- If `[CANCEL]` is checked → exit with no changes.
- Otherwise → candidate list = union of module checks across all questions.
- If `[Other]` was used → interpret the typed instruction. Common shapes: "everything except X", "install X Y Z", "cancel."

If the candidate list ends up empty, exit with no changes.

### Paged fallback (14+ modules)

Triggered only when Foundry has more modules than the single-call layout can hold. Shape:

1. **Scope call** — one AskUserQuestion, single-select, header `Scope`. Options: `[ALL] (Recommended)`, `Pick specific`, `[CANCEL]`.
   - `[ALL]` → candidate list = every module. Skip to Phase 4.
   - `[CANCEL]` → exit with no changes.
   - `Pick specific` → continue to the paged picker.
2. **Paged picker** — subsequent AskUserQuestion calls, `multiSelect: true`, up to 4 questions per call × 4 options per question. Pack modules alphabetically until exhausted. Each question's header reflects the page (`Modules 1`, `Modules 2`, ...).
3. Take the union of all checks across every page. If the set is empty, exit with no changes. Otherwise confirm the list back to the operator in a one-line message before Phase 4.

## Phase 4 — Conflict check

For each candidate module, check the target project for collisions: module id, mount-path overlap, or skill-id collision against anything already registered in the target `.als/system.ts`.

If a candidate collides, **rename the incoming module** to a non-colliding id, update the copied bundle accordingly, and use the new id when registering in Phase 5. No operator prompt — the rename is a trivial mechanical task.

Only escalate to the operator if the rename can't be resolved obviously (e.g. the renamed id would still overlap something else).

## Phase 5 — Copy and register

For each surviving candidate, in order:

1. Copy the module's ALS bundle only — the authored definition under `.als/modules/{module_id}`. **Do not copy the module's mounted data directory** from Foundry (e.g. whatever sits under the module's `path`). That data is bundled exemplar content, not something the operator wants imported into their project.

   ```bash
   cp -R "${FOUNDRY_ROOT}/.als/modules/{module_id}" "${SYSTEM_ROOT}/.als/modules/{module_id}"
   ```

2. Create an empty mounted data directory at the module's `path` so the compiler and skills can project into it:

   ```bash
   mkdir -p "${SYSTEM_ROOT}/{module.path}"
   ```

3. Append the module's entry to the target `${SYSTEM_ROOT}/.als/system.ts`'s `modules: {}` block. Use Edit to insert a new key immediately before the closing `}` of the modules record. Preserve indentation. Copy Foundry's fields verbatim (`path`, `version`, `description`, and `skills`). If the module was renamed in Phase 4, use the new id as the key and keep the renamed id consistent across the copied bundle and this entry.

Do this per-module so a failure mid-way is easy to surface and partial state is visible.

## Phase 6 — Validate

```bash
bun ${ALS_PLUGIN_ROOT}/alsc/compiler/src/cli.ts validate ${SYSTEM_ROOT}
```

If validation fails, surface the full compiler output to the operator without trying to auto-fix. Tell them: "The installed modules are on disk but the system did not validate. Resolve the errors or run `/foundry` again after undoing the copy. Nothing was deployed to the active harness projection." Stop — do not proceed to Phase 7.

## Phase 7 — Deploy

Validation passed. Dry-run the active harness projection, then live-deploy:

```bash
bun ${ALS_PLUGIN_ROOT}/alsc/compiler/src/cli.ts deploy ${HARNESS} --dry-run ${SYSTEM_ROOT}
bun ${ALS_PLUGIN_ROOT}/alsc/compiler/src/cli.ts deploy ${HARNESS} ${SYSTEM_ROOT}
```

If the dry-run surfaces target collisions, stop and report them — do not push through. If the live deploy fails, report the full compiler output. Otherwise the installed modules' skills, delamains, and projections are now live under `${SKILLS_ROOT}` and `${DELAMAINS_ROOT}`.

The operator does not request this step. New modules are useless until projected — auto-deploy is the default.

## Phase 8 — Offer bootup

Installed modules may include delamains — autonomous dispatchers that watch for pipeline work and act on it. Delamains are inert until their dispatchers are running, which the `/bootup` skill handles. Ask the operator before invoking it.

Use `ALS_PLATFORM_CODE` from the runtime helper and branch on the current platform per [`platforms.md`](../docs/references/platforms.md). If it is empty and `HARNESS` is `claude`, map `$CLAUDE_CODE_ENTRYPOINT` via the same reference. If `HARNESS` is `codex`, treat the platform as [`ALS-PLAT-CXCLI`](../docs/references/platforms.md).

### On CLI harnesses ([`ALS-PLAT-CCLI`](../docs/references/platforms.md), [`ALS-PLAT-CXCLI`](../docs/references/platforms.md)) — default

Use a single AskUserQuestion:

- **Header**: `Bootup`
- **Question**: "Start the delamain dispatchers now? Delamains are background processes that keep the system's pipelines alive — without them, modules are installed but nothing watches for or acts on pipeline work. Picking No leaves the system dormant; you can always run `/bootup` later."
- **Options**:
  1. `Yes` — description: `Invoke /bootup to start all dispatchers.`
  2. `No` — description: `Leave dispatchers stopped. You can run /bootup later.`

**Hand off:**

| Choice | Action |
|--------|--------|
| Yes | Invoke `als:bootup` via the Skill tool. No args. |
| No | Skip. Proceed to Phase 9. |
| Other | Interpret. If it maps to starting dispatchers, invoke `als:bootup`. Otherwise proceed to Phase 9. |

Do not read `/bootup`'s SKILL.md before invoking — the Skill tool loads it. Do not narrate what it will do — the operator sees its output directly.

### On Claude Code Desktop ([`ALS-PLAT-CDSK`](../docs/references/platforms.md))

Known Desktop behavior (as of 2026-04-23): freshly deployed skills are not discovered by the current session — a session restart is required before `/bootup` (or any newly installed skill) will resolve. We therefore do **not** invoke `als:bootup` from this session; the operator restarts and runs it in a fresh session.

Use a single AskUserQuestion:

- **Header**: `Bootup`
- **Question**: "Start the delamain dispatchers now? Delamains are background processes that keep the system's pipelines alive — without them, modules are installed but nothing watches for or acts on pipeline work. Claude Code Desktop requires a session restart to use the newly deployed skills. To continue, please start a new session and run `/bootup` there."
- **Options**:
  1. `Yes — I'll restart a new session with /bootup` — description: `Acknowledge. I'll skip invoking bootup here.`
  2. `No — I'll do it another time` — description: `Leave dispatchers stopped. You can restart and run /bootup later.`

**Hand off:**

| Choice | Action |
|--------|--------|
| Yes — I'll restart a new session with /bootup | Do **not** invoke `als:bootup` from this session. Proceed to Phase 9. |
| No — I'll do it another time | Skip. Proceed to Phase 9. |
| Other | Interpret. If it maps to acknowledging the restart-and-bootup path, proceed to Phase 9. Do not invoke `als:bootup` from this session regardless — the skill will not resolve until the next session. |

### On other platforms (`remote`, unobserved)

Default to the CLI flow above unless Desktop's deploy-discovery quirk is confirmed on that platform too.

Proceed to Phase 9 after the invoked skill (if any) returns.

## Phase 9 — Report

One block, no ceremony:

- Foundry: `foundry` at `${ALS_PLUGIN_ROOT}/foundry`
- Installed: `<module_id_1>, <module_id_2>, ...`
- Skipped (conflicts): `<module_id>: <reason>` (one per line, or "none")
- Validation: `pass`
- Deploy: `pass` (or the error summary if it failed)
- Bootup: `invoked` / `skipped` (Phase 8 outcome)
- Next: installed skills and delamains are live under `${SKILLS_ROOT}` and `${DELAMAINS_ROOT}`. Invoke them directly. If you skipped bootup, run `/bootup` when you want dispatchers running.

## Notes

- **13-module threshold is a skill-only display constraint.** AskUserQuestion allows at most 16 option slots per call; the single-call picker needs 2 for `[ALL]` + `[CANCEL]`, leaving 13 for modules. This is **not** an ALS language rule — ALS systems can declare any number of modules. When Foundry has 14+ modules, this skill silently falls back to paged rounds (see Phase 3). No schema enforcement, no compiler change.
- **Descriptions**: See [`ALS-006`](../../../als-factory/jobs/ALS-006.md). Every module in Foundry now carries a human-readable description at the declaration site, and this skill surfaces it directly in Phase 3.
- **Scope**: copy + register + validate + deploy + optional bootup. Not module authoring. If the operator wants a new module from scratch, hand off to `/new`.
- **Re-runnable**: running this skill again after an earlier install just adds more modules. Existing modules already in the target get renamed on the incoming copy (Phase 4).
- **No versioning story yet**: this skill installs at the version declared in Foundry. There is no "upgrade this Foundry module" flow. When that becomes a need, it gets its own job.
