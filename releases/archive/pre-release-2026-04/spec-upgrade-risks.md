# ALS v1 Spec-Level Upgrade Risks

Assessment of what breaks when ALS v1 is deployed to a production system and the spec itself needs to evolve.

---

## 1. Shape-file format changes ride on ALS-version cutovers

ALS v1 no longer uses a separate top-level shape-file `schema` header. That avoids a permanent second version knob in authored source, but it means future shape-file format changes have to be handled as part of whole-system ALS upgrade tooling.

When you add a new field type (say `type: url`), a new block type, or change how variants work, you still need to answer:

- Does the new compiler rewrite existing shape files mechanically?
- Do old shape files need supervised review during upgrade?
- Is the change safe as a deterministic cutover, or does it require semantic assistance?

**What hits you in prod:** You update the compiler and raise `als_version`. Existing shape files may now need an upgrade rewrite even though they no longer carry their own format header. That is viable, but only if ALS upgrade tooling owns the rewrite explicitly instead of pretending the compiler can infer it for free.

## 2. `declaration = presence` makes every field addition a breaking change

SDR 001's design -- no optional fields, declared means must-be-present -- is the strictest possible choice. It's clean for validation but catastrophic for evolution.

Adding a single field to a shape means **every existing record must be edited** to include that field. There's no `default`, no `since_version`, no "treat-as-null-if-missing" grace period.

At 50 records this is annoying. At 500 it's a project. At 5000 it's why people build migration frameworks -- which you explicitly deferred.

**What hits you in prod:** You bump experiments from v2 to v3, adding a `risk_level` field. The compiler immediately fails on every existing experiment record. Someone has to touch every file. By hand? A script? The spec has no opinion. You'll end up writing ad-hoc sed/awk scripts that aren't governed by the spec they're supposed to serve.

## 3. No migration tooling means the spec governs the target but not the journey

v0 had `als-mutate` and `als-migrate`. v1 removed them. But module shapes DO version -- the experiments module demonstrates v1->v2 with added fields. The spec says what v2 records must look like. It says nothing about how v1 records become v2 records.

This isn't just a tooling gap. It's a **spec gap**. A language that governs structured data but has no concept of data transformation is a language that governs snapshots, not systems. Production systems aren't snapshots -- they're living data stores that evolve.

**What hits you in prod:** You change `system.yaml` to point experiments at v3. The compiler fails. Now you're in a state where:
- The old shape (v2) validates the existing data
- The new shape (v3) is what you want
- There's no spec-governed path between them
- You can't partially migrate (some records v2, some v3)
- The compiler is all-or-nothing

## 4. ALS URIs are permanent and fragile

`als://system-id/module/entity/id` -- every segment is load-bearing with no escape hatch:

- **Rename a module?** Every ref to every entity in that module breaks across the entire system.
- **Rename an entity type?** Every ref from every other module breaks.
- **Change `system_id`?** Every ref in every record breaks.

There's no aliasing, no redirect, no deprecation period. A rename is a cascade that touches potentially every file in every module that references the renamed thing.

**What hits you in prod:** You realize `client-registry` should just be called `clients`. That's a change to `system.yaml`, the module's directory name, and every `client_ref` in every record in every module that declared a dependency on `client-registry`. One rename, hundreds of file edits, zero tooling support.

## 5. Section names are structural and unversioned

Sections are identified by string names in both the shape (`ACTIVITY_LOG`) and the record body (`## ACTIVITY_LOG`). They're simultaneously schema identifiers AND rendered headings. If you rename one:

- Update the shape definition
- Update every record's markdown body (these are `h2` headings)
- No alias, no fallback, no deprecation

**What hits you in prod:** You decide `ACTIVITY_LOG` should be `CHANGELOG`. Shape change is one line. Record changes are N files, each requiring a heading rename inside markdown body content -- which isn't frontmatter, so it's not even a clean YAML key rename. It's a string replacement inside prose.

## 6. Path templates couple schema to filesystem layout

`programs/{program}/experiments/{id}/{id}.md` means the directory tree IS the data model. Restructuring the hierarchy (flatten, add a nesting level, change the self-naming convention) requires moving files on disk, which means:

- Git history fractures (moves are delete + create in many tools)
- Any external system that stored file paths breaks
- Parent refs need revalidation

**What hits you in prod:** You realize three levels of nesting (`program/experiment/run`) is too deep and want to flatten. That's a shape change PLUS a mass file reorganization PLUS potential ref updates. The spec change is the easy part.

## 7. The compiler output contract still needs compatibility discipline

The validator now emits a versioned output contract, which is the right direction. But versioning the output does not remove the need to manage compatibility intentionally.

**What hits you in prod:** You add a new diagnostic phase or reshape one part of the output. Consumers that key only on the declared output schema can adapt cleanly if you honor that contract. Consumers that still assume a looser or undocumented structure can still break.

## 8. No "what would break" introspection

When you sit down to make a spec change, you can't ask: "if I make this change, which of my production systems break and how badly?" You'd have to:

1. Make the change
2. Run the new compiler against every system
3. Read the diagnostics
4. Decide if the damage is acceptable

There's no dry-run, no impact analysis, no diff between spec versions. You're flying blind until you pull the trigger.

---

## The Meta-Problem

These all stem from one root cause: **ALS v1 is designed as a validation language, not a lifecycle language.** It answers "is this data valid right now?" but not "how does this data evolve?" The spec governs the end state but not the transition.

This is a common and reasonable choice for a v1. But it means that the first time you need to change the spec and update prod, you'll be doing one of two things:

1. **Building the migration system under pressure** -- because prod is broken until you do
2. **Manually scripting each migration** -- which works but accumulates tech debt that the spec can't govern

The irony is that you already identified this in v0 (the `als-mutate`/`als-migrate` skills existed for a reason) and consciously deferred it. The question isn't whether you'll need it -- you already know you will. The question is whether the current design makes it harder to add later than it needs to be.

My honest assessment: **it does**, primarily because of the `declaration = presence` rule (SDR 001) and the fact that ALS upgrades still need explicit cutover tooling rather than a first-class migration lifecycle in the language. Those two decisions combine to make every evolution a cliff rather than a slope. You can't add a field without touching every record, and you can't update ALS semantics safely in production without owning the rewrite path.

If I were you, before shipping to prod, I'd think hard about whether SDR 001 needs a companion SDR that defines a `default` or `added_in_version` mechanism -- not to make fields optional (that dilutes the strictness you want), but to give the migration window a spec-governed shape instead of leaving it to ad-hoc scripts.
