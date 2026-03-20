# Discovery Robustness And Markdown Casing

## Status

Accepted

## Context

- ALS v1 currently requires exact filesystem path matches against declared entity path templates such as `items/{id}.md`.
- SDR 004 introduced a narrow case-insensitive discovery exception for reserved agent files `AGENTS.md` and `CLAUDE.md`.
- Non-reserved files with uppercase or mixed-case `.MD` extensions could disappear from discovery instead of failing validation.
- Unreadable directories inside a module subtree could crash validation instead of producing structured diagnostics.

## Decision

- Reserved agent files remain the only case-insensitive markdown filename exception in ALS v1 discovery.
- Non-reserved markdown files must use lowercase `.md` to participate in normal record discovery.
- A non-reserved file whose name ends with a case-variant of `.md` but not exact lowercase `.md` is invalid and must emit an explicit parse diagnostic.
- Entity path matching remains exact and is not made case-insensitive.
- If discovery cannot read a directory inside a module subtree, the compiler must emit an explicit parse diagnostic on that directory path, skip that subtree, and continue scanning other readable siblings and modules.

## Normative Effect

- Required: reserved `AGENTS.md` and `CLAUDE.md` filename matching stays ASCII case-insensitive.
- Required: non-reserved markdown files with non-canonical extension casing such as `README.MD` are validation errors.
- Required: unreadable directories fail validation cleanly instead of crashing the compiler.
- Required: discovery continues beyond an unreadable subtree when other readable siblings remain.
- Rejected: silently ignoring non-reserved uppercase-extension markdown files.
- Rejected: making normal ALS record path matching case-insensitive.
- Rejected: aborting the entire validation run because one directory cannot be read.

## Compiler Impact

- Discovery needs explicit diagnostics for unreadable directories and non-canonical non-reserved markdown extension casing.
- Those discovery diagnostics occur in `parse` phase and use dedicated diagnostic codes `PAL-RV-PARSE-004` and `PAL-RV-PARSE-005`.
- Non-canonical non-reserved markdown files count toward file-based validation summaries and fail those summaries.
- Unreadable directories do not count toward file-based summaries because they are directory paths, not record file paths.

## Docs and Fixture Impact

- The shape-language reference must say that reserved agent files are the only case-insensitive markdown filename exception.
- The shape-language reference must say that non-reserved markdown files require lowercase `.md`.
- Compiler tests must cover uppercase-extension non-reserved markdown, reserved agent file case variants, unreadable subdirectories, and continued discovery after an unreadable subtree.

## Alternatives Considered

- Treat all `.md` extension casing variants as normal ALS record files.
- Rejected because it weakens exact path-template semantics and makes record validity depend on path-casing normalization.
- Keep silently skipping non-reserved uppercase-extension markdown.
- Rejected because files inside a module subtree must either be validated, ignored by an explicit rule, or rejected with a diagnostic.
- Crash validation when a directory cannot be read.
- Rejected because filesystem access failures should be reported as structured diagnostics, not runtime exceptions.
