# Location-Independent Authoring Contract

## Status

Proposed

## Context

- ALS systems currently depend on a location-sensitive `.als/authoring.ts` shim that re-exports compiler helpers and compatibility-contract values from a filesystem-relative path into `alsc/compiler/...`.
- That shim works by design only for systems that happen to live at the expected relative depth under the plugin root. `reference-system/` matches the assumption; Ghost hand-tunes around it; external AAT fixtures and ordinary edgerunner systems break.
- `nfrith-repos/als/alsc/compiler/src/authored-load.ts` currently evaluates authored TypeScript through host `require.resolve()` plus `require()`, so Bun/Node module resolution is implicitly part of the ALS language contract today.
- The live authored corpus in this checkout is narrower than that loader shape suggests. Every authored `system.ts`, `module.ts`, and `delamain.ts` imports only the local `authoring.ts`; the only shared runtime value observed in authored shapes is `COMPATIBILITY_CLASSES`.
- Research proved machine-local resolver artifacts can make the break go away technically (symlinked `.als/alsc`, generated `node_modules`, `package.json#imports` indirection), but the operator rejected those shapes as the canonical answer because they replace one brittle filesystem dependency with another.
- ALS release policy is single-hop and whole-system: a compiler release must not silently reinterpret authored source, and ALS does not promise indefinite support for old language epochs inside one repo. The accepted `language-upgrade-recipe` contract in SDR 037 is the mechanism for authored-source-invalidating cutovers.
- ALS-074 already authored the first public language hop at `language-upgrades/recipes/v1-to-v2/`. ALS-077 is therefore the second hop, `v2 -> v3`, not a free-floating compatibility tweak.
- Pass-2 operator review accepted the portable local facade and the import-boundary rule in substance, but rejected the idea of the compiler tolerating both legacy and portable `.als/authoring.ts` shapes indefinitely. The cutover must end.

## Decision

- ALS-077 is the `als_version: 2 -> 3` hop. Its release classification is `migration_required`.
- ALS v3 authored systems use one steady-state `.als/authoring.ts` shape only: a self-contained portable local authoring facade with no runtime imports. The existing `defineSystem`, `defineModule`, and `defineDelamain` helper names remain valid in that facade.
- ALS v2 legacy relative-shim `authoring.ts` files are valid pre-recipe only. The public `v2 -> v3` transition ships as `nfrith-repos/als/language-upgrades/recipes/v2-to-v3/`, and its must-run script rewrites every system's `.als/authoring.ts` from the legacy relative shim to the portable v3 facade.
- The compiler-owned loader for ALS v3 knows only the new portable facade shape. There is no indefinite dual-shape compatibility bridge inside the v3 loader.
- Authored entrypoints remain a compiler-owned declarative module surface. In ALS v3, `system.ts`, `module.ts`, and `delamain.ts` import only the standard local `authoring.ts` helper surface at the existing relative path (`./authoring.ts`, `../../../authoring.ts`, `../../../../../authoring.ts`).
- Value imports inside ALS v3 authored entrypoints are limited to that standard local `authoring.ts` surface. The compiler-owned loader rejects direct imports to other local helper files, plugin-tree paths, package aliases, or package-manager dependencies from `system.ts`, `module.ts`, and `delamain.ts`.
- A shared compiler helper owns portable-facade emission. `/install` uses it for new systems, the `v2 -> v3` recipe's must-run script uses it for tracked source migration, and `prepareUpdateTransaction()` uses that same helper at the pre-validation seam for a pending `v2 -> v3` hop instead of relying on loader-time tolerance fallback.
- The `reference-system/` and the frozen `language-upgrades/fixtures/v3/` snapshot use the portable v3 facade. The frozen `language-upgrades/fixtures/v2/` snapshot remains the pre-recipe legacy-shim fixture used to prove the cutover.
- ALS-077 does not require a repo-wide raw-object or import-free authored syntax rewrite. A future follow-up may simplify the surface further, but that is outside this decision.

## Normative Effect

