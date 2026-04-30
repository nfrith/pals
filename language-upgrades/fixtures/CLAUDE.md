# Frozen Fixtures

`fixtures/v<N>/` stores the retained authored snapshot for every shipped `als_version`.

Rules:

- Keep fixtures permanently.
- Include `.als/` plus the mounted authored module roots for that version.
- Exclude `.claude/`.
- Treat fixtures as immutable support and CI artifacts, not as live working copies.

`v1/` is seeded from `reference-system/` and is the baseline fixture for ALS-066.
