# Delamain Dispatcher Template Version Contract

## Status

Accepted

## Context

- Delamain dispatchers are copied from the canonical template at `${CLAUDE_PLUGIN_ROOT}/skills/new/references/dispatcher/` into module version bundles.
- `alsc deploy claude` then projects those module-bundle dispatchers into `.claude/delamains/{name}/dispatcher/`.
- Existing module bundles and deployed copies are frozen at copy time, so later template changes such as logging, error handling, or runtime structure do not surface to already-authored Delamains.
- Operators need a non-fatal startup signal when a dispatcher is stale and a visible path toward manual upgrade.
- Operators need missing local or canonical dispatcher version files to fail fast so testing and deployment surfaces broken dispatcher assets immediately.

## Decision

- The canonical dispatcher template exposes its latest template version as a monotonic integer in `skills/new/references/dispatcher/VERSION`.
- Every copied dispatcher bundle carries its own local `dispatcher/VERSION` file copied from the canonical template at bundle creation or dispatcher upgrade time.
- `dispatcher/package.json` `version` is package metadata and is not the dispatcher template version.
- At startup, the dispatcher reads its local version from `dispatcher/VERSION`.
- At startup, the dispatcher reads the latest canonical version from `${CLAUDE_PLUGIN_ROOT}/skills/new/references/dispatcher/VERSION`.
- The stale-version comparison is advisory. It never blocks dispatcher startup or polling when both local and canonical version sources are readable and valid.
- The local dispatcher `VERSION` file, canonical plugin root, and canonical dispatcher `VERSION` file are required runtime inputs.
- If the local dispatcher `VERSION` file is missing, unreadable, or malformed, dispatcher startup fails before polling.
- If `${CLAUDE_PLUGIN_ROOT}` is missing, or the canonical dispatcher `VERSION` file is missing, unreadable, or malformed, dispatcher startup fails before polling.
- The dispatcher logs one version line on startup:
  - current and latest when both are readable
  - an upgrade instruction when the local version is numerically older than the canonical version
- If the local dispatcher version is numerically older than the canonical version, the log line includes `run /upgrade-dispatchers to update`.
- If the local dispatcher version is greater than the canonical version, the dispatcher logs both versions and does not instruct downgrade.
- The first `/upgrade-dispatchers` skill is a placeholder only. Its body says: `Nothing is here. It's a placeholder. Contact Nick Frith.`
- Automated dispatcher upgrade is deferred to a separate decision and implementation pass.

## Normative Effect

- Required: the canonical dispatcher template contains `VERSION` with a positive integer and optional trailing newline.
- Required: dispatcher bundle copies contain a local `VERSION` file at the dispatcher root.
- Required: dispatcher startup logs the local dispatcher version and the latest canonical version when available.
- Required: stale local dispatcher versions produce an actionable `/upgrade-dispatchers` instruction and continue running.
- Required: missing, unreadable, or malformed local dispatcher version information is a hard startup error.
- Required: missing, unreadable, or malformed canonical version information is a hard startup error.
- Required: dispatcher template version comparison is numeric integer comparison.
- Allowed: local dispatcher version greater than the current canonical version, with no downgrade instruction.
- Allowed: older dispatchers that do not yet know this contract to continue running without the version line until upgraded.
- Rejected: SemVer, package version, git commit, or content hash as the first-pass dispatcher template version.
- Rejected: hard startup failure only because the local dispatcher version is stale.
- Rejected: graceful degradation when the local dispatcher `VERSION`, installed ALS plugin root, or canonical dispatcher `VERSION` cannot be read.
- Rejected: storing dispatcher template version in `shape.yaml`, `delamain.yaml`, record frontmatter, or generated runtime manifests.
- Rejected: implementing automated upgrade behavior in the placeholder skill for this pass.

## Compiler Impact

- No shape parser or record parser syntax changes are introduced.
- Dispatcher template tests must cover local/canonical version parsing, startup-log decisions, and fail-fast local and canonical lookup failures.
- Deploy or template-copy tests must prove `dispatcher/VERSION` is part of projected Delamain dispatcher assets.
- Compiler-facing fixtures that snapshot dispatcher bundle contents must be updated to include the `VERSION` file where applicable.
- `alsc deploy claude` should continue to treat dispatcher version files as authored bundle files. It must not run package-manager commands or automate upgrades as part of this decision.

## Docs and Fixture Impact

- Update the canonical shape-language reference and Delamain dispatcher docs to document dispatcher template version files, startup log behavior, fail-fast missing-version behavior, stale-version advisory behavior, and the placeholder upgrade skill.
- Update new-module guidance so copied dispatcher templates include `dispatcher/VERSION`.
- Fixture review should use dispatcher bundle trees rather than `shape.yaml` or record frontmatter because no authored declaration syntax changes.
- First concrete fixture targets are Ghost's backlog v3 `development-pipeline` and `search-pipeline` dispatcher source bundles plus their deployed `.claude/delamains/` copies.
- The canonical dispatcher template under `skills/new/references/dispatcher/` is the source of truth for the latest version.

## Alternatives Considered

- Store the dispatcher version in `shape.yaml` or `delamain.yaml`.
- Rejected because the version describes copied dispatcher runtime assets, not module shape semantics or state-machine semantics.
- Use SemVer.
- Rejected for the first pass because a monotonic integer is simpler to compare and explain in logs.
- Use a git commit or content hash.
- Rejected because it makes the operator-facing log noisy and does not provide a simple ordered upgrade signal.
- Fail dispatcher startup when stale.
- Rejected because stale dispatchers should remain operational while surfacing upgrade guidance.
- Treat a missing local dispatcher version as `unknown`.
- Rejected because operator review requires every copied dispatcher bundle to carry its own `VERSION` file and fail fast when that file is missing.
- Project the latest version into every ALS system.
- Rejected for this pass because operator direction is to read the canonical version from the installed ALS plugin template path.
- Store one system-level dispatcher version because `alsc deploy claude` is the atomic system deployment gate.
- Deferred for this pass because operator direction approved per-bundle `dispatcher/VERSION` first and reserved system-level optimization for later.

## Non-Goals

- Implementing `/upgrade-dispatchers` automation.
- Introducing a general runtime asset version registry.
- Replacing per-bundle dispatcher versions with a system-level dispatcher version.
- Changing module version semantics.
- Adding record-level migration or frontmatter fields for dispatcher versions.
