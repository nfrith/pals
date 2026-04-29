# Contributing

ALS is currently a beta research preview. Contributions should help the project learn quickly without implying stability guarantees the preview does not actually provide.

## Before You Open An Issue

Read [RESEARCH-PREVIEW.md](RESEARCH-PREVIEW.md) first.

Preview updates are manual `/update`, exact-version-pinned, and fix-forward. Keep that posture in mind when reporting lifecycle or breakage issues.

If your report is about breakage, include:

- the ALS preview version you were using
- the version you moved to
- the command you ran
- the smallest reproducible system, fixture, or file set
- the exact JSON output or diagnostic you received

## Development

The compiler currently lives in `alsc/compiler/`.

Install dependencies:

```bash
cd alsc/compiler
bun install
```

Run tests:

```bash
bun test
```

## Pull Requests

Keep PRs narrow.

- avoid mixing release-mechanics work with language semantics work
- add or update tests when compiler behavior changes
- keep preview docs honest about what ALS does and does not guarantee
- do not market unfinished lifecycle tooling as stable

## Research Feedback

The most useful feedback right now is:

- where the current ALS v1 contract is too strict
- where diagnostics are not actionable enough
- where validation or Claude projection is already useful
- what upgrade or lifecycle pain you hit first
