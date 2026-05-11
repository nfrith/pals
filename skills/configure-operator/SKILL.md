---
name: configure-operator
description: Create or update the ALS operator roster, per-operator authored profile, and machine-local active-operator selector under <system_root>/.als/.
allowed-tools: AskUserQuestion, Bash(bash *)
---

# configure-operator

Create or update ALS v5 operator config.

Reference contract: [`../docs/references/operator-config.md`](../docs/references/operator-config.md)

## Canonical outputs

Tracked:

- `<system_root>/.als/operator-roster.ts`
- `<system_root>/.als/operators/{operator_id}.ts`
- `<system_root>/.als/.gitignore` containing `/local/`

Machine-local, untracked:

- `<system_root>/.als/local/active-operator.json`

## Step 1 — Inspect the current surface

Resolve and inspect through compiler helpers:

```bash
ROSTER_PATH="$(bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts operator-config path)"
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts operator-config inspect "${PWD}"
```

Interpret the result:

- `status: "missing"` — no roster exists yet; create one
- `status: "pass"` — roster and active selector are usable; update or switch the active operator
- `status: "fail"` — repair the reported problems before finishing

If inspection shows `legacy.exists: true` and `exists: false`, the system is still on the v4 `operator.md` surface. Tell the operator to run `/update` or `/upgrade-language` first if they want the one-shot migration path.

## Step 2 — Determine the operator to write

Use `AskUserQuestion` for every field interaction.

When no roster exists:

- Ask for `first_name`
- Ask for `last_name`
- Ask for `display_name` (allow blank/null)
- Derive a suggested stable operator id by slugifying `display_name` when present, otherwise `first_name + " " + last_name"`
- Ask the operator to confirm or edit that id
- Use the confirmed id as both the authored `id` field and the operator filename basename

When a roster already exists:

- Show the current roster ids
- Ask whether to:
  - update the current active operator
  - switch the active machine to another existing operator id
  - add a new operator entry

Rules:

- Operator ids must use lowercase slug tokens joined by hyphens.
- Operator ids must be unique within the roster.
- Do not ask for profiles on first creation; default to `["edgerunner"]`.
- If editing an existing operator, show current values and re-ask only fields the operator wants to change.

## Step 3 — Interview for operator fields

Always capture:

- `first_name`
- `last_name`
- `display_name` (allow blank/null)
- `primary_email`
- `role`
- `owns_company`

Only when `owns_company` is true, also capture:

- `company_name`
- `company_type` — `llc (Recommended)`, `sole_prop`, `corp`, `ltd`, `partnership`, `nonprofit`, `other`
- `company_type_other` only when `company_type` is `other`
- `revenue_band` — `100k-1M (Recommended)`, `<100k`, `1M-10M`, `10M+`

Profile handling:

- Default a new operator to `["edgerunner"]`
- If editing an existing operator, allow only `edgerunner`, `als_developer`, `als_architect`

Never store secrets here.

## Step 4 — Write the authored files

1. Ensure the directories exist:

```bash
mkdir -p "<system_root>/.als/operators" "<system_root>/.als/local"
```

2. Write `<system_root>/.als/operators/{operator_id}.ts` using `defineOperator(...)`.
3. Write or update `<system_root>/.als/operator-roster.ts` so `operator_paths` contains every committed operator file path exactly once.
4. Write or update `<system_root>/.als/.gitignore` so it contains `/local/`.
5. Write the machine-local selector through the compiler helper, not by hand:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts operator-config set-active "<system-root>" "<operator-id>"
```

## Step 5 — Validate

Immediately validate through the compiler helper:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts operator-config inspect "<system-root>"
```

If validation fails or reports credential warnings, keep repairing until inspection returns `status: "pass"`.

## Step 6 — Confirm the outcome

Report:

- the roster path
- the authored operator file path
- the active operator id
- whether this was a create, update, switch, or repair run
- that SessionStart will now inject the selected operator unless `.als/skip-operator-config` exists
