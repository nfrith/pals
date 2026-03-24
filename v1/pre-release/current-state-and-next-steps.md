# ALS v1 Current State And Next Steps

This note is a point-in-time pre-release snapshot captured on 2026-03-24. It should not be maintained as a living status document. As the referenced work lands elsewhere and the open items are resolved, this note should be deleted rather than updated in place.

This note captures where the ALS v1 pre-release work currently stands after the production-evolution review, the migration-model discussion, and the first round of compiler/spec changes.

---

## 1. Where We Are Now

- The pre-release review surfaced one dominant problem: ALS v1 does not yet have a production evolution model.
- That problem showed up repeatedly in different forms: no migration path, no coexistence model, additive changes acting like breaking changes, and weak machine-readable support for upgrade tooling.
- The core distinction is now clear:
  - Module-schema migration is one problem.
  - ALS language-version migration is a separate problem.
- The first foundation work for ALS language-version handling has started:
  - `als_version` now exists as the authored source version signal.
  - The compiler rejects unsupported ALS versions before module loading.
  - Validator output now has an explicit versioned contract.
  - Diagnostics now support machine-readable `reason` values for tooling.
  - Source-file `schema` was removed from authored ALS YAML to avoid a permanent second version knob.
  - Versioned validator output is now in place, but output compatibility still requires explicit discipline if external tooling starts to depend on it.

## 2. Decisions Already Made

- ALS language-version upgrades use a whole-system cutover model.
- One system targets one ALS version at a time.
- Long-lived mixed ALS versions inside one system are out of scope.
- Module-schema migration and ALS language-version migration must be treated as different systems.
- Module-schema migration remains the more classical problem and should follow the v0 `als-mutate` / `als-migrate` pattern.
- ALS language-version migration is the harder problem and should be treated like framework or language upgrades:
  - deterministic rewrite tools for mechanical changes
  - supervised agent-guided handling for semantic cases
- `als_version` is the only authored source version signal.
- Source-file `schema` is intentionally gone from `system.yaml` and module shape YAML.
- Output `schema` stays because validator JSON is consumed out of context and benefits from being self-describing.

## 3. What Comes Next

- Write and settle the remaining migration-governing SDRs before building upgrade tooling:
  - keep the split between module-schema migration and ALS-version migration explicit
  - define identity/stability surfaces clearly
  - define upgrade classification such as mechanical vs semantic-assisted
- Build the ALS language-version upgrade pipeline:
  - preflight scan
  - deterministic rewrites
  - machine-readable failure reporting
  - explicit stop points for semantic review
- Build module-schema migration as a separate track using the v0 pattern.
- After the foundation is stable, add operator ergonomics:
  - deprecation lifecycle support
  - stronger rollout tooling
  - safer impact analysis / introspection

## 4. What Is Still Unsolved

- There is still no actual ALS language-version upgrade toolchain.
- There is still no first-class migration lifecycle in the language itself.
- `declaration = presence` still means additive field and section changes act like operationally breaking rewrites until module-schema migration is real.
- Public names are effectively API until ALS grows aliasing or other indirection:
  - `system_id`
  - module ids
  - entity names
  - section names
- Identity-sensitive rewrites remain a real risk surface:
  - `system_id`
  - module ids
  - entity names
  - section names
  - path-template lineage placeholders
- Partial validation is still not a trustworthy staged-rollout primitive.
- Deprecation is still effectively binary because warnings are not yet a real lifecycle tool.
- Skill bundles are now part of the ALS-authored source contract, but the broader lifecycle around skill projection, migration, and automation is still unfinished.
- The system still needs a practical answer for how far automation can go before semantic review is required.

## 5. Practical Reading Of The Current State

- ALS v1 is no longer pretending that source-file format versioning is a separate concern from language-version cutover.
- The project now has a cleaner foundation for upgrade tooling, but not the tooling itself.
- The next meaningful milestone is not more cleanup. It is designing and implementing the first real ALS-version upgrade path.
