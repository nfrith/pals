---
name: operator-config
description: Create or update the operator profile stored at <system_root>/.als/operator.md, validate it, and keep it ready for SessionStart injection.
allowed-tools: AskUserQuestion, Bash(bash *)
---

# operator-config

Create or update the ALS operator profile at `<system_root>/.als/operator.md`.

For the file contract and sensitive-data boundary, see [`../docs/references/operator-config.md`](../docs/references/operator-config.md).

## When to use

- First-time operator onboarding when `/install` detects no operator config yet
- Updating stable operator facts such as name, role, email, or company context
- Repairing an invalid operator config after a SessionStart remediation reminder

## Procedure

### Step 1 — Resolve and inspect the current config

Resolve the canonical path through the compiler helper:

```bash
CONFIG_PATH="$(bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts operator-config path)"
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts operator-config inspect "$CONFIG_PATH"
```

Interpret the result:

- `status: "missing"` — create mode
- `status: "pass"` — update mode; preload current values and only re-ask fields the operator wants to change
- `status: "fail"` — repair mode; show the reported errors/warnings, then continue with the questionnaire so the rewritten file comes back valid

### Step 2 — Interview for the approved v1 fields

Use normal conversation for free-text fields and AskUserQuestion for bounded choices.

Always capture:
- `first_name`
- `last_name`
- `display_name` (allow blank/null)
- `primary_email`
- `role`
- `owns_company`

Only when `owns_company` is true, also capture:
- `company_name`
- `company_type` — AskUserQuestion with: `llc (Recommended)`, `sole_prop`, `corp`, `ltd`, `partnership`, `nonprofit`, `other`
- `company_type_other` only when `company_type` is `other`
- `revenue_band` — AskUserQuestion with: `100k-1M (Recommended)`, `<100k`, `1M-10M`, `10M+`

`profiles` handling:
- If the config is missing, do **not** ask. Set `profiles` to `["operator"]`.
- If the config already exists, show the current profile list and ask whether to keep it or edit it.
- If the operator wants to edit, allow only: `operator`, `als_developer`, `als_architect`.

Never store secrets here. If the operator offers a token, API key, password, private key, or any other credential, stop and redirect that value to `.env`, 1Password, or the OS keychain instead.

### Step 3 — Write the canonical markdown file

Write one markdown file at `$CONFIG_PATH` with YAML frontmatter only. Use today's date for `created` on first write and always bump `updated` on rewrite. The body may stay empty.

Template:

```yaml
---
config_version: 1
created: YYYY-MM-DD
updated: YYYY-MM-DD
first_name: ...
last_name: ...
display_name: null
primary_email: ...
role: ...
profiles:
  - operator
owns_company: false
company_name: null
company_type: null
company_type_other: null
revenue_band: null
---
```

Before writing, create the parent directory if needed:

```bash
mkdir -p "$(dirname "$CONFIG_PATH")"
```

### Step 4 — Validate the written file

Immediately validate the rewritten file:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/cli.ts operator-config inspect "$CONFIG_PATH"
```

If validation fails or reports credential warnings, do not stop with a broken file. Continue the repair loop until the inspect output returns `status: "pass"`.

### Step 5 — Confirm the outcome

Report:
- the resolved config path
- whether this was a create, update, or repair run
- which fields changed
- that SessionStart will now inject the profile unless the current ALS system contains `.als/skip-operator-config`

## Notes

- This file is system-scoped. Each ALS system keeps its own `.als/operator.md`.
- `/install` invokes this skill only when the config is missing.
- Re-running `/install` does not reopen this flow; `/operator-config` is the ongoing edit surface.
- The usual `.als/CLAUDE.md` "do not edit" warning does not block this file. `/operator-config` is the approved managed writer for `.als/operator.md`.
