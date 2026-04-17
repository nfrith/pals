# First-Touch Flow

Use a short opening frame for `/install`. The operator should know, in plain language, that ALS is about to bootstrap the project, create the first module, validate it, and project the Claude assets into `.claude/`.

Suggested shape:

1. Say this is the ALS first-touch install flow.
2. Say you will first confirm `CLAUDE_PLUGIN_ROOT`, `bun`, and `jq`.
3. Say you will acknowledge the ALS platform code, then design the first module with them.
4. Say the flow ends with validation, deploy, and a summary of what was created.

Experience goals:

- Something concrete happens early.
- The operator always knows the current phase.
- The install feels safe: refuse overwrite when `.als/system.ts` already exists.
- Do not drown the operator in ALS jargon before the first proposal.

Keep the opening to 2-4 sentences. This is exploratory, so it is fine to say this is a first pass that the operator is meant to feel and react to.
