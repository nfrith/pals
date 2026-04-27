# ALS v1 Compiler Production-Evolution Risks

1. `moduleFilter` is now a scoped rollout gate, not a whole-system health signal. `validateSystem()` loads the selected module plus its dependency closure, resolves refs against that closure, and emits `SYSTEM_FILTER_CONTEXT_INVALID` when the dependency context cannot be trusted.
   Refs: `alsc/compiler/src/validate.ts:223`, `alsc/compiler/src/validate.ts:234`, `alsc/compiler/src/validate.ts:3827`, `alsc/compiler/README.md:29`, `alsc/compiler/test/system-negative.test.ts:193`.
   This makes filtered validation trustworthy for the selected module's declared dependency surface, but it is still not a substitute for full-system validation when operators need guarantees about unrelated modules or overall deploy readiness.
   Recommendation A: keep the scoped contract explicit in docs and CLI help so operators do not over-read a clean filtered run.
   Recommendation B: if future rollout workflows need broader guarantees, add an explicit whole-graph preflight mode rather than stretching `moduleFilter` beyond its declared semantics.

2. Module versioning is a big-bang cutover model with no compatibility window. The language exposes one active `version` per module in `system.yaml`, and the compiler always infers exactly one live shape file from it.
   Refs: `alsc/compiler/src/schema.ts:530`, `alsc/compiler/src/validate.ts:195`, `alsc/compiler/src/validate.ts:1371`, `alsc/compiler/README.md:7`, `reference-system/README.md:60`.
   In production, any breaking shape change becomes an atomic subtree rewrite: old and new record contracts cannot coexist, and the compiler offers no migration-mode semantics.
   Recommendation A: define an explicit compatibility model now, such as current-version-only with required atomic rewrites, or bounded N/N+1 coexistence during rollout.
   Recommendation B: add validator support for migration windows if coexistence is intended, instead of leaving version numbers as storage labels with no operational meaning.

3. Cross-module references have no backward-compatibility or rename story. ALS refs are versionless `als://system/module/...` URIs, and canonical identities are emitted from the same versionless text surface. Field targets also name only `module` and `entity`, while dependency validation checks only that the module is declared, not that the target entity exists in the dependency's active shape or remains compatible over time.
   Refs: `alsc/compiler/src/refs.ts:16`, `alsc/compiler/src/validate.ts:1181`, `alsc/compiler/src/schema.ts:122`, `alsc/compiler/src/schema.ts:164`, `alsc/compiler/src/validate.ts:1246`.
   That means renaming `system_id`, `module_id`, or entity names is a hard break, and downstream compatibility failures degrade late into unresolved-ref behavior.
   Recommendation A: either declare `system_id`, `module_id`, and entity names immutable public API once published.
   Recommendation B: or introduce alias/version indirection for refs and cross-module targets before production adoption.

4. Entity path-template semantics are identity-critical but under-specified and under-validated. The schema only requires a non-empty path containing `{id}`. The path parser treats arbitrary placeholder names as binding keys, while canonical URI construction later assumes those bindings line up with lineage entity names.
   Refs: `alsc/compiler/src/schema.ts:348`, `alsc/compiler/src/schema.ts:380`, `alsc/compiler/src/parser/path-template.ts:18`, `alsc/compiler/src/validate.ts:1192`.
   In production, a seemingly harmless path-template rename can silently stop canonical identity construction, duplicate detection, and parent-prefix checks instead of producing a crisp migration diagnostic.
   Recommendation A: define placeholder semantics normatively and validate them at shape-load time, especially parent-lineage placeholders.
   Recommendation B: or stop deriving identity from placeholder-name conventions and require explicit parent-id sourcing in the entity contract.

5. The diagnostic contract is too coarse for long-term rollout tooling. Many materially different failures collapse into umbrella codes such as `SHAPE_INVALID` and `BODY_CONSTRAINT_VIOLATION`. The test suite already compensates by asserting message fragments for distinct cases.
   Refs: `alsc/compiler/src/diagnostics.ts:9`, `alsc/compiler/src/diagnostics.ts:12`, `alsc/compiler/src/validate.ts:499`, `alsc/compiler/src/markdown.ts:220`, `alsc/compiler/test/body-contract-negative.test.ts:25`, `alsc/compiler/test/body-contract-negative.test.ts:40`, `alsc/compiler/test/body-contract-negative.test.ts:158`.
   In production, operators will do the same, which will make wording changes de facto breaking changes.
   Recommendation A: introduce stable machine-readable subreasons before external tooling has to parse `message`.
   Recommendation B: if broad codes are intentional, explicitly declare message text unstable and add structured payload fields whose compatibility is versioned.

All 119 current tests pass. These findings are about production evolution traps, not about the current suite being red.
