# TODO

## Status Legend

- `unresolved`: ambiguity is documented, but no preferred solution is selected yet
- `proposed`: a preferred solution exists and is written down, but the normative specs/files are not updated yet
- `resolved`: the normative specs/files are updated and the ambiguity is closed

Workflow for now: `unresolved` -> `proposed` -> `resolved`

## Open Ambiguities

### 1. Duplicate ID in fixture contradicts spec

**Status:** resolved
**Severity:** critical — blocks compiler identity validation
**Decision Record:** [ITEM-1-qualified-logical-identity.md](ITEM-1-qualified-logical-identity.md)

---

### 2. Entity path pattern matching has no formal definition

**Status:** unresolved
**Severity:** critical — blocks entity inference and path validation

`MODULE.md` declares `entity_paths` using patterns like:
```yaml
entity_paths:
  epic: epics/<EPIC-ID>.md
  program: programs/<PROGRAM-ID>/<PROGRAM-ID>.md
  experiment: programs/<PROGRAM-ID>/experiments/<EXPERIMENT-ID>/<EXPERIMENT-ID>.md
  run: programs/<PROGRAM-ID>/experiments/<EXPERIMENT-ID>/runs/<RUN-ID>.md
```

The compiler must match actual file paths against these patterns to infer entity type (record-validation Phase 2, step 3) and validate path correctness (Phase 7, rule 1). But there is no formal specification of the pattern language:

1. **Wildcard semantics:** Is `<EPIC-ID>` a wildcard matching any single path segment? Any string? Does it have character constraints?
2. **Repeated variables:** When `<PROGRAM-ID>` appears twice in `programs/<PROGRAM-ID>/<PROGRAM-ID>.md`, must both matched segments have the same value? The fixture says yes (e.g. `programs/PRG-0001/PRG-0001.md`), but no rule enforces this.
3. **Ambiguity resolution:** Given a file path, multiple entity patterns could match. What is the precedence? (Most-specific-wins? Longest-match? Declaration order?)
4. **Variable name semantics:** Are variable names like `<PROGRAM-ID>` meaningful tokens the compiler should parse, or are they just documentation? If meaningful, what is the naming convention?

Without this spec, the compiler cannot reliably infer which entity a file belongs to or validate that a file lives at the correct path.

**Files:** `palsc/references/module-schema-definition.md:8-9`, `palsc/references/record-validation.md:53`

---

### 3. Nested path-parent/ref-parent consistency algorithm is undefined

**Status:** unresolved
**Severity:** critical — blocks nested hierarchy validation

`record-validation.md` Phase 7 rule 3 states: "For nested hierarchies, path-parent consistency and ref-parent consistency must both hold." But the algorithm connecting path segments to ref fields is not specified.

**Concrete example of what this means:**

Take `RUN-0001.md` at path `programs/PRG-0001/experiments/EXP-0001/runs/RUN-0001.md`. Its frontmatter has:
```yaml
experiment_ref: "[experiment-0001](pals://workspace/experiments/program/PRG-0001/experiment/EXP-0001)"
```

The compiler needs to verify two things:
- **Path-parent consistency:** The file physically lives under `PRG-0001/` and `EXP-0001/` directories. The parent IDs embedded in the filesystem path should match the IDs implied by the canonical experiment URI.
- **Identity-contract parent consistency:** The `experiment_ref` canonical URI target should be the immediate parent of the run and should be a strict prefix of the run's canonical URI.

The undefined parts:
1. **How does the compiler extract parent IDs from the path?** It must parse `programs/PRG-0001/experiments/EXP-0001/runs/RUN-0001.md` and know that `PRG-0001` is the program ancestor and `EXP-0001` is the immediate experiment parent. This requires overlaying the run's entity_path pattern against the program and experiment entity_path patterns to identify which path segments correspond to which ancestor entities.
2. **What is the matching algorithm?** Given entity_path patterns for all entities in a module, how does the compiler determine that a run's path structurally contains a program path and an experiment path, and therefore the run is a child of that experiment under that program?

This is the most algorithmically complex validation rule in the system and it has the least specification. A naive implementation would get flat modules right but fail on the experiments module's 3-layer hierarchy.

**Files:** `palsc/references/record-validation.md:133-135`, `example-systems/pristine-happy-path/workspace/experiments/MODULE.md:8-10`

---

### 4. Schema file authority is ambiguous

**Status:** unresolved
**Severity:** significant — affects compiler input resolution and migration lifecycle

Schemas exist in two locations:
- `workspace/<module_id>/.schema/<entity>.md` (workspace copy)
- `.claude/skills/<module-skill>/vN/schemas/<entity>.md` (skill versioned copy)

In the pristine fixture, both are identical for the deployed version. But no rule defines:

