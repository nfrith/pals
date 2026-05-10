# Bootstrap Templates

Use these templates for the `/install` skeleton. Only one file is authored here — `.als/system.ts` — plus the empty `.als/modules/` directory. Module bundles are NOT authored by `/install`; they arrive from `/foundry` or `/new` in Phase 7.

## `.als/system.ts`

Use quoted keys and values to match the current authored style. Replace `__ALS_SYSTEM_ID__` with the operator's chosen `system_id` from Phase 4.

```ts
import { defineSystem } from "als:authoring";

export const system = defineSystem({
  "als_version": 3,
  "system_id": "__ALS_SYSTEM_ID__",
  "modules": {}
} as const);

export default system;
```

The `modules: {}` block stays empty. Module entries are appended later by `/foundry` (copying from the curated shelf) or `/new` (authoring from scratch).

## Bootstrap contract

- Always create `.als/` and `.als/modules/` (the latter as an empty directory) before writing any `.als/*.ts` file.
- `/install` never writes anything under `.als/modules/` — that is the downstream skill's job.
- `/install` does not write `.als/authoring.ts`. V3 authored entrypoints import directly from ALS-reserved specifiers.
- `${SYSTEM_INSTRUCTION_PATH}` is deploy-generated and must not be written by hand.
