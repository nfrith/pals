# Location-Independent Authoring Contract

## Status

Proposed

## Context

- ALS systems currently depend on a location-sensitive `.als/authoring.ts` shim that re-exports compiler helpers and compatibility-contract values from a filesystem-relative path into `alsc/compiler/...`.
- That shim works by design only for systems that happen to live at the expected relative depth under the plugin root. `reference-system/` matches the assumption; Ghost hand-tunes around it; external AAT fixtures and ordinary edgerunner systems break.
- `nfrith-repos/als/alsc/compiler/src/authored-load.ts` currently evaluates authored TypeScript through host `require.resolve()` plus `require()`, so Bun/Node module resolution is implicitly part of the ALS language contract today.
- The live authored corpus in this checkout is narrower than that loader shape suggests. Every authored `system.ts`, `module.ts`, and `delamain.ts` imports only the local `authoring.ts`; the only shared runtime value observed in authored shapes is `COMPATIBILITY_CLASSES`.
- Research proved machine-local resolver artifacts can make the break go away technically (symlinked `.als/alsc`, generated `node_modules`, `package.json#imports` indirection), but the operator rejected those shapes as the canonical answer because they replace one brittle filesystem dependency with another.
- ALS-077 therefore needs a new decision record that moves authoring resolution ownership into ALS itself instead of into per-system install-state machinery.

## Decision

- ALS authored entrypoints are a compiler-owned declarative module surface, not an arbitrary Bun module graph. Runtime loading of `.als/system.ts`, `module.ts`, and `delamain.ts` must not depend on the system's filesystem relationship to the plugin install tree.
- The steady-state authored contract keeps the existing local import shape: authored entrypoints import only the standard local `authoring.ts` helper surface at the existing relative path (`./authoring.ts`, `../../../authoring.ts`, `../../../../../authoring.ts`).
- `system_root/.als/authoring.ts` becomes a self-contained portable local authoring facade. It may export identity helpers and compiler-owned constants used in authored ALS data, but it must not import from the plugin tree, generated `node_modules`, `package.json#imports`, or package-manager state.
- `/install` and the in-bundle `reference-system/` write the portable local facade by default. `/change` and `/migrate` preserve that file as ordinary tracked system source unless a future language contract explicitly revises it.
- Compiler-owned loading must continue to read legacy systems whose local `authoring.ts` still contains an old relative import into `alsc/compiler/...`. Validation, deploy, and `/update` preflight may not fail only because that legacy shim points at a non-existent host path.
- The compiler owns any necessary compatibility bridge for old shim shapes. If ALS later chooses to normalize old systems onto the portable local facade on disk, that rewrite happens as tracked authored-source change, not as ephemeral resolver-state repair.
- ALS-077 does not require a repo-wide authored syntax rewrite. The existing `defineSystem`, `defineModule`, and `defineDelamain` call surface remains valid in this job. A future follow-up may simplify the surface toward raw object exports or type-only `satisfies`, but that is outside this decision.

## Normative Effect

- Required: authored entrypoint loading is location-independent with respect to the plugin install tree.
- Required: steady-state authored entrypoints import only the local `authoring.ts` surface rather than a direct compiler path.
- Required: the local `authoring.ts` surface is portable and self-contained as tracked system source.
- Required: validation, deploy, and `/update` preflight accept legacy relative-shim systems during the cutover window instead of requiring machine-local symlink or `node_modules` repair.
- Required: compiler-owned constants used by authored data remain available through the local authoring facade.
- Allowed: a future follow-up to remove the identity-helper call style entirely, as long as the new syntax remains location-independent and the migration story is explicit.
- Allowed: a future tracked-source rewrite from legacy shims to the portable facade when ALS has a settled upgrade path for doing so.
- Rejected: symlinked `.als/alsc`, generated `node_modules/@als/compiler`, `package.json#imports`, or a package-manager install as the canonical runtime resolution contract for authored ALS systems.
- Rejected: keeping host Bun module resolution as the arbiter of whether authored ALS entrypoints are readable.
- Rejected: requiring fresh checkouts or copied systems to run a machine-local repair step before `.als/system.ts` can validate.

## Compiler Impact

- Refactor `nfrith-repos/als/alsc/compiler/src/authored-load.ts` so authored entrypoints load through compiler-owned semantics instead of through a plugin-tree-relative import.
- Add any loader-side helper modules needed to model the supported local authoring surface explicitly, including compatibility handling for legacy shim shapes.
- Update compiler regression coverage to validate authored TypeScript from system roots outside the plugin tree, covering `system.ts`, `module.ts`, and `delamain.ts`.
- Update `nfrith-repos/als/alsc/update-transaction/src/index.ts` tests or helper seams as needed so `/update` preflight is proven against external-root systems without machine-local resolver state.

## Docs and Fixture Impact

- Update `nfrith-repos/als/skills/docs/references/shape-language.md` to teach `.als/authoring.ts` as a portable local facade instead of as a relative import bridge into `alsc/compiler/...`.
- Update `nfrith-repos/als/skills/install/SKILL.md` and `nfrith-repos/als/skills/install/references/bootstrap-templates.md` so `/install` writes the portable local facade.
- Paint the proposed legacy/new `authoring.ts` shapes plus the allowed-import boundary into fixture review before compiler work starts.
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
