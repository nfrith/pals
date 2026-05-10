# First-Touch Flow

Use a short opening frame for `/install`. The operator should know, in plain language, that ALS is about to bootstrap the project, validate and deploy the skeleton, then hand off to either `/foundry` (curated pre-built modules) or `/new` (author from scratch). First-module authoring does not happen inside `/install`.

Suggested shape:

1. Say this is the ALS first-touch install flow.
2. Say you will first confirm the ALS plugin root, `bun`, `jq`, and `git`.
3. Say you will acknowledge the ALS platform code, then ask for a short `system_id`.
4. Say the flow ends with validation, skeleton deploy, and a handoff to the skill that brings in modules.

Experience goals:

- Something concrete happens early.
- The operator always knows the current phase.
- The install feels safe: refuse overwrite when `.als/system.ts` already exists.
- Do not drown the operator in ALS jargon. No module, entity, skill, or delamain talk during `/install` — that arrives when the handoff skill runs.

Keep the opening to 2–4 sentences.
