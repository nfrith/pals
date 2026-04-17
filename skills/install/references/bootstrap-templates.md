# Bootstrap Templates

Use these templates for the first-touch authored shell.

## `.als/authoring.ts`

Replace `__ALS_AUTHORING_IMPORT__` with the absolute path `${CLAUDE_PLUGIN_ROOT}/alsc/compiler/src/authoring/index.ts`.

```ts
export { defineSystem, defineModule, defineDelamain } from "__ALS_AUTHORING_IMPORT__";
```

## `.als/system.ts`

Use quoted keys and values to match the current authored style. Replace the placeholders.

```ts
import { defineSystem } from "./authoring.ts";

export const system = defineSystem({
  "als_version": 1,
  "system_id": "__ALS_SYSTEM_ID__",
  "modules": {
    "__ALS_MODULE_ID__": {
      "path": "__ALS_MODULE_PATH__",
      "version": 1,
      "skills": [
        "__ALS_SKILL_ID_1__"
      ]
    }
  }
} as const);

export default system;
```

If the first module has no active skills yet, use:

```ts
"skills": []
```

Bootstrap contract:

- Always create `.als/` and `.als/modules/` before module files.
- The first module bundle lives at `.als/modules/<module_id>/v1/`.
- `.als/CLAUDE.md` is deploy-generated and must not be written by hand.
- The absolute import path in `.als/authoring.ts` is acceptable for this exploratory first pass.
