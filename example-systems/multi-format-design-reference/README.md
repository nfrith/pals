# Multi Format Design Reference

This fixture is a forward-looking design reference for entity-level source formats.

It exists to pressure-test a model where ALS keeps one shared identity and ref layer while letting each entity use its own constrained document language.

## Purpose

- Show `source_format: markdown` and `source_format: jsonl` side by side in one module.
- Keep markdown entities on the current ALS frontmatter-plus-body model.
- Give JSONL entities their own strict row-schema language instead of bridging them back into markdown.
- Demonstrate that a markdown record can reference a JSONL entity through the normal ALS ref contract.

## Important Note

- This fixture is design-reference material first, but it is also a compiler smoke target for the current multi-format entity contract.
- The syntax here depends on the `source_format` contract and JSONL entity language from SDR 017.

## Rejected Shape Example

The following JSONL content is intentionally invalid because the lines do not share one authoritative schema:

```json
{"type":"event","id":"EVT-001","status":"done"}
{"type":"metric","id":"MET-001","value":42.5,"unit":"ms"}
{"name":"random thing","tags":["a","b"]}
```

The first-pass rule is stricter: one JSONL entity file, one row schema.

The repo also checks in this rejected artifact outside the validated module subtree:

- `content/rejected/mixed-schema-stream.jsonl`
