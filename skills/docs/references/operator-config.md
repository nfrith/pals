# Operator Configuration

Reference for the ALS v5 operator-config surface.

## Purpose

Operator config stores stable human identity and business context for one ALS system:

- shared operator membership in the repo
- per-operator identity and business facts
- machine-local active-operator selection

It is not for task notes, transient state, or secrets.

## Canonical Files

Tracked authored files:

```text
<system_root>/.als/operator-roster.ts
<system_root>/.als/operators/{operator_id}.ts
<system_root>/.als/.gitignore
```

Machine-local untracked file:

```text
<system_root>/.als/local/active-operator.json
```

Legacy migration-only input:

```text
<system_root>/.als/operator.md
```

`operator.md` is read only by the `v4 -> v5` language-upgrade recipe. It is not a runtime surface after ALS v5 ships.

## Tracked Shape

### `.als/operator-roster.ts`

```ts
import { defineOperatorRoster } from "als:authoring";

export const operatorRoster = defineOperatorRoster({
  operator_paths: ["./operators/nick-frith.ts"],
} as const);

export default operatorRoster;
```

Rules:

- `operator_paths` is required and lists one or more `./operators/{operator_id}.ts` paths.
- Each path must stay under `.als/operators/`.
- ALS resolves each path through compiler-owned authored-load helpers.

### `.als/operators/{operator_id}.ts`

```ts
import { defineOperator } from "als:authoring";

export const operator = defineOperator({
  id: "nick-frith",
  first_name: "Nick",
  last_name: "Frith",
  display_name: "0xnfrith",
  primary_email: "nick@example.com",
  role: "Founder",
  profiles: ["edgerunner"],
  owns_company: true,
  company_name: "Example Co",
  company_type: "llc",
  company_type_other: null,
  revenue_band: "100k-1M",
} as const);

export default operator;
```

Rules:

- `id` is required, unique within the roster, and uses lowercase slug tokens joined by hyphens.
- The file basename must match the authored `id`.
- `display_name` may be `null`; ALS falls back to `first_name + " " + last_name`.
- `profiles` allows `edgerunner`, `als_developer`, and `als_architect`.
- `company_name`, `company_type`, and `revenue_band` are required only when `owns_company: true`.

## Machine-Local Active Selection

`.als/local/active-operator.json` chooses which roster entry represents the current machine.

```json
{
  "schema": "als-active-operator-selection@1",
  "operator_id": "nick-frith"
}
```

`.als/.gitignore` must ignore `/local/`:

```gitignore
# Machine-local operator selection
/local/
```

The selector is written through compiler-owned helpers in the `alsc operator-config` namespace. Do not commit it.

## Lifecycle

- Fresh `/install` lands directly on the ALS v5 roster surface.
- `/configure-operator` is the canonical managed writer for roster entries and the local selector.
- SessionStart injects identity only when the roster and local selector both resolve.
- `.als/skip-operator-config` suppresses SessionStart identity injection for demo/reference systems.
- `/upgrade-language` migrates v4 `.als/operator.md` into the v5 roster surface, then a live-machine helper writes the local selector after commit.

## Validation and Remediation

- The compiler-owned implementation lives in `alsc/compiler/src/operator-config.ts`.
- Use `alsc operator-config inspect <system-root-or-cwd>` to inspect the resolved roster, operators, selector, and any legacy migration input.
- Use `alsc operator-config set-active <system-root-or-cwd> <operator-id>` to write the machine-local selector.
- Use `alsc operator-config select-singleton <system-root-or-cwd>` when the roster has exactly one operator and the helper should auto-select it.
- SessionStart emits hard remediation when the roster is missing, the selector is missing, the selector JSON is invalid, or the selected `operator_id` does not exist in the roster.

## Sensitive-Data Boundary

Do not store credentials in any operator-config surface.

Explicitly forbidden:

- API keys
- OAuth tokens
- passwords
- private keys
- signing material
- `.env`-style secrets of any kind

Use secret channels instead:

- `.env`
- 1Password
- OS keychain / secure credential storage
