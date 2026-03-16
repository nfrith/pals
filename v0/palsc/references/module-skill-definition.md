# Module Skill Definition (Current Baseline)

## Scope

This document defines the required filesystem and router shape for PALS module skills:

1. `.claude/skills/<module-skill>/SKILL.md`
2. `.claude/skills/<module-skill>/vN/content/SKILL.md`
3. `.claude/skills/<module-skill>/vN/schemas/<entity>.md`
4. `.claude/skills/<module-skill>/vN/migrations/MANIFEST.md` (for `v2+`)

It does not define module-specific business logic inside versioned `content/SKILL.md`.

## Canonical Type Model

```ts
type ModuleSkillRouterFrontmatter = {
  name: string;
  description: string;
  context: "fork";
};

type ModuleSkillLayout = {
  skill_dir_name: string;
  router_path: string;
  versions: VersionedModuleSkill[];
};

type VersionedModuleSkill = {
  version: PositiveInteger;
  content_path: string; // vN/content/SKILL.md
  schemas_dir_path: string; // vN/schemas/
  migration_manifest_path?: string; // vN/migrations/MANIFEST.md
};
```

## Canonical Router Shape

```md
---
name: <module-skill-name>
description: <non-empty string>
context: fork
---

# <Module Name> (Version Router)

This file is a pointer to the latest deployed <module-skill-name> skill version.

## Current Deployed Version

- `vN`

## Load Target

- `vN/content/SKILL.md`

## Router Rule

When this skill is invoked, read and follow the skill instructions at `vN/content/SKILL.md`.
```

## Compiler Enforcement Rules

1. Module skill root must contain `SKILL.md`.
2. Router `SKILL.md` frontmatter keys must be exactly: `name`, `description`, `context`.
3. Router `context` must be `fork`.
4. Router body must contain exactly these level-2 headings:
   - `Current Deployed Version`
   - `Load Target`
   - `Router Rule`
5. `Current Deployed Version` must declare exactly one deployed version in the form `` `vN` ``.
6. `Load Target` must declare exactly one path in the form `` `vN/content/SKILL.md` ``.
7. Router deployed version and load target version must match.
8. The deployed version folder `vN/` must exist.
9. Every version folder must contain:
   - `content/SKILL.md`
   - `schemas/`
10. `schemas/` must contain exactly one schema file per entity declared in the corresponding module `MODULE.md` `entity_paths`, named `<entity>.md`.
11. Version folders must be named `vN` where `N` is a positive integer.
12. Deployed router version `vN` must match module `MODULE.md` `module_version: N`.
13. Deployed skill schemas must match module `MODULE.md` `schema_version`.
14. Router frontmatter `name` must equal the skill directory basename.
15. Skill directory basename must follow `<module_id>-module`.
16. For `v2+`, `migrations/MANIFEST.md` must exist.
17. Historical version folders may remain after cutover; the router alone determines the deployed version.

## Boundary

This file defines only module skill filesystem/router shape.

1. Module contract shape is defined in `palsc/references/module-schema-definition.md`.
2. Schema file frontmatter shape is defined in `palsc/references/frontmatter-schema-definition.md`.
3. Schema file body shape is defined in `palsc/references/content-schema-definition.md`.
4. Version-number alignment rules are defined in `palsc/references/versioning.md`.

## Explicitly Not Supported (Current Baseline)

1. Non-versioned module skill layouts.
2. Router aliases that point anywhere other than `vN/content/SKILL.md`.
3. Missing schema files for declared module entities.
4. Non-`fork` router execution context.
