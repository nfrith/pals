# Language And Module Releases

## Version Layers

ALS has three distinct version surfaces:

1. the ALS plugin/compiler release
2. the system-wide `als_version`
3. per-module version bundles under `.als/modules/<module_id>/vN/`

Conflating these surfaces is how release policy becomes incoherent. They have to move under different rules.

## Plugin And Compiler Releases

- The plugin/compiler release is the delivery vehicle for new compiler behavior, bundled skills, hooks, Foundry content, dashboard code, and statusline assets.
- During preview, operators should pin exact ALS releases and move deliberately.
- A compiler release must not silently reinterpret authored source. If a release invalidates existing authored systems, the release notes and the upgrade path must say so explicitly.

## `als_version` Policy

- `als_version` changes are rare whole-system cutovers.
- One ALS system runs one `als_version` at a time.
- Mixed-version ALS coexistence inside one system is out of scope.
- ALS language upgrades are hop-by-hop only: `v1 -> v2`, then `v2 -> v3`, not arbitrary skips.
- Each `als_version` cutover must ship a real preflight, dry-run, apply path, and machine-readable failure reporting.

The intended compatibility window is single-hop only. ALS does not promise indefinite support for old language epochs inside one repo.

## Module Bundle Policy

- Module evolution inside one `als_version` continues to use bundled `vN/` directories.
- `change` prepares the next bundle.
- `migrate` performs the cutover after validation and any required rewrite work.
- Active module versions do not change implicitly as a side effect of upgrading the compiler.

If a compiler/plugin release makes a module bundle invalid, that invalidation must fail loudly. Silent reinterpretation is forbidden.

## What Counts As Launch-Ready

ALS is not ready for a broad public push until all of the following are true:

- the operator can tell which compiler release they are on and which one they are moving to
- `als_version` cutovers have a first-class toolchain instead of ad-hoc manual rewrites
- module-bundle invalidation is explicit and documented
- release notes say whether a given change is additive, refresh-only, or migration-required

## Current Reality

Today the compiler supports `als_version: 1` only. There is no first-class `alsc upgrade` toolchain, no real warning/deprecation lifecycle, and no compatibility window enforcement beyond exact-version pinning plus hard validation failures.

That is acceptable for an early beta preview. It is not yet a finished release/update model for the world-facing launch push. The missing work is listed in `../launch/punchlist.md`.