1. **Which location does the compiler read from?** `record-validation.md` lists `schema_dir_path` as either location but does not specify a default or precedence.
2. **Who creates/updates workspace `.schema/`?** `pals-migrate` Step 5 updates `MODULE.md` and the skill router but never mentions updating `workspace/.schema/`. Is it a build artifact generated by the compiler? Manually maintained? Copied during migration?
3. **Must they be identical?** If they diverge, which wins? Is divergence itself a validation error?
4. **Is workspace `.schema/` even required?** The `module-skill-definition.md` requires `vN/schemas/` to exist with one file per entity. No equivalent rule exists for `workspace/.schema/`.

An implementer needs to know: read from workspace, read from skill, or require both and verify they match?

**Files:** `palsc/references/record-validation.md:19`, `palsc/references/module-skill-definition.md:79`

---

### 5. CLI interface for `palsc validate` is undesigned

**Status:** unresolved
**Severity:** significant — blocks compiler packaging and integration with pals-migrate

`palsc validate` is referenced in `pals-migrate` (Steps 2, 4, 5) with `<!-- TODO -->` markers. The compiler output shape is fully defined (`palsc/references/compiler-error-shape.md`), but the invocation interface is not:

1. **Arguments:** `pals-migrate` uses two different invocation forms:
   - `palsc validate <module_skill_path>` (Step 2)
   - `palsc validate <module_data_path> --schema <path>` (Steps 4, 5)
   These imply different modes (skill-rooted vs data-rooted with explicit schema override). Are both real? Are there others?
2. **Output format:** JSON to stdout? To a file? Pretty-printed for humans with a `--json` flag?
3. **Exit codes:** 0 for pass, 1 for fail, 2 for warnings-only? Or just 0/1?
4. **Scope:** Does `palsc validate` validate one module or all modules in a workspace? Can it validate a single file?
5. **Discovery:** How does the compiler find `MODULE.md` from a skill path? Convention (`<module-skill>` -> `workspace/<module_id>/`) or explicit argument?

**Files:** `palsc/skills/pals-migrate/SKILL.md:34-36,74-75,101-102`

---

### 6. Workspace/module discovery mechanism is missing

**Status:** unresolved
**Severity:** significant — blocks cross-module reference resolution

Cross-module reference validation (record-validation Phase 6) requires the compiler to resolve URIs like `pals://workspace/people/person/PPL-000101`. This means it must locate the `people` module, load its records, and build a canonical identity index.

Currently there is no defined mechanism for this:
1. **No workspace manifest.** There is no top-level file listing all modules in a workspace.
2. **No `.pals` marker or config file.** Nothing marks a directory as a PALS workspace root.
3. **Implicit convention only:** `workspace/<module_id>/MODULE.md` is the pattern in the fixture, but no spec says "scan `workspace/*/MODULE.md` to discover modules."
4. **MODULE.md `references.modules` declares dependencies** but doesn't say where they live — only `namespace` and `module_id`.

The compiler needs either:
- (a) An explicit workspace root discovery rule (scan `workspace/*/MODULE.md`), OR
- (b) A workspace manifest file, OR
- (c) All referenced module paths passed as CLI arguments.

**Files:** `palsc/references/record-validation.md:46-48`, `palsc/references/module-schema-definition.md:21-23`

---

### 7. Body section null detection rule is imprecise

**Status:** unresolved
**Severity:** minor — easy to resolve but needs an explicit rule

Fixture records use bare `null` text as the empty marker for nullable body sections:
```md
## NOTES

null
```

`record-validation.md` Phase 4 says: "explicit empty marker is literal `null`". `content-schema-definition.md` says: `empty_marker: null`.

The compiler needs a precise detection rule:
1. Is the check: trimmed section content exactly equals the four-character string `null`?
2. Is it case-sensitive? (`Null`, `NULL` — valid or invalid?)
3. What if legitimate prose content happens to be the word "null"? (Unlikely but possible.)
4. What about `null` followed by whitespace or blank lines?

The fixture consistently uses lowercase `null` alone on a line. The likely rule is: "section content, after trimming leading/trailing whitespace, is exactly the string `null` (case-sensitive)." But this should be stated explicitly.

**Files:** `palsc/references/record-validation.md:97-98`, `palsc/references/content-schema-definition.md:17`

---

### 8. Correlation ID is required for orchestrated chains but is not part of the canonical read envelope keys

**Status:** unresolved (carried forward)
**Severity:** deferred — not needed for compiler, relevant for orchestrator

`SPEC.md:35-39` defines canonical response envelope keys as `answer`, `evidence`, `confidence`, `uncertainties`. `SPEC.md:324` requires "a correlation ID per orchestrated request chain." These two statements are not reconciled — correlation ID is required but has no home in the envelope.

**Files:** `SPEC.md:35`, `SPEC.md:324`

---

### 9. Display-label warning target is undefined

**Status:** unresolved
**Severity:** minor — blocks deterministic implementation of `PAL-RV-REF-005`

`record-validation.md` says a ref display-label mismatch against the target `title/id` is a warning, and `SPEC.md` says display labels are only soft-validated. But there is no canonical definition of where a target record's "title" comes from.

The compiler needs an exact rule:
1. Is the display label compared against target `id` only?
2. If a record has a `title` frontmatter field, does that override `id`?
3. If there is no `title` frontmatter field, should the compiler look at the body H1?
4. If no canonical title source exists, should the warning be skipped entirely?

