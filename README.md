<div align="center">

# ALS — Agent Language Specification

A strict specification language for agent systems.

**Beta Research Preview**

ALS is public for early adopters who are comfortable with breakage, manual rewrites, and rapid iteration. Read the preview contract in [RESEARCH-PREVIEW.md](RESEARCH-PREVIEW.md).

</div>

---

## What ALS Is

ALS gives agent systems a strict, filesystem-backed contract:

- `shape.yaml` defines what valid records look like
- the compiler validates module shapes, records, refs, and body structure
- skill bundles define the intended process surface for working with that data

The goal is simple: fewer ad hoc file conventions, less drift, and a clearer boundary between structure and workflow.

## What Works Today

The current public preview is centered on two usable surfaces:

- `alsc validate` validates an ALS system and emits machine-readable JSON
- `alsc deploy claude` projects active ALS skill bundles into `.claude/skills/`
- `example-systems/` provides reference systems and fixtures for the current ALS v1 contract

## Install

ALS is distributed as a Claude Code plugin. Requires [Bun](https://bun.sh) >= 1.3.0 and [jq](https://jqlang.github.io/jq/).

```bash
# Add the ALS plugin to Claude Code
claude plugin add als
```

Once installed, ALS skills (`/validate`, `/new`, `/change`, `/deploy`) are available inside Claude Code sessions.

## Preview Contract

This is a research preview, not a stability release.

- Authored-source compatibility is not guaranteed across preview releases.
- Upgrading may require manual rewrites.
- Users should pin exact preview versions.
- ALS currently supports `als_version: 1` only.
- ALS does not yet ship a language-version upgrade toolchain.
- ALS does not yet ship a real warning or deprecation lifecycle.
- Claude projection is the only harness projection surfaced in this preview.

The longer-form contract and known gaps live in [RESEARCH-PREVIEW.md](RESEARCH-PREVIEW.md).

## Repository Structure

```text
alsc/
  compiler/       # Validator and Claude skill projector
  skills/         # ALS skill definitions and workflow material
sdr/              # Spec Decision Records
example-systems/  # Reference implementations and fixtures
pre-release/      # Internal risk analysis and current-state notes
```

## Feedback

Use GitHub issues for:

- compiler bugs
- authored-system breakage reports
- research feedback on what ALS should optimize for next

See [CONTRIBUTING.md](CONTRIBUTING.md) for the expected issue detail.

## License

Copyright 2026 Section 9 Technologies LLC. Licensed under [Elastic License 2.0 (ELv2)](LICENSE).
