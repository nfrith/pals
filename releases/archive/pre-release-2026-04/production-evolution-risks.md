# ALS v1 Production Evolution Risks

Assessment of what is likely to hurt once ALS v1 is used in a production system and the language or compiler needs to change underneath real data.

This note is narrower than `spec-upgrade-risks.md`. The focus here is operational reality: what happens when you come back later, change ALS, and then have to update production data and workflows.

---

## 1. ALS v1 is a single-state contract, not an upgrade contract

The repo explicitly says migrations were removed from the initial v1 scope. At the same time, `system.yaml` exposes exactly one active `version` per module, and the compiler always loads exactly that one shape file:

- `AGENTS.md`
- `alsc/compiler/src/schema.ts`
- `alsc/compiler/src/validate.ts`

That means ALS v1 tells you what the target state is, but not how old data becomes valid under the new state.

What hits you in prod:

- A shape change is effectively a cutover.
- Old and new record contracts do not have a defined coexistence model.
- The language gives you no migration window semantics.
- "Update prod" becomes a manual rewrite plan, not a language-governed rollout.

## 2. Additive changes are still breaking changes

SDR 001 makes declaration equal presence. Every declared field must appear. Every declared section must appear. There is no optional-field mechanism:

- `sdr/001-explicit-declaration-semantics.md`
- `skills/docs/references/shape-language.md`
- `alsc/compiler/src/validate.ts`

This is clean for strict validation, but it makes evolution expensive.

What hits you in prod:

- Adding one nullable field still requires touching every existing record in that entity set.
- Adding one section still requires editing every record body.
- There is no built-in `default`, `since_version`, transitional omission rule, or deprecation grace period.
- Even harmless-looking schema growth turns into fleet-wide content migration.

If you ship this, you should assume that many "small" ALS changes are operationally full-data migrations.

## 3. Public identity becomes effectively immutable

ALS refs are versionless `als://system/module/...` URIs, and canonical identity is built from:

- `system_id`
- `module_id`
- entity names
- parent lineage

Relevant implementation surfaces:

- `alsc/compiler/src/refs.ts`
- `alsc/compiler/src/validate.ts`
- `skills/docs/references/shape-language.md`

What hits you in prod:

- Renaming `system_id` rewrites every ref in the system.
- Renaming a module rewrites every inbound and outbound cross-module ref.
- Renaming an entity type rewrites every ref and every target contract that names it.
- Changing lineage shape changes canonical URIs for nested entities.

There is no aliasing, redirect, compatibility mapping, or versioned ref indirection. Once published, these names are API.

## 4. Path-template semantics are carrying more identity weight than the schema admits

The schema only requires that an entity path is non-empty and contains `{id}`. But the path-template parser treats placeholder names as binding keys, and canonical URI construction assumes those bindings align with lineage entity names:

- `alsc/compiler/src/schema.ts`
- `alsc/compiler/src/parser/path-template.ts`
- `alsc/compiler/src/validate.ts`

The docs already tell authors to use ancestor placeholders to encode lineage, so filesystem template design is not just storage layout. It leaks into identity.

What hits you in prod:

- A "simple" path-template rename can break canonical identity construction.
- Duplicate detection can degrade in surprising ways.
- Parent-prefix validation can stop meaning what you think it means.
- Some bad path changes fail late during record validation instead of failing crisply when the shape loads.

This is the kind of issue that becomes painful only after a real ref graph exists.

## 5. There is no first-class deprecation phase

The output model supports `warning`, and summaries count warnings, but the compiler does not currently emit warning diagnostics:

- `alsc/compiler/src/types.ts`
- `alsc/compiler/src/diagnostics.ts`
- `alsc/compiler/src/validate.ts`

So the lifecycle is effectively:

1. allowed
2. rejected

What hits you in prod:

- You cannot mark something as still valid but headed for removal.
- You cannot teach teams to clean up before a breaking compiler change lands.
- You cannot build stable rollout tooling around warning budgets because there are no warnings to budget against.

If you later introduce deprecation policy, you will be adding an entire lifecycle layer that the current spec and diagnostics do not yet model.

## 6. Diagnostic stability is not strong enough for production migration tooling

Many distinct failures collapse into broad diagnostic codes such as:

- `SHAPE_INVALID`
- `BODY_CONSTRAINT_VIOLATION`

The tests already compensate by asserting on message fragments for specific cases:

- `alsc/compiler/src/diagnostics.ts`
- `alsc/compiler/src/markdown.ts`
- `alsc/compiler/test/body-contract-negative.test.ts`

What hits you in prod:

- Any external tooling that classifies breakages will end up parsing `message`.
- Message wording becomes de facto API.
- Seemingly harmless diagnostic copy edits can break dashboards, CI gates, or migration scripts.

If production users are expected to automate upgrades, the machine-readable diagnostic contract needs to be stronger than it is now.

## 7. Filtered validation is a scoped rollout gate, not a whole-system health signal

The compiler now treats module-filtered validation as dependency-aware for its declared scope:

- `releases/archive/pre-release-2026-04/current-state-and-next-steps.md`
- `alsc/compiler/README.md`
- `alsc/compiler/src/validate.ts`
- `alsc/compiler/test/system-negative.test.ts`

Filtered runs load the selected module plus its transitive declared dependency closure, resolve refs against that closure, and emit `SYSTEM_FILTER_CONTEXT_INVALID` when the dependency context cannot be trusted.

What hits you in prod:

- A clean filtered run is now trustworthy for the selected module's declared dependency surface.
- It is still not a substitute for full-system validation when you need guarantees about unrelated modules or whole-system deploy readiness.
- Teams need to treat module-filtered validation as a scoped rollout gate, not as a whole-system health signal.

This is a narrower risk than before, but the operational contract still needs to stay explicit.

## 8. `skills` is already future debt in the system contract

The repo says skill/app management was removed from the initial v1 scope, but `system.yaml` still requires a `skills` array, and the shape-language reference still presents it as live placeholder metadata:

- `AGENTS.md`
- `alsc/compiler/src/schema.ts`
- `skills/docs/references/shape-language.md`
- `reference-system/README.md`

What hits you in prod:

- Systems will accumulate `skills` values before the field has settled semantics.
- If you later make `skills` more normative, you inherit old placeholder bundles and ids as compatibility baggage.
- If you later remove or weaken `skills`, you still have existing production systems authored around those declared active skill interfaces.

This is not a compiler break today. It is a contract-surface problem for later.

---

## Bottom Line

If ALS v1 is adopted in production in its current form, it should be treated as a freeze-the-world validation language, not as a language with a mature evolution model.

You should assume:

- public names are API
- additive changes are often breaking
- full-system validation remains the broadest gate
- filtered validation is trustworthy only within the selected module's declared dependency closure
- module-version bumps are cutovers, not rollouts
- migration mechanics will have to be invented later unless they are designed now

That does not mean ALS v1 is unusable. It means the first serious production-driven language change will force the project to confront versioning, deprecation, migration windows, and identity immutability all at once.

All current compiler tests pass. These are not red-test issues. They are lifecycle and language-design risks that show up once the system becomes real enough that change management matters.
