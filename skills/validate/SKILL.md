---
name: validate
description: Run the ALS compiler to validate a system's modules, authored contracts, and records. Use when the user asks to validate, check, or compile their ALS system, or after making changes to module data or authored `module.ts` definitions.
---

# validate

## Prerequisites

Before running the compiler, verify the runtime environment.

1. Run `which bun` to check if Bun is on PATH.
   - If not found, tell the operator: "ALS requires Bun to run the compiler. You can install it by typing `! curl -fsSL https://bun.sh/install | bash` and then restarting your shell." Do not proceed until Bun is available.

2. Run `which jq` to check if jq is on PATH.
   - If not found, tell the operator: "ALS hooks require jq. Install it with your package manager (e.g. `! sudo apt-get install -y jq` or `! brew install jq`)." Do not proceed until jq is available.

3. Run `cd ${CLAUDE_PLUGIN_ROOT}/alsc/compiler && bun install` to ensure compiler dependencies are installed. This is idempotent and fast when dependencies already exist.

You run the ALS compiler against a system to check that all authored `system.ts`/`module.ts` entrypoints, records, and references are valid.

## Determine the system root

The compiler needs the path to the system root — the directory that contains `.als/system.ts`.

1. If the user provides a path, use it.
2. If the conversation has context about which system is being worked on, use that path.
3. Otherwise, check if the current working directory (or a parent) contains `.als/system.ts` and use that.
4. If none of the above, ask the user.

## Determine the module filter

The compiler can validate all modules or a single module.

- If the user names a specific module, pass it as the second argument.
- If the conversation is clearly focused on one module, pass that module id.
- Otherwise, omit the filter to validate everything.

## Run the compiler

```bash
bun ${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/index.ts validate <system-root> [module-id]
```

The compiler outputs JSON to stdout. Exit code 0 means pass, exit code 1 means fail.

## Interpret the results

Read the JSON output and present a summary to the operator:

- **If the system passes**: report the number of modules checked, files checked, and that everything is clean.
- **If the system fails**: report the errors grouped by file. For each error, show:
  - The file path
  - The error code and message
  - The expected vs actual values

Keep it concise. Do not dump the raw JSON unless the user asks for it. Focus on what is wrong and where.

If there are many errors on a single file, group them. If there are errors across many files that share the same cause (like a shape change that broke all records), call that out as a pattern rather than listing every instance.

## After validation

If errors are found, ask the operator if they want help fixing them. Do not fix anything automatically — the operator decides.
