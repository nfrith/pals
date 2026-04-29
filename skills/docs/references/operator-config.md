# Operator Configuration

Reference for the operator profile stored at `<system_root>/.als/operator.md`.

## Purpose

`operator.md` is for stable operator context ALS should remember inside one ALS system:
- identity
- primary email
- stable role/business context

It is not for project-scoped data, task-scoped notes, or secrets.

## Location

The canonical path is:

```text
<system_root>/.als/operator.md
```

The compiler resolves this path from the current ALS system root. Different ALS systems keep independent operator configs.

## Shape

One markdown file with YAML frontmatter and an optional prose body.

### Frontmatter

```yaml
---
config_version: 1
created: 2026-04-25
updated: 2026-04-25
first_name: Nick
last_name: Frith
display_name: null
primary_email: nick@example.com
role: Founder
profiles:
  - edgerunner
owns_company: true
company_name: Example Co
company_type: llc
company_type_other: null
revenue_band: 100k-1M
---
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `config_version` | integer | yes | Must be `1` for v1 |
| `created` | date | yes | `YYYY-MM-DD` |
| `updated` | date | yes | `YYYY-MM-DD`; bump on rewrite |
| `first_name` | string | yes | Trimmed, single-line |
| `last_name` | string | yes | Trimmed, single-line |
| `display_name` | string or null | yes | Optional override |
| `primary_email` | email string | yes | Trimmed, single-line |
| `role` | string | yes | Stable free-text role/title |
| `profiles` | list enum | yes | Any of `edgerunner`, `als_developer`, `als_architect` |
| `owns_company` | boolean | yes | Gates the company fields |
| `company_name` | string or null | yes | Required when `owns_company: true` |
| `company_type` | enum or null | yes | `llc`, `sole_prop`, `corp`, `ltd`, `partnership`, `nonprofit`, `other` |
| `company_type_other` | string or null | yes | Required only when `company_type: other` |
| `revenue_band` | enum or null | yes | `<100k`, `100k-1M`, `1M-10M`, `10M+` |

## Lifecycle

- Created on first-run onboarding when `/install` invokes `/operator-config`
- Updated later by re-running `/operator-config`
- Read at SessionStart by the ALS operator-config hook
- Suppressed per-system when `.als/skip-operator-config` exists in the current ALS system
- Outside any ALS system, SessionStart does nothing and injects no reminder

## Validation and remediation

- The canonical validator lives in `alsc/compiler/src/operator-config.ts`
- SessionStart injects the profile only when validation passes
- If the file is invalid or contains credential-like values, SessionStart emits a remediation reminder telling the operator to run `/operator-config`

## Sensitive-data boundary

Do **not** store credentials in `operator.md`.

Explicitly forbidden here:
- API keys
- OAuth tokens
- passwords
- private keys
- signing material
- `.env`-style secrets of any kind

Use existing secret channels instead:
- `.env`
- 1Password
- OS keychain / secure credential storage

## Editing after install

Use `/operator-config` to edit the file after onboarding. That skill:
- reads the current values
- lets the operator change only the fields they want
- rewrites the file in the canonical shape
- validates it before finishing

## `.als/` edit boundary

`.als/CLAUDE.md` is compiler-managed and should not be edited by hand. That warning does not prohibit `.als/operator.md`.

`/operator-config` is the approved managed writer for `.als/operator.md`, and the SessionStart hook is the approved reader.