- Required: ALS-077 lands as the `v2 -> v3` language hop and is classified `migration_required`.
- Required: authored entrypoint loading in ALS v3 is location-independent with respect to the plugin install tree.
- Required: steady-state ALS v3 authored entrypoints import only the local `authoring.ts` surface rather than a direct compiler path.
- Required: ALS v3 authored entrypoints reject value imports outside the local `authoring.ts` surface.
- Required: the ALS v3 `authoring.ts` surface is portable and self-contained as tracked system source.
- Required: the `v2 -> v3` recipe rewrites legacy relative-shim `authoring.ts` files before ALS v3 validation becomes authoritative for that system.
- Required: compiler-owned constants used by authored data remain available through the portable local authoring facade.
- Required: `language-upgrades/recipes/v2-to-v3/` ships the must-run rewrite script and `language-upgrades/fixtures/v3/` ships the post-recipe authored snapshot.
- Allowed: a future follow-up to remove the identity-helper call style entirely, as long as the new syntax remains location-independent and the migration story is explicit.
- Allowed: the shared portable-facade helper to be reused by `/install`, the `v2 -> v3` recipe, and the pre-validation seam in `prepareUpdateTransaction()`.
- Rejected: new authored entrypoints importing value symbols from `./helpers.ts`, `@als/compiler/...`, `../../alsc/compiler/...`, or any other surface besides the local `authoring.ts` helper file.
- Rejected: indefinite dual-shape support where ALS v3 keeps validating both the legacy relative shim and the portable facade as equal steady-state authored syntax.
- Rejected: symlinked `.als/alsc`, generated `node_modules/@als/compiler`, `package.json#imports`, or a package-manager install as the canonical runtime resolution contract for authored ALS systems.
- Rejected: keeping host Bun module resolution as the arbiter of whether authored ALS entrypoints are readable.
- Rejected: relying on a loader-time tolerance fallback instead of the `v2 -> v3` language-upgrade-recipe to end the legacy-shim epoch.

## Compiler Impact

- Widen `SUPPORTED_ALS_VERSIONS` to include `3`.
- Refactor `nfrith-repos/als/alsc/compiler/src/authored-load.ts` so ALS v3 authored entrypoints load through compiler-owned semantics for the portable local facade instead of through a plugin-tree-relative import.
- Add the shared portable-facade emission helper used by `/install`, the `v2 -> v3` recipe script, and the pre-validation seam in `nfrith-repos/als/alsc/update-transaction/src/index.ts`.
- Add a dedicated authored-load diagnostic for unsupported imports outside the local `authoring.ts` surface.
- Author `nfrith-repos/als/language-upgrades/recipes/v2-to-v3/` and add `language-upgrades/fixtures/v3/`.
- Update compiler and upgrade-language regression coverage to prove: v2 fixture pre-recipe, recipe rewrite to v3 facade, portable external-root validation, reference-system v3 validation, and unsupported-import rejection.

## Docs and Fixture Impact

- Update `nfrith-repos/als/skills/docs/references/shape-language.md` to teach the ALS v3 portable local facade, the `v2 -> v3` recipe cutover, and the v3-only import boundary.
- Update `nfrith-repos/als/skills/install/SKILL.md` and `nfrith-repos/als/skills/install/references/bootstrap-templates.md` so `/install` writes the portable local facade for new systems.
- Paint the `v2 -> v3` recipe bundle, the revised fixture matrix, and the generic-placeholder import examples into fixture review before compiler work starts.
- Retire the AAT shim duct tape in `als-factory/docs/testing/scripts/aat-update-preflight.sh` and the related testing-playbook prose once the compiler path lands.

## Alternatives Considered

- Canonicalize generated resolver state under the system root (`.als/alsc` symlink, generated `node_modules`, or `package.json#imports`).
- Rejected because it solves the bug by introducing machine-local install-state machinery as part of the language contract.

- Ship the compiler as a normal package-manager dependency every ALS system installs.
- Rejected for this pass because it widens the product decision to package/lockfile ownership and still leaves authored entrypoints dependent on system-local install state.

- Rewrite the authored language immediately to raw object exports or a fully import-free DSL.
- Rejected for ALS-077 because the location-dependence bug can be closed without a repo-wide authored-syntax migration, and the operator explicitly asked to separate "clean runtime contract" from optional surface cleanup.

## Non-Goals

- A full authored-syntax redesign in the same job.
- A new compatibility-class contract or enum-surface redesign.
- Changing module or Delamain semantics beyond the authoring-load/location-independence boundary.
