# Deprecation Warning Contract

## Status

Accepted

## Context

- ALS validation already had a warning-capable output shape, but no authored value ever emitted a warning.
- Future removals need a runway period where a value is still accepted but clearly marked as on its way out.
- Existing compiler-owned enum tuples must stay compatible with current literal-union and `z.enum(...)` consumers.
- The operator workflow already depends on `alsc validate` plus the validation hooks, so deprecation warnings must surface there instead of inventing a second diagnostics channel.

## Decision

- Compiler-owned enum deprecations live as typed sidecar metadata in `alsc/compiler/src/contracts.ts`; the literal tuples remain the canonical spellings.
- ALS does not add new authored syntax for deprecation in this job. Existing shape files continue to declare enum `allowed_values` the same way they do today.
- When authored `allowed_values` exactly match a compiler-owned enum contract and the authored value is marked deprecated, validation succeeds and emits a warning diagnostic.
- Warning diagnostics carry a dedicated `deprecation` payload with:
  - `contract`
  - `value`
  - `since`
  - `removed_in`
  - `replacement`
- Warn-only validation returns `status: "warn"` and exit code `0`. Validation returns `status: "fail"` and exit code `1` when any error diagnostics are present, even if warnings are also present.
- `als-validate.sh` surfaces warn-only results immediately without blocking edits.
- `als-stop-gate.sh` surfaces a final warning reminder without blocking stop when only warnings remain.

## Normative Effect

- Required: deprecated values remain accepted until a later removal job changes the contract.
- Required: deprecated-value diagnostics are machine-readable and do not require consumers to parse prose strings for lifecycle fields.
- Required: warn-only runs stay non-blocking in both the CLI and the hook chain.
- Required: the deprecation warning path uses the existing diagnostics array rather than a parallel warnings-only array.
- Allowed: synthetic proof fixtures that exercise the warning path before the first real deprecation announcement lands.
- Rejected: object-wrapped enum tuples that would break current literal-union or Zod consumers.
- Rejected: hard-failing a value that is still in the deprecated-but-supported window.
- Rejected: prose-only warning hints with no dedicated deprecation payload.

## Compiler Impact

- `alsc/compiler/src/contracts.ts` exports the deprecation sidecar shape and the enum-contract lookup used by validation.
- `alsc/compiler/src/types.ts` and `alsc/compiler/src/diagnostics.ts` grow the structured deprecation payload and warning-specific diagnostic codes.
- `alsc/compiler/src/validate.ts` emits warning diagnostics from the generic enum validation path for both scalar and list enum values.
- The CLI keeps its existing exit-code posture and now returns `status: "warn"` for warn-only runs.
- The validation hooks surface warn-only output without converting warnings into errors.

## Docs and Fixture Impact

- `skills/docs/references/deprecation-and-warnings.md` defines the vocabulary and the warning payload shape.
- `als-factory/docs/release-model/update-mechanics/version-policy.md` links to the reference page and names the warn-only operator posture.
- Targeted tests must cover:
  - a warn-only validation run
  - a fail-plus-warn validation run
  - the structured deprecation payload

## Alternatives Considered

- Rewrite enum tuples into object-valued contracts.
- Rejected because existing literal-union consumers and `z.enum(...)` inputs would break.

- Add a second warnings array alongside diagnostics.
- Rejected because validation already has one diagnostics array, one `status` field, and warning-aware summary counts.
