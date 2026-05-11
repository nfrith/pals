# Codex Authoring and Plugin Distribution Contract

## Status

Accepted

## Context

- ALS already ships a Claude-facing install surface:
  - [`.claude-plugin/plugin.json`](../.claude-plugin/plugin.json)
  - [`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json)
  - the RC/stable release model documented in [`../../../als-factory/docs/release-model/architect-flow.md`](../../../als-factory/docs/release-model/architect-flow.md)
- ALS already has settled Delamain provider semantics through [`028-agent-providers.md`](028-agent-providers.md). That work owns `provider: "anthropic" | "openai"` and is not reopened here.
- The operator explicitly narrowed ALS-097 to the install surface only:
  - ship Codex plugin metadata and marketplace metadata
  - extend release/public docs so Codex discovery is real
  - do not add `alsc deploy codex`
  - do not promise Codex skill portability, hooks, or runtime-harness parity yet
- Existing Codex research and the rejected PR #6 both surfaced the same architectural risk: collapsing provider semantics, authoring-harness packaging, runtime-harness projection, and public release policy into one "Codex support" blob creates unnecessary blast radius and makes later follow-up work harder to reason about.
- ALS-097 planning records the architecture rationale in [`../../../als-factory/artifacts/ALS-097/codex-install-surface-architecture.md`](../../../als-factory/artifacts/ALS-097/codex-install-surface-architecture.md). The recommended path is a unified multi-harness release plane with explicit install-surface-only boundaries.
- The current architect-side release automation still assumes a single plugin manifest:
  - `.als/modules/als-factory/v3/skills/als-factory-release-rc/SKILL.md` aligns only `nfrith-repos/als/.claude-plugin/plugin.json`
  - `.als/modules/als-factory/v3/skills/als-factory-release-prep/SKILL.md` still names `.claude-plugin/plugin.json` in its non-goals

## Decision

- ALS-097 adds **Codex as an authoring-harness install and distribution surface**, not as a second ALS runtime harness.
- ALS distinguishes three concepts:
  - **agent provider**: the Delamain model/runtime provider chosen by authored agent state (`anthropic | openai`)
  - **authoring harness**: the interface used to discover, install, and invoke ALS as a plugin (Claude Code, Codex)
  - **runtime harness**: the filesystem/runtime surface that `alsc deploy ...` projects for an ALS-authored system
- In this decision:
  - provider semantics remain exactly as defined by SDR 028
  - runtime harness remains Claude-only
  - authoring harness gains Codex install/distribution support
- The ALS release act stays singular. One ALS release version is carried by both:
  - `.claude-plugin/plugin.json`
  - `.codex-plugin/plugin.json`
  Both manifests are bumped together in the same release commit.
- Codex RC distribution lives in the main ALS repo beside the Claude RC surface:
  - `.codex-plugin/plugin.json` at the ALS repo root
  - `.agents/plugins/marketplace.json` at the ALS repo root
- Codex stable distribution must remain Section 9-owned and must stay inside the same two-channel release model as Claude. The recommended stable shape is to reuse `nfrith/als-stable` as one thin catalog family with separate stable marketplace entries for Claude and Codex rather than creating a second stable repo.
- The shared `nfrith/als-stable` repo uses sibling harness-native marketplace manifests, not one mixed file:
  - `.claude-plugin/marketplace.json` for the Claude stable surface
  - `.agents/plugins/marketplace.json` for the Codex stable surface
- Release/public docs must describe the install surface as a **harness × channel** matrix:
  - Claude RC
  - Claude stable
  - Codex RC
  - Codex stable
- Public copy must be explicit about the boundary:
  - install and discovery in Codex are supported in this phase
  - Codex skill portability, hooks, and runtime projection are not yet promised
- Canonical ALS reference docs under `nfrith-repos/als/skills/docs/references/` must reflect the same dual-harness reality. When a Codex-specific fact is not yet empirically locked, the doc must say so explicitly with a placeholder or TBD marker instead of inventing a value.
- This decision does not claim Codex runtime parity. It does not add:
  - `alsc deploy codex`
  - Codex hook packaging
  - Codex skill-portability work
  - `.agents/skills` projection
  - compiler-owned root `AGENTS.md`

## Normative Effect

- Required: ALS publishes `.codex-plugin/plugin.json` as the official Codex plugin manifest.
- Required: ALS publishes `.agents/plugins/marketplace.json` as the official repo-local Codex marketplace for RC/local testing.
- Required: `.claude-plugin/plugin.json.version` and `.codex-plugin/plugin.json.version` are identical in every shipped ALS release.
- Required: architect-side release automation that performs the release act updates both plugin manifests in the same release commit.
- Required: Codex stable distribution points only at Section 9-owned repositories and explicit release refs. Contributor forks are forbidden.
- Required: the shared stable repo shape uses sibling harness-native marketplace manifests (`.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`) rather than a second stable repo or an ambiguous mixed-file contract.
- Required: release-model docs teach the install surface as a harness × channel matrix, not as Claude-only prose with a Codex appendix.
- Required: public docs describe Codex as install-surface support only until follow-up jobs land skill portability, hooks, and runtime projection.
- Required: canonical reference docs under `nfrith-repos/als/skills/docs/references/` stop assuming Claude is the only harness. Unverified Codex-specific facts must be marked as placeholders or TBDs instead of being omitted silently or asserted as observed truth.
- Allowed: `.codex-plugin/plugin.json` may point `skills` at `./skills/` if the public contract remains explicit that functional Codex skill parity is deferred.
- Allowed: placeholder or TBD language in reference docs where Codex-specific runtime facts are not yet empirically verified.
- Allowed: future jobs may add Codex runtime-harness projection, but only under a separate SDR.
- Rejected: independent Claude and Codex plugin versions.
- Rejected: a second public release act for Codex separate from the existing ALS release act.
- Rejected: public copy that implies Codex install means Claude-equivalent skill, hook, or runtime behavior today.
- Rejected: `alsc deploy codex`, Codex hook config, or root `AGENTS.md` ownership as part of this decision.

## Compiler Impact

- No ALS parser, validator, authored-shape, or deploy-target change is introduced by this SDR.
- `alsc deploy claude` remains the only deploy command.
- No compiler-owned runtime root, dispatcher behavior, dashboard behavior, statusline behavior, or update-transaction behavior is widened for Codex in this job.
- Architect-side release automation must be updated so the release act aligns both plugin manifests instead of only `.claude-plugin/plugin.json`.

## Docs and Fixture Impact

- Add `051-codex-authoring-and-plugin-distribution-contract.md` as the canonical decision record for the install-surface-only Codex phase.
- Add [`../../../als-factory/artifacts/ALS-097/codex-install-surface-architecture.md`](../../../als-factory/artifacts/ALS-097/codex-install-surface-architecture.md) as the load-bearing rationale note for the shared release-plane recommendation.
- Update `als-factory/docs/release-model/architect-flow.md`, `edgerunner-flow.md`, and `update-mechanics/version-policy.md` so they describe the harness × channel matrix and the dual-manifest release act.
- Update `nfrith-repos/als/README.md` and `nfrith-repos/als/CLAUDE.md` so Codex installation is documented honestly.
- Update the canonical reference docs under `nfrith-repos/als/skills/docs/references/`, with initial high-risk files including:
  - `platforms.md`
  - `delamain-console-patterns.md`
  - `dev-mapping.md`
  - `module-integration.md`
  - `delamain-overview.md`
  - `vocabulary.md`
  Additional files in that directory should be audited for Claude-only assumptions during dev and updated or marked TBD where needed.
- Update `.als/modules/als-factory/v3/skills/als-factory-release-rc/SKILL.md` and its projected copy so release automation aligns both manifests.
- Update `.als/modules/als-factory/v3/skills/als-factory-release-prep/SKILL.md` and its projected copy only as needed to remove Claude-only wording around plugin-versioning non-goals.
- Add a short pointer from the affected architect-side release skills back to this SDR or the ALS-097 rationale note so later edits cannot silently drop the dual-manifest release contract.
- No authored ALS syntax changes are introduced, so no shape-language fixture round is required for this job.

## Alternatives Considered

- Create a separate Codex-only release plane with its own stable repo and independent plugin versioning.
- Rejected because it duplicates release surfaces, increases drift risk, and adds a human serialization point every time ALS ships a version.

- Treat Codex support as full second-runtime parity now.
- Rejected because it drags runtime-harness questions into an install-surface job: deploy targets, hooks, `.agents/skills`, root `AGENTS.md`, dashboard/statusline/update parity, and broader compiler impact.

- Stop at repo-local or RC-only Codex packaging and defer stable public distribution until skill portability lands.
- Rejected because ALS-097 exists to make the public install surface real now, with an explicit boundary, rather than keeping Codex permanently trapped behind follow-up work.

## Non-Goals

- Codex runtime-harness projection.
- `alsc deploy codex`.
- Codex hook config or hook-event parity.
- Codex skill-portability fixes.
- Root `AGENTS.md` ownership or generation.
- Dispatcher, dashboard, statusline, or update-transaction changes for Codex.

## Follow-Up

- A follow-up job may add Codex skill portability and hooks once ALS owns a portable plugin-root/path-resolution contract.
- A separate future SDR would be required before Codex can become a runtime harness with projected `.codex/...` assets or any compiler-owned `AGENTS.md` behavior.
