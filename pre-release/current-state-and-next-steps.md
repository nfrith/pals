# ALS v1 Current State And Next Steps

This note is a refreshed point-in-time snapshot of the ALS v1 repo state as of 2026-03-28.

It replaces the earlier pre-release framing that only covered the first round of production-evolution follow-up work. Since that snapshot, the repo has landed additional SDRs, compiler behavior, fixtures, and migration workflow material. The goal here is to separate what is now done, what is only partially in place, and what is still genuinely open.

---

## 1. Current State

- ALS v1 now has a materially stronger versioning and evolution foundation than the original pre-release note captured.
- The repo no longer only has language-version groundwork. It also now has:
  - accepted SDRs for ALS versioning, identity stability, validation output, module version bundles, canonical skills, and richer body semantics
  - compiler enforcement for the current ALS v1 source contract
  - example systems and smoke fixtures that validate clean under the current compiler
  - an explicit module-version change and migrate workflow at the skill and fixture level
- The center of gravity is still ALS v1, and `reference-system/` is now the working reference implementation.
- At the same time, the repo now also has compiler-valid rich-body fixtures that exercise the newer body contract rather than leaving it as design-only paint.

## 2. Done

- ALS language-version contract foundation is in place:
  - `.als/system.yaml` requires `als_version`
  - authored ALS source no longer uses a top-level `schema` field
  - unsupported ALS versions fail before module loading
  - validation output is versioned as `als-validation-output@1`
  - validation output includes `als_version`, supported ALS versions, and the compiler upgrade contract
- The core ALS versioning decisions are now explicit and accepted:
  - one system targets one ALS version at a time
  - ALS language-version upgrades are whole-system cutovers
  - long-lived mixed ALS versions inside one system are out of scope
  - identity-significant public surfaces are treated as stable API unless upgrade tooling rewrites them explicitly
  - upgrade work is framed as either deterministic mechanical rewrite or semantic-assisted work
- Module version bundles and canonical in-ALS skill bundles are implemented:
  - active module shapes resolve from `.als/modules/<module_id>/vN/shape.yaml`
  - `.als/system.yaml` now uses `skills`, not singular `skill`
  - active version history must be contiguous from `v1` through the declared version
  - active skill entrypoints live under `vN/skills/<skill_id>/SKILL.md`
  - required module versions above `v1` must carry inbound migration assets under `vN/migrations/`
- Claude Code skill projection now exists as a first downstream bridge:
  - active skill ids must be globally unique across the live system
  - the compiler now exposes a deterministic Claude deploy command
  - example systems now check in `.claude/skills/` as downstream projected output
- Filtered validation is now production-safe for its current contract:
  - module-filtered runs resolve refs against the selected module plus its transitive declared dependency closure
  - filtered output stays scoped to the selected module while preserving trustworthy cross-module ref resolution
  - filtered runs now emit `module_filter` in validation output
  - hidden dependency-context failures emit `SYSTEM_FILTER_CONTEXT_INVALID` instead of leaking false `REF_UNRESOLVED`
- Module migration workflow has returned in v1 form:
  - `change` is the successor to v0 `als-mutate`
  - `migrate` is the successor to v0 `als-migrate`
  - manifest and report contracts now exist
  - the repo includes a completed `evaluations v1 -> v2` cutover example in `reference-system/`
- Rich body semantics are no longer just future discussion:
  - unified `freeform` and `outline` body contracts landed
  - explicit title and preamble regions landed
  - GFM table blocks landed
  - curated markdown rejection semantics landed for raw HTML, reference-style syntax, and thematic breaks
  - the compiler test suite covers these rules
- The fixture state is stronger than the earlier note reflected:
  - `reference-system` validates clean as the working reference implementation, including the imported structural modules, rich-body document modules, and multi-format observability coverage
- Repo cleanup that changes the practical current state has also landed:
  - the deprecated v0 tree is gone
  - the repo was flattened by removing the old `v1/` directory nesting

## 3. Partially Done

- Diagnostic machine-readability is much better than it was, but not complete:
  - `reason` now exists and covers many important system, shape, and body subcases
  - the compiler and README still describe `reason` coverage as incremental, so some diagnostics may still emit `null`
- Module migration now exists as workflow and repository contract, but not yet as first-class language lifecycle:
  - version bundles, migration assets, manifest/report conventions, and cutover skills exist
  - the compiler still treats this structurally rather than semantically
  - it does not parse `SKILL.md` contents or migration manifest/report meaning
- Rich-body support is implemented enough to validate real fixtures, but the markdown/body surface is still intentionally curated:
  - ALS v1 now has a coherent supported subset
  - it is not trying to expose full mdast coverage
- Warning support exists in the output model, but not yet as a real lifecycle:
  - status summaries count warnings
  - there is still no meaningful emitted warning stream that can support deprecation budgeting or rollout policy

## 4. Not Done Yet

- There is still no ALS language-version upgrade toolchain.
- The compiler still supports `als_version: 1` only.
- There is still no first-class ALS language migration lifecycle in the language itself.
- There is still no mixed-version coexistence model for ALS language upgrades.
- `declaration = presence` still means additive field and section changes act like operationally breaking rewrites unless migration tooling handles them explicitly.
- Public identity surfaces are still effectively hard API because ALS v1 still has no aliasing, redirect, or compatibility indirection for:
  - `system_id`
  - module ids
  - entity names
  - section names
  - lineage placeholder names used by path templates
- Deprecation is still effectively binary:
  - the compiler does not currently emit warning diagnostics
  - there is still no real deprecation lifecycle support
- Skill projection now exists for Claude Code, but the richer harness-format design is still incomplete.
- `test-migration` is still intentionally unimplemented as a separate wrapper; `migrate` currently owns both dry-run and live-cutover flow.
- The repo still does not have a settled practical boundary for how far automation should go before semantic review is required.
- There is still no explicitly weaker partial-validation mode for fast local-only or syntax-only checks; filtered validation now aims to stay trustworthy rather than serving as a degraded shortcut.
- The format-gap questions for harness-specific skill metadata are still open:
  - where harness-specific frontmatter fields are declared
  - when `alsc/skills/new` decides those fields during authoring
  - how future harnesses such as Codex should fit the projection model

## 5. Next Meaningful Steps

- Build the first real ALS language-version upgrade path:
  - preflight scan
  - deterministic rewrite support
  - machine-readable failure reporting
  - explicit stop points for semantic review
- Add a real warning and deprecation lifecycle instead of keeping warnings as unused output plumbing.
- Decide how much more migration meaning should become first-class in ALS itself versus remaining in skill-driven workflow and bundle conventions.
- Decide where harness-specific frontmatter fields should live and how multi-harness projection should be modeled before broadening beyond Claude Code.
- Decide whether ALS should also expose an explicitly weaker local-only or syntax-only validation mode, now that module-filtered validation is intended to remain trustworthy.
- Keep tightening machine-readable output compatibility discipline before external tooling starts depending on it heavily.

## 6. Practical Reading Of The Current State

- ALS v1 is no longer only at the "cleaner foundation" stage.
- The repo now has real structural and workflow support for module-version evolution, canonical skills, and richer record bodies.
- Module-filtered validation is no longer an obvious trust gap in the compiler's day-to-day workflow surface.
- The main missing piece has narrowed: the largest open gap is now ALS language-version upgrade tooling and lifecycle, not the entire evolution story from scratch.
- The next meaningful milestone is therefore not another round of baseline cleanup. It is turning the accepted ALS upgrade model into an actual toolchain.
