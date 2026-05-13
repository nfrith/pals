# Validate Command and Plugin Layout Boundary Contract

## Status

Accepted

## Context

- Before ALS-113, `alsc validate` had one audience and one job: validate ALS-managed systems rooted at `.als/system.ts`.
- ALS-113 fixed Claude launcher placeholder expansion, but it also added `plugin_surface_only` behavior and plugin-layout diagnostics (`PAL-CV-SYS-012/013/014`) to `validate.ts` so the ALS repo root could be checked through `alsc validate nfrith-repos/als/`.
- ALS-114 surfaces why that boundary is wrong:
  - Claude auto-discovers `hooks/hooks.json` at plugin root
  - Codex also used `hooks/hooks.json` as its bundle path
  - placeholder-family correctness (`${CLAUDE_PLUGIN_ROOT}` vs `${PLUGIN_ROOT}`), manifest pointers, and magic-path avoidance are harness/plugin-layout concerns, not authored ALS language concerns
- ALS-114 planning records the architecture rationale in [`../../../als-factory/artifacts/ALS-114/validate-command-and-hook-layout-boundary-architecture.md`](../../../als-factory/artifacts/ALS-114/validate-command-and-hook-layout-boundary-architecture.md). The recommended path is to restore `alsc validate` to system validation only and move plugin-layout lint into repo-local test coverage.

## Decision

- `alsc validate` validates ALS systems only.
- A valid `alsc validate` target is a root that contains `.als/system.ts` and can be loaded as an ALS system.
- `alsc validate` must not enter a plugin-surface-only mode when `.als/system.ts` is absent but plugin manifests are present.
- Invoking `alsc validate` on a non-system root must fail clearly instead of returning a misleading success result. The operator-visible message may describe the missing `.als/system.ts` or equivalent "not an ALS system root" fact, but it must not run plugin-layout diagnostics.
- Harness-specific plugin-layout rules are not part of the `alsc validate` contract. This includes:
  - hook declaration file placement
  - manifest hook-path existence
  - poisoned magic-path avoidance such as root `hooks/hooks.json`
  - placeholder-family correctness such as `${CLAUDE_PLUGIN_ROOT}` vs `${PLUGIN_ROOT}`
- Those plugin-layout rules belong in repo-local bundled-surface tests today, and may move to a separate SDLC-facing CLI in a future job if needed.
- For the bundled hook layout itself:
  - Claude per-hook JSON declarations live under `hooks/claude/`
  - the Codex bundle lives at `hooks/codex/hooks.json`
  - root `hooks/hooks.json` must remain absent
- `PAL-CV-SYS-012`, `PAL-CV-SYS-013`, and `PAL-CV-SYS-014` are not part of the `alsc validate` command surface after this decision. If helper code or tests keep equivalent assertions internally, they are no longer emitted by `alsc validate`.

## Normative Effect

- Required: `alsc validate <system-root>` validates ALS-managed records for a real ALS system root.
- Required: `alsc validate` on a non-system root fails explicitly and does not pretend the root validated successfully.
- Required: plugin-layout lint for the ALS plugin tree is enforced through repo-local `bun test` coverage rather than through `validate.ts`.
- Required: Claude hook declarations move under `nfrith-repos/als/hooks/claude/`, and `.claude-plugin/plugin.json` points at those new paths.
- Required: the Codex hook bundle moves to `nfrith-repos/als/hooks/codex/hooks.json`, and `.codex-plugin/plugin.json` points at that path.
- Required: `nfrith-repos/als/hooks/hooks.json` does not exist in the shipped plugin tree.
- Allowed: helper code from ALS-113 may be retained or relocated if it is no longer reachable from `alsc validate` and is used only by repo-local tests or later SDLC tooling.
- Allowed: a future job may introduce a sibling CLI such as `alsc plugin inspect`, but only under a separate decision record.
- Rejected: compiler-owned harness/plugin placeholder rules in `validate.ts`.
- Rejected: plugin-root success modes that return zero-module pass results for roots that are not ALS systems.
- Rejected: a serialized hook orchestrator or other parallelism-reducing workaround as part of this boundary fix.

## Compiler Impact

- Remove standalone plugin-surface detection and execution from `nfrith-repos/als/alsc/compiler/src/validate.ts`.
- Remove or de-surface `PAL-CV-SYS-012/013/014` from `nfrith-repos/als/alsc/compiler/src/diagnostics.ts` so they are no longer emitted by `alsc validate`.
- Update `nfrith-repos/als/alsc/compiler/src/cli.ts` behavior as needed so non-system roots fail clearly without activating plugin-layout validation.
- Re-home plugin-layout assertions into repo-local test coverage, reusing helper code only if that does not leak back into the command surface.

## Docs and Fixture Impact

- Add `058-validate-command-and-plugin-layout-boundary-contract.md` as the canonical decision record for ALS-114's command-boundary correction.
- Add [`../../../als-factory/artifacts/ALS-114/validate-command-and-hook-layout-boundary-architecture.md`](../../../als-factory/artifacts/ALS-114/validate-command-and-hook-layout-boundary-architecture.md) as the load-bearing rationale note.
- Update `nfrith-repos/als/hooks/CLAUDE.md` so the per-harness layout and poisoned-path rule are explicit.
- Update `nfrith-repos/als/alsc/compiler/README.md` and `nfrith-repos/als/skills/validate/SKILL.md` so `alsc validate` is documented as ALS-system validation only.
- Move or replace `nfrith-repos/als/alsc/compiler/test/hook-config-contracts.test.ts` with repo-local layout-contract coverage that proves:
  - root `hooks/hooks.json` is absent
  - Claude declarations live only under `hooks/claude/`
  - Codex uses `hooks/codex/hooks.json`
  - placeholder families and manifest paths are correct
- No authored ALS syntax changes are introduced, so no shape-language fixture round or language-upgrade recipe is required.

## Alternatives Considered

- Keep plugin-layout lint inside `alsc validate` and only move the hook files.
- Rejected because it leaves harness-specific plugin knowledge inside the compiler command surface and scales poorly as more harnesses appear.

- Add a new `alsc plugin inspect` CLI now.
- Rejected for this job because it expands scope and delays the defect fix. Repo-local tests are sufficient for ALS-114; a sibling CLI can be evaluated later if SDLC needs become real.

## Non-Goals

- New authored ALS syntax.
- A language-upgrade recipe or `als_version` change.
- Changes to the shared hook runtime semantics.
- Codex skill portability or runtime-harness projection.

## Follow-Up

- If ALS later needs operator-visible or release-automation plugin inspection beyond repo-local tests, open a separate job and SDR for a sibling SDLC-facing command such as `alsc plugin inspect`.
