# Deprecation and Warnings

Reference for ALS deprecation metadata and the warn-only validation path.

## Purpose

ALS uses deprecation warnings to give edgerunners advance notice before a supported construct is removed.

A deprecated construct:
- still validates today
- emits a warning through `alsc validate`
- carries enough machine-readable metadata for later tooling and docs to point to the replacement path

The compatibility-class policy that governs release classification lives in [Compatibility Classes](./compatibility-classes.md).

## Compiler Contract

The canonical deprecation primitive lives in `alsc/compiler/src/contracts.ts`.

The contract shape is:

```ts
{
  since: string;
  removed_in: string;
  replacement: string | null;
}
```

ALS keeps flat literal tuples as the canonical enum spellings. Deprecation state is a sidecar map keyed by the literal value, not a rewritten object-valued enum.

## Validation Behavior

When a deprecated value is still supported:
- validation emits a warning diagnostic, not an error
- the diagnostic still lives in the normal `diagnostics` array
- the diagnostic includes a dedicated `deprecation` payload
- `status` becomes `warn` when warnings exist and errors do not
- CLI exit code stays `0`

If any real validation error is present, validation returns `status: "fail"` and exit code `1`, and the deprecation warning remains in the output alongside the error diagnostics.

## Diagnostic Payload

Deprecated-value diagnostics carry a `deprecation` object:

```json
{
  "contract": "<compiler_enum_contract>",
  "value": "<deprecated-value>",
  "since": "v1.4",
  "removed_in": "v1.6",
  "replacement": "<replacement-value-or-null>"
}
```

Meaning:
- `contract` identifies which compiler-owned enum contract matched
- `value` is the deprecated literal the authored file used
- `since` is the version where ALS started warning
- `removed_in` is the earliest planned removal version
- `replacement` names the preferred replacement when one exists

Consumers should read this payload directly instead of parsing the human `message`.

## Hook Surfacing

Warn-only validation is non-blocking everywhere:
- `als-validate.sh` emits immediate context after an edit so the warning shows up during normal work
- `als-stop-gate.sh` emits a final reminder summary if the touched system/module still carries warnings at stop time

Neither hook turns warn-only output into a block.

## Lifecycle

ALS uses:
1. `supported`
2. `deprecated`
3. `removed`

Current policy requires a construct to remain deprecated for at least two released ALS versions before removal.

Compatibility-class treatment for deprecation announcements and removals lives in [Compatibility Classes](./compatibility-classes.md).

## Non-Goal

This warning contract does not make `/update` auto-rewrite deprecated values. The `replacement` field is advisory until a later job consumes it.