Without this, two valid compilers could emit different warning sets for the same workspace.

**Files:** `palsc/references/record-validation.md:127-128`, `SPEC.md:382`

---

### 10. Diagnostic registry does not cover all compiler failure classes

**Status:** unresolved
**Severity:** significant — blocks stable diagnostics for non-record validation paths

The compiler output contract requires stable, registry-backed diagnostic codes. The current registry covers schema, record, and some module-contract errors, but it does not cover several failure classes implied elsewhere in the spec.

Examples currently lacking codes:
1. Module skill router validation failures:
   - missing required headings
   - router/load-target version mismatch
   - invalid skill directory basename
   - missing `vN/content/SKILL.md`
   - missing `vN/schemas/<entity>.md`
   - missing `vN/migrations/MANIFEST.md` for `v2+`
2. Manifest validation failures:
   - missing required frontmatter keys
   - invalid enum values
   - invalid body output sections
3. Schema-content failures beyond the current three codes:
   - unknown section-contract keys
   - invalid/missing H1 structure

If the compiler is expected to validate these surfaces, the code registry must be expanded first or in parallel.

**Files:** `palsc/references/compiler-error-shape.md:5,70`, `palsc/references/diagnostic-codes.md:37-86`, `palsc/references/module-skill-definition.md:63-86`, `palsc/references/manifest-template.md:3-53`

---

### 11. Manifest validity and migration-report contracts are incomplete

**Status:** unresolved
**Severity:** significant — blocks `pals-mutate`/`pals-migrate` implementation beyond file-presence checks

The spec clearly requires `vN+1/migrations/MANIFEST.md`, says `pals-migrate` must fail if the manifest is missing or invalid, and requires a migration report with per-record status and failures. But the exact validation contract is incomplete.

Missing normative details:
1. What makes a manifest "invalid" beyond missing frontmatter fields?
2. Are top-level frontmatter keys exact-match only, as in other specs?
3. Are mutate output sections required in the body, and must they appear exactly once?
4. Are `null`-allowed sections optional or required to be present with explicit `null`?
5. What is the canonical migration-report format, fields, and status vocabulary?
6. What are the machine-checkable gates for "ready-for-migrate" versus "migrated"?

Right now we have a template, not a full validator contract.

**Files:** `SPEC.md:402-418`, `SPEC.md:558`, `SPEC.md:619`, `palsc/references/manifest-template.md:3-53`, `palsc/references/module-skill-definition.md:85`

---

### 12. State-transition validation is referenced but has no declaration model

**Status:** unresolved
**Severity:** significant — compiler scope is ambiguous

`SPEC.md` says the linter should enforce state transitions, but no current schema surface defines how valid transitions are declared.

Open questions:
1. Are transitions declared in schema frontmatter, schema body, module skill content, or elsewhere?
2. Is this meant only for known business fields like `status`, or for arbitrary enum fields?
3. Is transition validation part of `palsc validate`, or a later write-time check only?
4. If it is not part of the baseline compiler, it should be removed from the linter responsibility list.

Until this is resolved, "compiler responsibilities" overstate what the validator can actually implement.

**Files:** `SPEC.md:446-458`

---

### 13. Body `value_type` classification rules are too loose for deterministic validation

**Status:** unresolved
**Severity:** significant — blocks consistent implementation of `PAL-RV-BODY-004`

The schema contract names three body value types, and record validation says they mean "non-list prose", "list-only", or "prose or list". But there is no exact Markdown classification rule.

The compiler still needs to know:
1. Is a section with a short intro paragraph followed by a list valid for `markdown_list` or invalid?
2. Are nested lists allowed?
3. Are blockquotes, code fences, tables, or thematic breaks valid under any `value_type`?
4. Are multiple paragraphs valid for `markdown_string`?
5. Are blank lines significant when deciding prose vs list?

Without a concrete AST-level or token-level rule, `PAL-RV-BODY-004` will vary across implementations.

**Files:** `palsc/references/record-validation.md:100-103`, `palsc/references/content-schema-definition.md:68-72`, `palsc/references/diagnostic-codes.md:68`

---

## Recommended Work Order

1. `### 12.` State-transition validation is referenced but has no declaration model
2. `### 2.` Entity path pattern matching has no formal definition
3. `### 3.` Nested path-parent/ref-parent consistency algorithm is undefined
4. `### 6.` Workspace/module discovery mechanism is missing
5. `### 4.` Schema file authority is ambiguous
6. `### 7.` Body section null detection rule is imprecise
7. `### 13.` Body `value_type` classification rules are too loose for deterministic validation
8. `### 9.` Display-label warning target is undefined
9. `### 5.` CLI interface for `palsc validate` is undesigned
10. `### 11.` Manifest validity and migration-report contracts are incomplete
11. `### 10.` Diagnostic registry does not cover all compiler failure classes
12. `### 8.` Correlation ID is required for orchestrated chains but is not part of the canonical read envelope keys
