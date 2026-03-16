# PALS Versioning Rules

## Scope

These rules define how module, skill, and schema versions are represented and bumped.

## Core Model

1. Customer-facing modules and skills start at `v1`.
2. `module_version` is an integer in `workspace/<module>/MODULE.md`.
3. `schema_version` is an integer in `workspace/<module>/MODULE.md`.
4. Skill folders are versioned as `vN` and the root skill `SKILL.md` routes to the deployed `vN`.

## Global Schema Version (Module-Wide)

1. `schema_version` is global per module, not per entity.
2. If any schema file changes, bump the module `schema_version`.
3. All schema files in the same deployed module version must carry the same `schema_version` value.
4. Decimal schema versions are not allowed (`1.0`, `1.1` are invalid). Use integers only.

## Alignment Invariants

1. Deployed skill version `vN` must match `module_version: N`.
2. Deployed module `schema_version: S` must match all deployed schema files using `schema_version: S`.
3. Root skill router must point to the same deployed `vN` reflected by `MODULE.md`.

## Bump Rules

1. Logic-only change:
- bump `module_version` by `+1`
- keep `schema_version` unchanged

2. Schema-only change:
- bump `module_version` by `+1`
- bump `schema_version` by `+1`

3. Schema + logic change:
- bump `module_version` by `+1`
- bump `schema_version` by `+1`

## Mutate -> Migrate Contract

1. `pals-mutate` authors `vN+1/` and its migration manifest.
2. Manifest `from_version` must equal deployed `N`; `to_version` must equal `N+1`.
3. `pals-migrate` updates router + `MODULE.md` only after migration and validation gates pass.
4. Cutover is atomic: either all deployed pointers/versions move to `N+1`, or none do.
