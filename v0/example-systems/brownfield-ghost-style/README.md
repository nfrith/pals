# Brownfield Ghost-Style Fixture

This fixture is intentionally non-compliant and designed for migration testing.

## Shape

- `section9/backlog/CLAUDE.md`
- `section9/backlog/arcs/*.md`
- `section9/backlog/items/*.md`

## Intentional Issues

1. Path-like references mixed with plain slugs.
2. Inconsistent frontmatter fields and casing.
3. Section structure drift across files.
4. Missing explicit empty markers in some body sections.

Use this fixture to test `pals-adopt` and `pals-evolve` behavior.
