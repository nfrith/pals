import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DIRTY_INTEGRATION_RETRY_LIMIT,
  DispatcherRuntime,
} from "../../../delamain-dispatcher/src/dispatcher-runtime.ts";
import { RepoMutationLock } from "../../../delamain-dispatcher/src/repo-mutation-lock.ts";
import { scan, scanWithDiagnostics } from "../../../delamain-dispatcher/src/watcher.ts";
import {
  readRuntimeState,
  writeRuntimeState,
  type RuntimeDispatchState,
} from "../../../delamain-dispatcher/src/runtime-state.ts";
import { runCommand, runGit } from "../../../delamain-dispatcher/src/git.ts";
import { readTelemetryEvents } from "../../../delamain-dispatcher/src/telemetry.ts";
import type { DispatchEntry } from "../../../delamain-dispatcher/src/dispatcher.ts";

const ENTRY: DispatchEntry = {
  state: "in-dev",
  agentName: "in-dev",
  provider: "anthropic",
  resumable: false,
  transitions: [{ class: "advance", to: "in-review" }],
};
const PUBLISH_REPLAY_RETRY_LIMIT = 3;

test("worktree isolation rewrites item paths into a per-dispatch workspace", async () => {
  await withWorktreeSandbox("rewrite", async ({ runtime, itemFile, worktreeRoot }) => {
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();
    expect(prepared?.worktreePath.startsWith(worktreeRoot)).toBe(true);
    expect(prepared?.isolatedItemFile).toBe(
      join(prepared!.worktreePath, "als-factory", "jobs", "ALS-001.md"),
    );
    expect(existsSync(prepared!.isolatedItemFile)).toBe(true);

    await runtime.finalizeDispatch({
      prepared: prepared!,
      entry: ENTRY,
      sessionId: null,
      durationMs: 0,
      numTurns: null,
      costUsd: null,
      success: false,
    });
  });
});

test("runtime merges clean dispatch edits back into the integration checkout", async () => {
  await withWorktreeSandbox("merge-clean", async ({ runtime, systemRoot, hostOrigin, itemFile }) => {
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();

    await replaceStatus(prepared!.isolatedItemFile, "in-review");
    const result = await runtime.finalizeDispatch({
      prepared: prepared!,
      entry: ENTRY,
      sessionId: "11111111-1111-4111-8111-111111111111",
      durationMs: 4_210,
      numTurns: 7,
      costUsd: 0.42,
      success: true,
    });

    expect(result.success).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.mergeOutcome).toBe("merged");
    expect(await readFrontmatterStatus(itemFile)).toBe("in-review");
    expect(existsSync(prepared!.worktreePath)).toBe(false);
    expect(await runtime.hasOpenRecord("ALS-001")).toBe(false);
    expect(await runGit(systemRoot, ["log", "-1", "--pretty=%P"])).toBe(prepared!.baseCommit);
    expect(await runGit(hostOrigin, ["rev-parse", "refs/heads/main"])).toBe(
      await runGit(systemRoot, ["rev-parse", "HEAD"]),
    );

    const lastCommitMessage = await runGit(systemRoot, ["log", "-1", "--pretty=%B"]);
    expect(lastCommitMessage).toContain("delamain: ALS-001 in-dev → in-review [factory-jobs]");
    expect(lastCommitMessage).toContain("Dispatch-Id:");
    expect(lastCommitMessage).toContain("Cost-Usd: 0.4200");
  });
});

test("runtime refreshes stale host bases onto an intervening main commit before merge-back", async () => {
  await withWorktreeSandbox("merge-refresh-host", async ({ runtime, systemRoot, hostOrigin, itemFile }) => {
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();

    await replaceStatus(prepared!.isolatedItemFile, "in-review");
    await appendBody(itemFile, "Operator note.");
    await gitCommit(systemRoot, "operator: intervening main edit");
    const operatorHead = await runGit(systemRoot, ["rev-parse", "HEAD"]);

    const result = await runtime.finalizeDispatch({
      prepared: prepared!,
      entry: ENTRY,
      sessionId: "44444444-4444-4444-8444-444444444444",
      durationMs: 3_100,
      numTurns: 4,
      costUsd: 0.16,
      success: true,
    });

    expect(result.success).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.mergeOutcome).toBe("merged");
    expect(result.integratedCommit).not.toBeNull();
    expect(await readFrontmatterStatus(itemFile)).toBe("in-review");
    expect(await readFile(itemFile, "utf-8")).toContain("Operator note.");
    const hostParents = (await runGit(systemRoot, ["log", "-1", "--pretty=%P"]))
      .split(" ")
      .filter(Boolean);
    expect(hostParents).toHaveLength(2);
    expect(hostParents).toContain(operatorHead);
    const hostCommitMessage = await runGit(systemRoot, ["log", "-1", "--pretty=%B"]);
    expect(hostCommitMessage).toContain("delamain: ALS-001 in-dev → in-review [factory-jobs]");
    expect(hostCommitMessage).toContain("Dispatch-Id:");
    expect(await runGit(hostOrigin, ["rev-parse", "refs/heads/main"])).toBe(
      await runGit(systemRoot, ["rev-parse", "HEAD"]),
    );
    expect(existsSync(prepared!.worktreePath)).toBe(false);
  });
});

test("runtime absorbs orthogonal host head movement and publishes the merged host commit", async () => {
  await withWorktreeSandbox("orthogonal-host-move", async ({
    root,
    runtime,
    systemRoot,
    hostOrigin,
    itemFile,
  }) => {
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();

    await replaceStatus(prepared!.isolatedItemFile, "in-review");
    await writeFile(join(systemRoot, "operator-note.txt"), "orthogonal host move\n", "utf-8");
    await gitCommit(systemRoot, "operator: orthogonal host move");

    const result = await runtime.finalizeDispatch({
      prepared: prepared!,
      entry: ENTRY,
      sessionId: "12121212-1212-4212-8212-121212121212",
      durationMs: 2_450,
      numTurns: 4,
      costUsd: 0.14,
      success: true,
    });

    expect(result.success).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.mergeOutcome).toBe("merged");
    expect(await readFrontmatterStatus(itemFile)).toBe("in-review");
    expect(await runGit(hostOrigin, ["rev-parse", "refs/heads/main"])).toBe(
      await runGit(systemRoot, ["rev-parse", "HEAD"]),
    );

    const freshCloneRoot = join(root, "fresh-host-clone");
    await runGit(root, ["clone", hostOrigin, freshCloneRoot]);
    expect(await readFrontmatterStatus(join(freshCloneRoot, "als-factory", "jobs", "ALS-001.md"))).toBe(
      "in-review",
    );
    expect(await readFile(join(freshCloneRoot, "operator-note.txt"), "utf-8")).toBe(
      "orthogonal host move\n",
    );
  });
});

test("runtime auto-rebases host publication when origin moves on orthogonal paths", async () => {
  await withWorktreeSandbox("host-publish-orthogonal", async ({
    root,
    runtime,
    systemRoot,
    hostOrigin,
    itemFile,
  }) => {
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();

    await replaceStatus(prepared!.isolatedItemFile, "in-review");
    await mutateRemoteViaClone(root, hostOrigin, "host-publish-orthogonal-remote", async (cloneRoot) => {
      await writeFile(join(cloneRoot, "operator-note.txt"), "publish-time remote note\n", "utf-8");
      await gitCommit(cloneRoot, "operator: host publish-time remote note");
    });

    const result = await runtime.finalizeDispatch({
      prepared: prepared!,
      entry: ENTRY,
      sessionId: "56565656-5656-4565-8565-565656565656",
      durationMs: 2_250,
      numTurns: 4,
      costUsd: 0.13,
      success: true,
    });

    expect(result.success).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.mergeOutcome).toBe("merged");
    expect(await readFrontmatterStatus(itemFile)).toBe("in-review");
    expect(await readFile(join(systemRoot, "operator-note.txt"), "utf-8")).toBe(
      "publish-time remote note\n",
    );
    expect(await runGit(hostOrigin, ["rev-parse", "refs/heads/main"])).toBe(
      await runGit(systemRoot, ["rev-parse", "HEAD"]),
    );
    expect(existsSync(prepared!.worktreePath)).toBe(false);
  });
});

test("runtime blocks host publication replay when origin moves on overlapping paths", async () => {
  await withWorktreeSandbox("host-publish-conflict", async ({
    root,
    runtime,
    bundleRoot,
    systemRoot,
    hostOrigin,
    itemFile,
  }) => {
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();

    const hostHeadBefore = await runGit(systemRoot, ["rev-parse", "HEAD"]);
    await replaceStatus(prepared!.isolatedItemFile, "in-review");
    await mutateRemoteViaClone(root, hostOrigin, "host-publish-conflict-remote", async (cloneRoot) => {
      await appendBody(join(cloneRoot, "als-factory", "jobs", "ALS-001.md"), "Remote conflicting note.");
      await gitCommit(cloneRoot, "operator: host publish-time conflicting note");
    });

    const result = await runtime.finalizeDispatch({
      prepared: prepared!,
      entry: ENTRY,
      sessionId: "57575757-5757-4575-8575-575757575757",
      durationMs: 2_400,
      numTurns: 4,
      costUsd: 0.14,
      success: true,
    });

    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.mergeOutcome).toBe("blocked");
    expect(result.incidentKind).toBe("merge_back_publish_failed");
    expect(result.incidentMessage).toContain("als-factory/jobs/ALS-001.md");
    expect(await runGit(systemRoot, ["rev-parse", "HEAD"])).toBe(hostHeadBefore);
    expect(await readFrontmatterStatus(itemFile)).toBe("in-dev");
    expect(existsSync(prepared!.worktreePath)).toBe(true);

    const state = await readRuntimeState(bundleRoot);
    expect(state.records[0]?.status).toBe("blocked");
    expect(state.records[0]?.incident?.kind).toBe("merge_back_publish_failed");
    expect(state.records[0]?.incident?.retry_count).toBe(1);
    expect(state.records[0]?.incident?.incident_context?.phase).toBe("publish");
    expect(state.records[0]?.incident?.incident_context?.cause).toBe("merge_back_publish_failed");

    const telemetry = await readTelemetryEvents(bundleRoot, 50);
    expect(telemetry.events.some((event) => event.event_type === "merge_attempt_start")).toBe(true);
    expect(telemetry.events.some((event) => event.event_type === "publish_attempt")).toBe(true);
    expect(telemetry.events.some((event) => event.event_type === "publish_replay")).toBe(true);
    expect(telemetry.events.some((event) => event.event_type === "rollback")).toBe(true);
  });
});

test("runtime caps host publication replay attempts when origin keeps moving", async () => {
  await withWorktreeSandbox("host-publish-retry-limit", async ({
    root,
    runtime,
    bundleRoot,
    systemRoot,
    hostOrigin,
    itemFile,
  }) => {
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();

    const hostHeadBefore = await runGit(systemRoot, ["rev-parse", "HEAD"]);
    await replaceStatus(prepared!.isolatedItemFile, "in-review");
    await installPrePushRemoteAdvanceHook({
      repoRoot: systemRoot,
      root,
      remoteRoot: hostOrigin,
      label: "host-publish-retry-limit",
      attempts: PUBLISH_REPLAY_RETRY_LIMIT,
    });

    const result = await runtime.finalizeDispatch({
      prepared: prepared!,
      entry: ENTRY,
      sessionId: "60606060-6060-4606-8606-606060606060",
      durationMs: 2_700,
      numTurns: 4,
      costUsd: 0.15,
      success: true,
    });

    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.mergeOutcome).toBe("blocked");
    expect(result.incidentKind).toBe("merge_back_publish_failed");
    expect(result.incidentMessage).toContain(`after ${PUBLISH_REPLAY_RETRY_LIMIT} replay attempts`);
    expect(await runGit(systemRoot, ["rev-parse", "HEAD"])).toBe(hostHeadBefore);
    expect(await readFrontmatterStatus(itemFile)).toBe("in-dev");
    expect(existsSync(prepared!.worktreePath)).toBe(true);

    const state = await readRuntimeState(bundleRoot);
    expect(state.records[0]?.status).toBe("blocked");
    expect(state.records[0]?.incident?.kind).toBe("merge_back_publish_failed");
    expect(state.records[0]?.incident?.retry_count).toBe(PUBLISH_REPLAY_RETRY_LIMIT);
  });
});

test("runtime mounts declared submodule worktrees and merges dual-repo dispatch edits", async () => {
  await withSubmoduleWorktreeSandbox("submodule-merge", async ({
    runtime,
    systemRoot,
    hostOrigin,
    itemFile,
    primarySubmoduleRoot,
    submoduleOrigin,
  }) => {
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();
    expect(prepared?.mountedSubmodules).toHaveLength(1);

    const mounted = prepared!.mountedSubmodules[0]!;
    expect(existsSync(mounted.worktreePath)).toBe(true);
    expect(
      await runGit(mounted.worktreePath, ["rev-parse", "--git-common-dir"]),
    ).toContain(".git/modules/nfrith-repos/als");

    await replaceStatus(prepared!.isolatedItemFile, "in-review");
    await appendBody(join(mounted.worktreePath, "CHANGELOG.md"), "Mounted submodule note.");

    const result = await runtime.finalizeDispatch({
      prepared: prepared!,
      entry: ENTRY,
      sessionId: "33333333-3333-4333-8333-333333333333",
      durationMs: 2_800,
      numTurns: 5,
      costUsd: 0.28,
      success: true,
    });

    expect(result.success).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.mergeOutcome).toBe("merged");
    expect(await readFrontmatterStatus(itemFile)).toBe("in-review");
    expect(await readFile(join(primarySubmoduleRoot, "CHANGELOG.md"), "utf-8")).toContain(
      "Mounted submodule note.",
    );
    expect(await runGit(systemRoot, ["rev-parse", "HEAD:nfrith-repos/als"])).toBe(
      await runGit(primarySubmoduleRoot, ["rev-parse", "HEAD"]),
    );
    expect(await runGit(submoduleOrigin, ["rev-parse", "refs/heads/main"])).toBe(
      await runGit(primarySubmoduleRoot, ["rev-parse", "HEAD"]),
    );
    expect(await runGit(hostOrigin, ["rev-parse", "refs/heads/main"])).toBe(
      await runGit(systemRoot, ["rev-parse", "HEAD"]),
    );
    expect(result.mountedSubmodules[0]?.branch_name).toBe(mounted.branchName);

    const hostCommitMessage = await runGit(systemRoot, ["log", "-1", "--pretty=%B"]);
    const submoduleCommitMessage = await runGit(primarySubmoduleRoot, ["log", "-1", "--pretty=%B"]);
    const hostDispatchId = hostCommitMessage.match(/^Dispatch-Id:\s+(.*)$/m)?.[1];
    const submoduleDispatchId = submoduleCommitMessage.match(/^Dispatch-Id:\s+(.*)$/m)?.[1];

    expect(hostDispatchId).toBeDefined();
    expect(submoduleDispatchId).toBe(hostDispatchId);
    expect(existsSync(prepared!.worktreePath)).toBe(false);
  });
});

test("runtime auto-rebases submodule publication before sealing the host gitlink", async () => {
  await withSubmoduleWorktreeSandbox("submodule-publish-orthogonal", async ({
    root,
    runtime,
    systemRoot,
    hostOrigin,
    itemFile,
    primarySubmoduleRoot,
    submoduleOrigin,
  }) => {
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();

    const mounted = prepared!.mountedSubmodules[0]!;
    await replaceStatus(prepared!.isolatedItemFile, "in-review");
    await appendBody(join(mounted.worktreePath, "CHANGELOG.md"), "Mounted publish recovery note.");
    await mutateRemoteViaClone(root, submoduleOrigin, "submodule-publish-orthogonal-remote", async (cloneRoot) => {
      await writeFile(join(cloneRoot, "REMOTE-NOTE.md"), "submodule publish-time remote note\n", "utf-8");
      await gitCommit(cloneRoot, "operator: submodule publish-time remote note");
    });

    const result = await runtime.finalizeDispatch({
      prepared: prepared!,
      entry: ENTRY,
      sessionId: "58585858-5858-4585-8585-585858585858",
      durationMs: 2_950,
      numTurns: 5,
      costUsd: 0.19,
      success: true,
    });

    expect(result.success).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.mergeOutcome).toBe("merged");
    expect(await readFrontmatterStatus(itemFile)).toBe("in-review");
    expect(await readFile(join(primarySubmoduleRoot, "CHANGELOG.md"), "utf-8")).toContain(
      "Mounted publish recovery note.",
    );
    expect(await readFile(join(primarySubmoduleRoot, "REMOTE-NOTE.md"), "utf-8")).toBe(
      "submodule publish-time remote note\n",
    );
    expect(await runGit(systemRoot, ["rev-parse", "HEAD:nfrith-repos/als"])).toBe(
      await runGit(primarySubmoduleRoot, ["rev-parse", "HEAD"]),
    );
    expect(await runGit(submoduleOrigin, ["rev-parse", "refs/heads/main"])).toBe(
      await runGit(primarySubmoduleRoot, ["rev-parse", "HEAD"]),
    );
    expect(await runGit(hostOrigin, ["rev-parse", "refs/heads/main"])).toBe(
      await runGit(systemRoot, ["rev-parse", "HEAD"]),
    );
  });
});

test("runtime blocks submodule publication replay when the remote touches overlapping paths", async () => {
  await withSubmoduleWorktreeSandbox("submodule-publish-conflict", async ({
    root,
    runtime,
    bundleRoot,
    systemRoot,
    itemFile,
    primarySubmoduleRoot,
    submoduleOrigin,
  }) => {
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();

    const mounted = prepared!.mountedSubmodules[0]!;
    const hostHeadBefore = await runGit(systemRoot, ["rev-parse", "HEAD"]);
    const submoduleHeadBefore = await runGit(primarySubmoduleRoot, ["rev-parse", "HEAD"]);
    await replaceStatus(prepared!.isolatedItemFile, "in-review");
    await appendBody(join(mounted.worktreePath, "CHANGELOG.md"), "Mounted conflicting publish note.");
    await mutateRemoteViaClone(root, submoduleOrigin, "submodule-publish-conflict-remote", async (cloneRoot) => {
      await appendBody(join(cloneRoot, "CHANGELOG.md"), "Remote conflicting publish note.");
      await gitCommit(cloneRoot, "operator: submodule publish-time conflicting note");
    });

    const result = await runtime.finalizeDispatch({
      prepared: prepared!,
      entry: ENTRY,
      sessionId: "59595959-5959-4595-8595-595959595959",
      durationMs: 3_050,
      numTurns: 5,
      costUsd: 0.2,
      success: true,
    });

    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.mergeOutcome).toBe("blocked");
    expect(result.incidentKind).toBe("merge_back_publish_failed");
    expect(result.incidentMessage).toContain("CHANGELOG.md");
    expect(await runGit(systemRoot, ["rev-parse", "HEAD"])).toBe(hostHeadBefore);
    expect(await runGit(primarySubmoduleRoot, ["rev-parse", "HEAD"])).toBe(submoduleHeadBefore);
    expect(await readFrontmatterStatus(itemFile)).toBe("in-dev");
    expect(existsSync(prepared!.worktreePath)).toBe(true);

    const state = await readRuntimeState(bundleRoot);
    expect(state.records[0]?.status).toBe("blocked");
    expect(state.records[0]?.incident?.kind).toBe("merge_back_publish_failed");
    expect(state.records[0]?.incident?.retry_count).toBe(1);
    expect(state.records[0]?.mounted_submodules[0]?.integrated_commit).toBeNull();
  });
});

test("fresh clone can initialize a merged submodule dispatch from origin", async () => {
  await withSubmoduleWorktreeSandbox("submodule-fresh-clone", async ({
    root,
    runtime,
    hostOrigin,
    itemFile,
    submoduleOrigin,
  }) => {
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();

    const mounted = prepared!.mountedSubmodules[0]!;
    await replaceStatus(prepared!.isolatedItemFile, "in-review");
    await appendBody(join(mounted.worktreePath, "CHANGELOG.md"), "Fresh clone submodule note.");

    const result = await runtime.finalizeDispatch({
      prepared: prepared!,
      entry: ENTRY,
      sessionId: "55555555-5555-4555-8555-555555555555",
      durationMs: 3_200,
      numTurns: 5,
      costUsd: 0.19,
      success: true,
    });

    expect(result.success).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.mergeOutcome).toBe("merged");

    const freshCloneRoot = join(root, "fresh-checkout");
    await runGit(root, ["clone", hostOrigin, freshCloneRoot]);
    await runGit(freshCloneRoot, ["-c", "protocol.file.allow=always", "submodule", "update", "--init"]);

    const freshSubmoduleRoot = join(freshCloneRoot, "nfrith-repos", "als");
    expect(await readFile(join(freshSubmoduleRoot, "CHANGELOG.md"), "utf-8")).toContain(
      "Fresh clone submodule note.",
    );
    expect(await runGit(freshCloneRoot, ["rev-parse", "HEAD:nfrith-repos/als"])).toBe(
      await runGit(freshSubmoduleRoot, ["rev-parse", "HEAD"]),
    );
    expect(await runGit(hostOrigin, ["rev-parse", "refs/heads/main"])).toBe(
      await runGit(freshCloneRoot, ["rev-parse", "HEAD"]),
    );
    expect(await runGit(submoduleOrigin, ["rev-parse", "refs/heads/main"])).toBe(
      await runGit(freshSubmoduleRoot, ["rev-parse", "HEAD"]),
    );
  });
});

test("parallel descendant submodule advances preserve ancestry and publish the final gitlink", async () => {
  await withSubmoduleWorktreeSandbox("submodule-descendant-pair", async ({
    root,
    runtime,
    systemRoot,
    hostOrigin,
    itemFile,
    primarySubmoduleRoot,
    submoduleOrigin,
  }) => {
    const secondItemFile = join(systemRoot, "als-factory", "jobs", "ALS-002.md");
    await writeJobFixture(secondItemFile, "ALS-002");
    await gitCommit(systemRoot, "fixture: add ALS-002");
    await runGit(systemRoot, ["push", "origin", "main"]);

    const firstDispatch = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    const secondDispatch = await runtime.prepareDispatch("ALS-002", secondItemFile, ENTRY);
    expect(firstDispatch).not.toBeNull();
    expect(secondDispatch).not.toBeNull();

    await replaceStatus(firstDispatch!.isolatedItemFile, "in-review");
    await replaceStatus(secondDispatch!.isolatedItemFile, "in-review");
    await appendBody(
      join(firstDispatch!.mountedSubmodules[0]!.worktreePath, "CHANGELOG.md"),
      "First descendant dispatch note.",
    );
    await writeFile(
      join(secondDispatch!.mountedSubmodules[0]!.worktreePath, "dispatch-b.txt"),
      "Second descendant dispatch note.\n",
      "utf-8",
    );

    const firstResult = await runtime.finalizeDispatch({
      prepared: firstDispatch!,
      entry: ENTRY,
      sessionId: "23232323-2323-4232-8232-232323232323",
      durationMs: 2_900,
      numTurns: 5,
      costUsd: 0.21,
      success: true,
    });
    expect(firstResult.success).toBe(true);
    expect(firstResult.blocked).toBe(false);
    const firstIntegratedHead = await runGit(primarySubmoduleRoot, ["rev-parse", "HEAD"]);

    const secondResult = await runtime.finalizeDispatch({
      prepared: secondDispatch!,
      entry: ENTRY,
      sessionId: "34343434-3434-4343-8343-343434343434",
      durationMs: 3_100,
      numTurns: 6,
      costUsd: 0.24,
      success: true,
    });

    expect(secondResult.success).toBe(true);
    expect(secondResult.blocked).toBe(false);
    expect(secondResult.mergeOutcome).toBe("merged");

    const secondIntegratedHead = await runGit(primarySubmoduleRoot, ["rev-parse", "HEAD"]);
    const ancestry = await runCommand(
      ["git", "merge-base", "--is-ancestor", firstIntegratedHead, secondIntegratedHead],
      { cwd: primarySubmoduleRoot },
    );
    expect(ancestry.exitCode).toBe(0);
    expect(await runGit(systemRoot, ["rev-parse", "HEAD:nfrith-repos/als"])).toBe(secondIntegratedHead);
    expect(await runGit(submoduleOrigin, ["rev-parse", "refs/heads/main"])).toBe(secondIntegratedHead);
    expect(await runGit(hostOrigin, ["rev-parse", "refs/heads/main:nfrith-repos/als"])).toBe(
      secondIntegratedHead,
    );

    const freshCloneRoot = join(root, "fresh-descendant-clone");
    await runGit(root, ["clone", hostOrigin, freshCloneRoot]);
    await runGit(freshCloneRoot, ["-c", "protocol.file.allow=always", "submodule", "update", "--init"]);
    expect(await readFile(join(freshCloneRoot, "nfrith-repos", "als", "CHANGELOG.md"), "utf-8")).toContain(
      "First descendant dispatch note.",
    );
    expect(await readFile(join(freshCloneRoot, "nfrith-repos", "als", "dispatch-b.txt"), "utf-8")).toBe(
      "Second descendant dispatch note.\n",
    );
  });
});

test("runtime blocks true conflicting concurrent submodule advances with a cause-specific incident", async () => {
  await withSubmoduleWorktreeSandbox("submodule-conflict-pair", async ({
    runtime,
    bundleRoot,
    systemRoot,
    itemFile,
    primarySubmoduleRoot,
  }) => {
    const secondItemFile = join(systemRoot, "als-factory", "jobs", "ALS-002.md");
    await writeJobFixture(secondItemFile, "ALS-002");
    await gitCommit(systemRoot, "fixture: add ALS-002");
    await runGit(systemRoot, ["push", "origin", "main"]);

    const firstDispatch = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    const secondDispatch = await runtime.prepareDispatch("ALS-002", secondItemFile, ENTRY);
    expect(firstDispatch).not.toBeNull();
    expect(secondDispatch).not.toBeNull();

    await replaceStatus(firstDispatch!.isolatedItemFile, "in-review");
    await replaceStatus(secondDispatch!.isolatedItemFile, "in-review");
    await writeFile(
      join(firstDispatch!.mountedSubmodules[0]!.worktreePath, "conflict.txt"),
      "dispatch-a\n",
      "utf-8",
    );
    await writeFile(
      join(secondDispatch!.mountedSubmodules[0]!.worktreePath, "conflict.txt"),
      "dispatch-b\n",
      "utf-8",
    );

    const firstResult = await runtime.finalizeDispatch({
      prepared: firstDispatch!,
      entry: ENTRY,
      sessionId: "45454545-4545-4454-8454-454545454545",
      durationMs: 2_700,
      numTurns: 5,
      costUsd: 0.2,
      success: true,
    });
    expect(firstResult.success).toBe(true);
    expect(firstResult.blocked).toBe(false);
    const firstIntegratedHead = await runGit(primarySubmoduleRoot, ["rev-parse", "HEAD"]);

    const secondResult = await runtime.finalizeDispatch({
      prepared: secondDispatch!,
      entry: ENTRY,
      sessionId: "56565656-5656-4565-8565-565656565656",
      durationMs: 2_850,
      numTurns: 5,
      costUsd: 0.22,
      success: true,
    });

    expect(secondResult.success).toBe(false);
    expect(secondResult.blocked).toBe(true);
    expect(secondResult.incidentKind).toBe("submodule_concurrent_advance");
    expect(await runGit(systemRoot, ["rev-parse", "HEAD:nfrith-repos/als"])).toBe(firstIntegratedHead);
    expect(await readFrontmatterStatus(secondItemFile)).toBe("in-dev");
    expect(existsSync(secondDispatch!.worktreePath)).toBe(true);
    expect(existsSync(secondDispatch!.mountedSubmodules[0]!.worktreePath)).toBe(true);

    const state = await readRuntimeState(bundleRoot);
    const blocked = state.records.find((record) => record.item_id === "ALS-002");
    expect(blocked?.incident?.kind).toBe("submodule_concurrent_advance");
  });
});

test("runtime refreshes mounted submodule base onto an intervening submodule-primary commit", async () => {
  await withSubmoduleWorktreeSandbox("submodule-refresh-drift", async ({
    runtime,
    systemRoot,
    itemFile,
    primarySubmoduleRoot,
  }) => {
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();
    expect(prepared?.mountedSubmodules).toHaveLength(1);
    const mounted = prepared!.mountedSubmodules[0]!;
    const originalSubmoduleBase = mounted.baseCommit;

    await replaceStatus(prepared!.isolatedItemFile, "in-review");
    await appendBody(join(mounted.worktreePath, "CHANGELOG.md"), "Mounted submodule note.");

    await writeFile(join(primarySubmoduleRoot, ".gitignore"), "scratch\n", "utf-8");
    await gitCommit(primarySubmoduleRoot, "operator: disjoint submodule primary edit");
    const operatorSubmoduleHead = await runGit(primarySubmoduleRoot, ["rev-parse", "HEAD"]);
    expect(operatorSubmoduleHead).not.toBe(originalSubmoduleBase);

    const result = await runtime.finalizeDispatch({
      prepared: prepared!,
      entry: ENTRY,
      sessionId: "77777777-7777-4777-8777-777777777777",
      durationMs: 3_400,
      numTurns: 6,
      costUsd: 0.22,
      success: true,
    });

    expect(result.success).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.mergeOutcome).toBe("merged");
    expect(await readFrontmatterStatus(itemFile)).toBe("in-review");
    const submoduleParents = (await runGit(primarySubmoduleRoot, ["log", "-1", "--pretty=%P"]))
      .split(" ")
      .filter(Boolean);
    expect(submoduleParents).toHaveLength(2);
    expect(submoduleParents).toContain(operatorSubmoduleHead);
    expect(await runGit(systemRoot, ["rev-parse", "HEAD:nfrith-repos/als"])).toBe(
      await runGit(primarySubmoduleRoot, ["rev-parse", "HEAD"]),
    );
    expect(existsSync(prepared!.worktreePath)).toBe(false);
  });
});

test("runtime mechanically reconciles divergent host submodule pointer refresh", async () => {
  await withSubmoduleWorktreeSandbox("submodule-pointer-reconcile", async ({
    runtime,
    systemRoot,
    itemFile,
    primarySubmoduleRoot,
  }) => {
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();
    expect(prepared?.mountedSubmodules).toHaveLength(1);

    const mounted = prepared!.mountedSubmodules[0]!;
    await replaceStatus(prepared!.isolatedItemFile, "in-review");
    await writeFile(join(mounted.worktreePath, "agent.txt"), "agent change\n", "utf-8");
    await gitCommit(mounted.worktreePath, "agent: mounted submodule edit");

    await writeFile(join(primarySubmoduleRoot, "operator.txt"), "operator change\n", "utf-8");
    await gitCommit(primarySubmoduleRoot, "operator: primary submodule edit");
    const operatorSubmoduleHead = await runGit(primarySubmoduleRoot, ["rev-parse", "HEAD"]);

    await gitCommit(systemRoot, "operator: update host submodule pointer");
    const operatorHostHead = await runGit(systemRoot, ["rev-parse", "HEAD"]);

    const result = await runtime.finalizeDispatch({
      prepared: prepared!,
      entry: ENTRY,
      sessionId: "88888888-8888-4888-8888-888888888888",
      durationMs: 3_600,
      numTurns: 6,
      costUsd: 0.23,
      success: true,
    });

    expect(result.success).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.mergeOutcome).toBe("merged");
    expect(await readFrontmatterStatus(itemFile)).toBe("in-review");
    expect(await readFile(join(primarySubmoduleRoot, "agent.txt"), "utf-8")).toBe("agent change\n");
    expect(await readFile(join(primarySubmoduleRoot, "operator.txt"), "utf-8")).toBe(
      "operator change\n",
    );

    const submoduleParents = (await runGit(primarySubmoduleRoot, ["log", "-1", "--pretty=%P"]))
      .split(" ")
      .filter(Boolean);
    expect(submoduleParents).toHaveLength(2);
    expect(submoduleParents).toContain(operatorSubmoduleHead);

    const hostParents = (await runGit(systemRoot, ["log", "-1", "--pretty=%P"]))
      .split(" ")
      .filter(Boolean);
    expect(hostParents).toHaveLength(2);
    expect(hostParents).toContain(operatorHostHead);

    expect(await runGit(systemRoot, ["rev-parse", "HEAD:nfrith-repos/als"])).toBe(
      await runGit(primarySubmoduleRoot, ["rev-parse", "HEAD"]),
    );

    const hostCommitMessage = await runGit(systemRoot, ["log", "-1", "--pretty=%B"]);
    expect(hostCommitMessage).toContain("delamain: ALS-001 in-dev → in-review [factory-jobs]");
    expect(hostCommitMessage).toContain("Dispatch-Id:");
    expect(existsSync(prepared!.worktreePath)).toBe(false);
  });
});

test("runtime blocks submodule dispatch merge-back when canonical publication fails", async () => {
  await withSubmoduleWorktreeSandbox("submodule-push-failure", async ({
    root,
    runtime,
    bundleRoot,
    systemRoot,
    itemFile,
    primarySubmoduleRoot,
  }) => {
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();

    const mounted = prepared!.mountedSubmodules[0]!;
    const hostHeadBefore = await runGit(systemRoot, ["rev-parse", "HEAD"]);
    const submoduleHeadBefore = await runGit(primarySubmoduleRoot, ["rev-parse", "HEAD"]);

    await replaceStatus(prepared!.isolatedItemFile, "in-review");
    await appendBody(join(mounted.worktreePath, "CHANGELOG.md"), "Mounted submodule note.");
    await runGit(primarySubmoduleRoot, [
      "remote",
      "set-url",
      "origin",
      join(root, "missing-submodule-origin"),
    ]);

    const result = await runtime.finalizeDispatch({
      prepared: prepared!,
      entry: ENTRY,
      sessionId: "66666666-6666-4666-8666-666666666666",
      durationMs: 1_900,
      numTurns: 3,
      costUsd: 0.11,
      success: true,
    });

    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.mergeOutcome).toBe("blocked");
    expect(result.incidentKind).toBe("merge_back_publish_failed");
    expect(result.incidentMessage).toContain("repo 'nfrith-repos/als' publish origin/main");
    expect(await runGit(systemRoot, ["rev-parse", "HEAD"])).toBe(hostHeadBefore);
    expect(await runGit(primarySubmoduleRoot, ["rev-parse", "HEAD"])).toBe(submoduleHeadBefore);
    expect(await readFrontmatterStatus(itemFile)).toBe("in-dev");
    expect(existsSync(prepared!.worktreePath)).toBe(true);
    expect(existsSync(mounted.worktreePath)).toBe(true);

    const state = await readRuntimeState(bundleRoot);
    expect(state.records[0]?.status).toBe("blocked");
    expect(state.records[0]?.incident?.kind).toBe("merge_back_publish_failed");
    expect(state.records[0]?.mounted_submodules[0]?.branch_name).toBe(mounted.branchName);
    expect(state.records[0]?.mounted_submodules[0]?.integrated_commit).toBeNull();
  });
});

test("runtime blocks submodule dispatch merge-back when the primary clone is dirty", async () => {
  await withSubmoduleWorktreeSandbox("submodule-dirty-primary", async ({
    runtime,
    bundleRoot,
    itemFile,
    primarySubmoduleRoot,
  }) => {
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();

    await replaceStatus(prepared!.isolatedItemFile, "in-review");
    await appendBody(
      join(prepared!.mountedSubmodules[0]!.worktreePath, "CHANGELOG.md"),
      "Mounted submodule conflict note.",
    );
    await appendBody(join(primarySubmoduleRoot, "CHANGELOG.md"), "Dirty primary clone marker.");

    const result = await runtime.finalizeDispatch({
      prepared: prepared!,
      entry: ENTRY,
      sessionId: null,
      durationMs: 1_200,
      numTurns: 2,
      costUsd: 0.05,
      success: true,
    });

    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.incidentKind).toBe("dirty_integration_checkout");
    expect(existsSync(prepared!.worktreePath)).toBe(true);
    expect(existsSync(prepared!.mountedSubmodules[0]!.worktreePath)).toBe(true);

    const state = await readRuntimeState(bundleRoot);
    expect(state.records[0]?.status).toBe("blocked");
    expect(state.records[0]?.incident?.retry_count).toBe(0);
    expect(state.records[0]?.mounted_submodules).toHaveLength(1);
    expect(state.records[0]?.mounted_submodules[0]?.worktree_path).toBe(
      prepared!.mountedSubmodules[0]!.worktreePath,
    );
  });
});

test("runtime retries blocked dirty integration dispatches once the primary tree is clean", async () => {
  await withWorktreeSandbox("dirty-retry-success", async ({
    runtime,
    bundleRoot,
    systemRoot,
    itemFile,
  }) => {
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();

    await replaceStatus(prepared!.isolatedItemFile, "in-review");
    await appendBody(itemFile, "Dirty integration marker.");

    const blocked = await runtime.finalizeDispatch({
      prepared: prepared!,
      entry: ENTRY,
      sessionId: "99999999-9999-4999-8999-999999999999",
      durationMs: 1_700,
      numTurns: 3,
      costUsd: 0.09,
      success: true,
    });

    expect(blocked.success).toBe(false);
    expect(blocked.blocked).toBe(true);
    expect(blocked.incidentKind).toBe("dirty_integration_checkout");

    await gitCommit(systemRoot, "operator: clean dirty integration tree");

    const retries = await runtime.retryBlockedDirtyDispatches();
    expect(retries).toHaveLength(1);
    expect(retries[0]?.action).toBe("merged");
    expect(retries[0]?.treeState).toBe("clean");
    expect(retries[0]?.incidentKind).toBeNull();
    expect(await readFrontmatterStatus(itemFile)).toBe("in-review");
    expect(await readFile(itemFile, "utf-8")).toContain("Dirty integration marker.");
    expect(await runtime.hasOpenRecord("ALS-001")).toBe(false);
    expect(existsSync(prepared!.worktreePath)).toBe(false);

    const state = await readRuntimeState(bundleRoot);
    expect(state.records).toEqual([]);
  });
});

test("runtime escalates dirty integration retries after the retry ceiling", async () => {
  await withWorktreeSandbox("dirty-retry-timeout", async ({ runtime, bundleRoot, itemFile }) => {
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();

    await replaceStatus(prepared!.isolatedItemFile, "in-review");
    await appendBody(itemFile, "Dirty integration marker.");

    const blocked = await runtime.finalizeDispatch({
      prepared: prepared!,
      entry: ENTRY,
      sessionId: null,
      durationMs: 1_500,
      numTurns: 2,
      costUsd: 0.07,
      success: true,
    });

    expect(blocked.blocked).toBe(true);
    expect(blocked.incidentKind).toBe("dirty_integration_checkout");

    for (let attempt = 1; attempt <= DIRTY_INTEGRATION_RETRY_LIMIT; attempt += 1) {
      const retries = await runtime.retryBlockedDirtyDispatches();
      expect(retries).toHaveLength(1);
      expect(retries[0]?.attempt).toBe(attempt);
      expect(retries[0]?.action).toBe("blocked");
      expect(retries[0]?.treeState).toBe("dirty");
      expect(retries[0]?.incidentKind).toBe("dirty_integration_checkout");
    }

    const timedOut = await runtime.retryBlockedDirtyDispatches();
    expect(timedOut).toHaveLength(1);
    expect(timedOut[0]?.attempt).toBe(DIRTY_INTEGRATION_RETRY_LIMIT + 1);
    expect(timedOut[0]?.action).toBe("timed_out");
    expect(timedOut[0]?.treeState).toBe("dirty");
    expect(timedOut[0]?.incidentKind).toBe("primary_dirty_timeout");
    expect(timedOut[0]?.incidentMessage).toContain("timed out");

    const state = await readRuntimeState(bundleRoot);
    expect(state.records[0]?.status).toBe("blocked");
    expect(state.records[0]?.incident?.kind).toBe("primary_dirty_timeout");
    expect(state.records[0]?.incident?.retry_count).toBe(DIRTY_INTEGRATION_RETRY_LIMIT + 1);

    const postTimeout = await runtime.retryBlockedDirtyDispatches();
    expect(postTimeout).toEqual([]);
  });
});

test("runtime reclassifies dirty retry failures when the clean tree reveals a real conflict", async () => {
  await withWorktreeSandbox("dirty-retry-reclassify", async ({
    runtime,
    bundleRoot,
    systemRoot,
    itemFile,
  }) => {
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();

    await replaceStatus(prepared!.isolatedItemFile, "in-review");
    await replaceStatus(itemFile, "operator-edit");

    const blocked = await runtime.finalizeDispatch({
      prepared: prepared!,
      entry: ENTRY,
      sessionId: null,
      durationMs: 1_600,
      numTurns: 3,
      costUsd: 0.08,
      success: true,
    });

    expect(blocked.blocked).toBe(true);
    expect(blocked.incidentKind).toBe("dirty_integration_checkout");

    await gitCommit(systemRoot, "operator: commit conflicting status change");

    const retries = await runtime.retryBlockedDirtyDispatches();
    expect(retries).toHaveLength(1);
    expect(retries[0]?.action).toBe("blocked");
    expect(retries[0]?.treeState).toBe("clean");
    expect(retries[0]?.incidentKind).toBe("tracked_path_conflict");

    const state = await readRuntimeState(bundleRoot);
    expect(state.records[0]?.status).toBe("blocked");
    expect(state.records[0]?.incident?.kind).toBe("tracked_path_conflict");
    expect(state.records[0]?.incident?.retry_count).toBe(0);
    expect(state.records[0]?.base_commit).toBe(await runGit(systemRoot, ["rev-parse", "HEAD"]));
  });
});

test("dispatcher scan ignores unstaged status transitions until they are committed", async () => {
  await withWorktreeSandbox("head-scan-unstaged", async ({ systemRoot, itemFile }) => {
    await replaceStatus(itemFile, "in-review");

    const firstCapture = await captureConsole(async () => (
      scan(join(systemRoot, "als-factory"), "jobs/{id}.md", "status")
    ));
    expect(firstCapture.result).toHaveLength(1);
    expect(firstCapture.result[0]?.status).toBe("in-dev");
    expect(firstCapture.logs).toEqual([
      "[dispatcher] status-drift: ALS-001 has an uncommitted status transition in-dev -> in-review in the working tree; continuing to read HEAD state",
    ]);
    expect(firstCapture.warnings).toEqual([
      "[dispatcher] status-drift: status transition is not committed; dispatcher only reads HEAD — commit the transition to proceed (ALS-001: in-dev -> in-review)",
    ]);

    await gitCommit(systemRoot, "operator: commit status transition");

    const secondCapture = await captureConsole(async () => (
      scan(join(systemRoot, "als-factory"), "jobs/{id}.md", "status")
    ));
    expect(secondCapture.result).toHaveLength(1);
    expect(secondCapture.result[0]?.status).toBe("in-review");
    expect(secondCapture.logs).toEqual([]);
    expect(secondCapture.warnings).toEqual([]);
  });
});

test("dispatcher scan ignores staged status transitions until they are committed", async () => {
  await withWorktreeSandbox("head-scan-staged", async ({ systemRoot, itemFile }) => {
    await replaceStatus(itemFile, "in-review");
    await runGit(systemRoot, ["add", "."]);

    const capture = await captureConsole(async () => (
      scan(join(systemRoot, "als-factory"), "jobs/{id}.md", "status")
    ));
    expect(capture.result).toHaveLength(1);
    expect(capture.result[0]?.status).toBe("in-dev");
    expect(capture.logs).toEqual([
      "[dispatcher] status-drift: ALS-001 has an uncommitted status transition in-dev -> in-review in the working tree; continuing to read HEAD state",
    ]);
    expect(capture.warnings).toEqual([
      "[dispatcher] status-drift: status transition is not committed; dispatcher only reads HEAD — commit the transition to proceed (ALS-001: in-dev -> in-review)",
    ]);
  });
});

test("dispatcher scan diagnostics record active-operator accept and skip outcomes", async () => {
  await withWorktreeSandbox("scan-active-operator", async ({ systemRoot, itemFile }) => {
    const raw = await readFile(itemFile, "utf-8");
    await writeFile(
      itemFile,
      raw.replace("status: in-dev", "status: in-dev\noperator: nick"),
      "utf-8",
    );
    await gitCommit(systemRoot, "fixture: add operator assignment");

    const accepted = await scanWithDiagnostics(
      join(systemRoot, "als-factory"),
      "jobs/{id}.md",
      "status",
      undefined,
      undefined,
      { field: "operator", mode: "strict", operatorId: "nick" },
    );
    expect(accepted.items).toHaveLength(1);
    expect(accepted.decisions[0]?.active_operator.outcome).toBe("accepted");

    const skipped = await scanWithDiagnostics(
      join(systemRoot, "als-factory"),
      "jobs/{id}.md",
      "status",
      undefined,
      undefined,
      { field: "operator", mode: "strict", operatorId: "other" },
    );
    expect(skipped.items).toHaveLength(0);
    expect(skipped.decisions[0]?.active_operator.outcome).toBe("skipped_operator_mismatch");
  });
});

test("runCommand resolves concurrent git probes against a real repo", async () => {
  await withWorktreeSandbox("run-command-concurrency", async ({ systemRoot }) => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => (
        runCommand(["git", "rev-parse", "--show-prefix"], { cwd: systemRoot })
      )),
    );

    expect(results).toHaveLength(12);
    expect(results.every((result) => result.exitCode === 0)).toBe(true);
    expect(results.every((result) => result.stdout.trim() === "")).toBe(true);
    expect(results.every((result) => result.stderr === "")).toBe(true);
  });
});

test("runtime squashes agent-authored worktree commits into the audited merge commit", async () => {
  await withWorktreeSandbox("merge-authored-commit", async ({ runtime, systemRoot, itemFile }) => {
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();

    await replaceStatus(prepared!.isolatedItemFile, "in-review");
    await appendBody(prepared!.isolatedItemFile, "Agent-authored note.");
    await gitCommit(prepared!.worktreePath, "agent: authored commit");

    const result = await runtime.finalizeDispatch({
      prepared: prepared!,
      entry: ENTRY,
      sessionId: "22222222-2222-4222-8222-222222222222",
      durationMs: 7_500,
      numTurns: 9,
      costUsd: 1.25,
      success: true,
    });

    expect(result.success).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.mergeOutcome).toBe("merged");
    expect(await readFrontmatterStatus(itemFile)).toBe("in-review");
    expect(await readFile(itemFile, "utf-8")).toContain("Agent-authored note.");

    const lastCommitMessage = await runGit(systemRoot, ["log", "-1", "--pretty=%B"]);
    expect(lastCommitMessage).toContain("delamain: ALS-001 in-dev → in-review [factory-jobs]");
    expect(lastCommitMessage).not.toContain("agent: authored commit");
  });
});

test("runtime preserves blocked worktrees when stale-base refresh hits a conflict", async () => {
  await withWorktreeSandbox("merge-conflict", async ({ runtime, bundleRoot, systemRoot, itemFile }) => {
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();

    await replaceStatus(prepared!.isolatedItemFile, "in-review");
    await replaceStatus(itemFile, "operator-edit");
    await gitCommit(systemRoot, "operator: conflict edit");
    const operatorHead = await runGit(systemRoot, ["rev-parse", "HEAD"]);

    const result = await runtime.finalizeDispatch({
      prepared: prepared!,
      entry: ENTRY,
      sessionId: null,
      durationMs: 1_500,
      numTurns: 3,
      costUsd: 0.1,
      success: true,
    });

    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.incidentKind).toBe("tracked_path_conflict");
    expect(existsSync(prepared!.worktreePath)).toBe(true);
    expect(await readFrontmatterStatus(itemFile)).toBe("operator-edit");
    expect(prepared!.baseCommit).toBe(operatorHead);

    const state = await readRuntimeState(bundleRoot);
    expect(state.records[0]?.status).toBe("blocked");
    expect(state.records[0]?.incident?.kind).toBe("tracked_path_conflict");
    expect(state.records[0]?.incident?.incident_context?.phase).toBe("integration");
    expect(state.records[0]?.incident?.incident_context?.cause).toBe("tracked_path_conflict");
    expect(state.records[0]?.base_commit).toBe(operatorHead);
    expect(state.records[0]?.worktree_commit).not.toBeNull();

    const telemetry = await readTelemetryEvents(bundleRoot, 50);
    expect(telemetry.events.some((event) => event.event_type === "merge_attempt_start")).toBe(true);
    expect(telemetry.events.some((event) => event.event_type === "refresh_decision")).toBe(true);
  });
});

test("runtime blocks stale-base refresh when main moves below the recorded base", async () => {
  await withWorktreeSandbox("merge-force-push-below-base", async ({ runtime, systemRoot, itemFile }) => {
    await appendBody(itemFile, "Pre-dispatch baseline.");
    await gitCommit(systemRoot, "operator: pre-dispatch baseline");
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();
    const baseCommit = prepared!.baseCommit;
    const resetTarget = await runGit(systemRoot, ["rev-parse", `${baseCommit}^`]);

    await replaceStatus(prepared!.isolatedItemFile, "in-review");
    await runGit(systemRoot, ["reset", "--hard", resetTarget]);

    const result = await runtime.finalizeDispatch({
      prepared: prepared!,
      entry: ENTRY,
      sessionId: null,
      durationMs: 1_900,
      numTurns: 2,
      costUsd: 0.08,
      success: true,
    });

    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.incidentKind).toBe("stale_base_conflict");
    expect(await runGit(systemRoot, ["rev-parse", "HEAD"])).toBe(resetTarget);
    expect(await readFrontmatterStatus(itemFile)).toBe("in-dev");
    expect(existsSync(prepared!.worktreePath)).toBe(true);

    const state = await readRuntimeState(join(systemRoot, "..", ".claude", "delamains", "factory-jobs"));
    expect(state.records[0]?.status).toBe("blocked");
    expect(state.records[0]?.incident?.kind).toBe("stale_base_conflict");
    expect(state.records[0]?.base_commit).toBe(resetTarget);
  });
});

test("orphan sweeper preserves pristine records when cleanup fails", async () => {
  await withWorktreeSandbox("orphan-cleanup-failure", async ({ runtime, bundleRoot, itemFile }) => {
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();
    await markRecordDead(bundleRoot, "ALS-001");

    const isolation = Reflect.get(runtime as object, "isolation") as {
      cleanupDispatch: (input: { worktreePath: string | null; branchName: string | null }) => Promise<void>;
    };
    const originalCleanup = isolation.cleanupDispatch.bind(isolation);
    isolation.cleanupDispatch = async () => {
      throw new Error("simulated cleanup failure");
    };

    try {
      const summary = await runtime.sweepOrphans();
      expect(summary.pristineOrphansPruned).toBe(0);
      expect(await runtime.hasOpenRecord("ALS-001")).toBe(true);

      const state = await readRuntimeState(bundleRoot);
      expect(state.records[0]?.status).toBe("orphaned");
      expect(state.records[0]?.incident?.kind).toBe("orphan_cleanup_failed");
      expect(state.records[0]?.latest_error).toBe("simulated cleanup failure");
      expect(existsSync(prepared!.worktreePath)).toBe(true);
    } finally {
      isolation.cleanupDispatch = originalCleanup;
    }
  });
});

test("orphan sweeper prunes missing pristine worktrees and deletes their branch refs", async () => {
  await withWorktreeSandbox("orphan-missing-worktree", async ({ runtime, bundleRoot, systemRoot, itemFile }) => {
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();
    await markRecordDead(bundleRoot, "ALS-001");
    await rm(prepared!.worktreePath, { recursive: true, force: true });

    expect(await runGit(systemRoot, ["branch", "--list", prepared!.branchName])).toContain(prepared!.branchName);

    const summary = await runtime.sweepOrphans();
    expect(summary.pristineOrphansPruned).toBe(1);
    expect(await runtime.hasOpenRecord("ALS-001")).toBe(false);
    expect(await runGit(systemRoot, ["branch", "--list", prepared!.branchName])).toBe("");
  });
});

test("orphan sweeper prunes pristine worktrees and preserves dirty ones", async () => {
  await withWorktreeSandbox("orphan-sweep", async ({ runtime, bundleRoot, itemFile }) => {
    const pristine = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(pristine).not.toBeNull();
    await markRecordDead(bundleRoot, "ALS-001");

    let summary = await runtime.sweepOrphans();
    expect(summary.pristineOrphansPruned).toBe(1);
    expect(await runtime.hasOpenRecord("ALS-001")).toBe(false);

    const dirty = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(dirty).not.toBeNull();
    await replaceStatus(dirty!.isolatedItemFile, "in-review");
    await markRecordDead(bundleRoot, "ALS-001");

    summary = await runtime.sweepOrphans();
    expect(summary.dirtyOrphansPreserved).toBe(1);

    const state = await readRuntimeState(bundleRoot);
    expect(state.records[0]?.status).toBe("orphaned");
    expect(existsSync(dirty!.worktreePath)).toBe(true);
  });
});

test("repo mutation lease sweeps stale locks left by dead owners", async () => {
  const root = await mkdtemp(join(tmpdir(), "als-delamain-lock-"));
  const systemRoot = join(root, "system");
  await mkdir(systemRoot, { recursive: true });

  const lock = new RepoMutationLock(systemRoot, { staleMs: 1 });
  const lockDir = join(systemRoot, ".claude", "delamains", ".runtime", "repo-mutation.lock");
  await mkdir(lockDir, { recursive: true });
  await writeFile(
    join(lockDir, "lease.json"),
    JSON.stringify({
      schema: "als-delamain-repo-mutation-lock@1",
      dispatch_id: "d-stale",
      dispatcher_name: "factory-jobs",
      item_id: "ALS-001",
      worktree_path: "/tmp/.worktrees/d-stale",
      acquired_at: "2026-04-18T00:00:00.000Z",
      owner_pid: 2_147_483_647,
    }) + "\n",
    "utf-8",
  );

  try {
    const summary = await lock.sweepStaleLease(new Date("2026-04-18T00:10:00.000Z"));
    expect(summary.released).toBe(true);
    expect(summary.stale).toBe(true);
    expect(existsSync(lockDir)).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo mutation lease sweeps stale metadata-less lock directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "als-delamain-lock-metadata-less-"));
  const systemRoot = join(root, "system");
  await mkdir(systemRoot, { recursive: true });

  const lock = new RepoMutationLock(systemRoot, { staleMs: 1 });
  const lockDir = join(systemRoot, ".claude", "delamains", ".runtime", "repo-mutation.lock");
  await mkdir(lockDir, { recursive: true });

  try {
    const summary = await lock.sweepStaleLease(new Date(Date.now() + 10_000));
    expect(summary.released).toBe(true);
    expect(summary.stale).toBe(true);
    expect(summary.metadata).toBeNull();
    expect(existsSync(lockDir)).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo mutation lease preserves fresh metadata-less lock directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "als-delamain-lock-fresh-"));
  const systemRoot = join(root, "system");
  await mkdir(systemRoot, { recursive: true });

  const lock = new RepoMutationLock(systemRoot, { staleMs: 60_000 });
  const lockDir = join(systemRoot, ".claude", "delamains", ".runtime", "repo-mutation.lock");
  await mkdir(lockDir, { recursive: true });

  try {
    const summary = await lock.sweepStaleLease(new Date());
    expect(summary.released).toBe(false);
    expect(summary.stale).toBe(false);
    expect(summary.metadata).toBeNull();
    expect(existsSync(lockDir)).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo mutation lease timeout always outlives stale detection", async () => {
  const root = await mkdtemp(join(tmpdir(), "als-delamain-lock-timeout-"));
  const systemRoot = join(root, "system");
  await mkdir(systemRoot, { recursive: true });

  try {
    const lock = new RepoMutationLock(systemRoot, {
      pollMs: 250,
      staleMs: 5 * 60_000,
      timeoutMs: 2 * 60_000,
    });

    expect(Reflect.get(lock as object, "timeoutMs")).toBe(5 * 60_000 + 250);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function withWorktreeSandbox(
  label: string,
  run: (input: {
    root: string;
    systemRoot: string;
    hostOrigin: string;
    bundleRoot: string;
    itemFile: string;
    worktreeRoot: string;
    runtime: DispatcherRuntime;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `als-delamain-worktree-${label}-`));
  const systemRoot = join(root, "system");
  const hostOrigin = join(root, "system-origin");
  const bundleRoot = join(root, ".claude", "delamains", "factory-jobs");
  const worktreeRoot = join(root, ".worktrees");
  const itemFile = join(systemRoot, "als-factory", "jobs", "ALS-001.md");

  try {
    await mkdir(join(systemRoot, "als-factory", "jobs"), { recursive: true });
    await mkdir(bundleRoot, { recursive: true });
    await writeFile(
      itemFile,
      [
        "---",
        "id: ALS-001",
        "status: in-dev",
        "title: Worktree runtime",
        "---",
        "",
        "Dispatcher runtime fixture.",
      ].join("\n") + "\n",
      "utf-8",
    );

    await runGit(systemRoot, ["init"]);
    await runGit(systemRoot, ["branch", "-M", "main"]);
    await runGit(systemRoot, ["add", "."]);
    await runGit(
      systemRoot,
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@local",
        "commit",
        "--no-gpg-sign",
        "-m",
        "fixture: initial commit",
      ],
    );
    await runGit(root, ["clone", systemRoot, hostOrigin]);
    await runGit(hostOrigin, ["config", "receive.denyCurrentBranch", "updateInstead"]);
    await runGit(systemRoot, ["remote", "add", "origin", hostOrigin]);
    await runGit(systemRoot, ["push", "-u", "origin", "main"]);

    const runtime = new DispatcherRuntime({
      bundleRoot,
      systemRoot,
      delamainName: "factory-jobs",
      statusField: "status",
      pollMs: 1000,
      worktreeRoot,
    });

    await run({
      root,
      systemRoot,
      hostOrigin,
      bundleRoot,
      itemFile,
      worktreeRoot,
      runtime,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function withSubmoduleWorktreeSandbox(
  label: string,
  run: (input: {
    root: string;
    systemRoot: string;
    hostOrigin: string;
    bundleRoot: string;
    itemFile: string;
    worktreeRoot: string;
    primarySubmoduleRoot: string;
    submoduleOrigin: string;
    runtime: DispatcherRuntime;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `als-delamain-submodule-worktree-${label}-`));
  const systemRoot = join(root, "system");
  const hostOrigin = join(root, "system-origin");
  const bundleRoot = join(root, ".claude", "delamains", "factory-jobs");
  const worktreeRoot = join(root, ".worktrees");
  const submoduleOrigin = join(root, "als-origin");
  const itemFile = join(systemRoot, "als-factory", "jobs", "ALS-001.md");
  const primarySubmoduleRoot = join(systemRoot, "nfrith-repos", "als");

  try {
    await mkdir(join(systemRoot, "als-factory", "jobs"), { recursive: true });
    await mkdir(bundleRoot, { recursive: true });
    await mkdir(submoduleOrigin, { recursive: true });
    await writeFile(
      itemFile,
      [
        "---",
        "id: ALS-001",
        "status: in-dev",
        "title: Worktree runtime",
        "---",
        "",
        "Dispatcher runtime fixture.",
      ].join("\n") + "\n",
      "utf-8",
    );
    await writeFile(join(submoduleOrigin, "CHANGELOG.md"), "# Changelog\n\n", "utf-8");

    await runGit(submoduleOrigin, ["init"]);
    await runGit(submoduleOrigin, ["branch", "-M", "main"]);
    await runGit(submoduleOrigin, ["add", "."]);
    await runGit(
      submoduleOrigin,
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@local",
        "commit",
        "--no-gpg-sign",
        "-m",
        "fixture: initial submodule commit",
      ],
    );
    await runGit(submoduleOrigin, ["config", "receive.denyCurrentBranch", "updateInstead"]);

    await runGit(systemRoot, ["init"]);
    await runGit(systemRoot, ["branch", "-M", "main"]);
    await runGit(
      systemRoot,
      ["-c", "protocol.file.allow=always", "submodule", "add", submoduleOrigin, "nfrith-repos/als"],
    );
    await runGit(primarySubmoduleRoot, ["checkout", "-B", "main", "--track", "origin/main"]);
    await runGit(systemRoot, ["add", "."]);
    await runGit(
      systemRoot,
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@local",
        "commit",
        "--no-gpg-sign",
        "-m",
        "fixture: initial commit",
      ],
    );
    await runGit(root, ["clone", systemRoot, hostOrigin]);
    await runGit(hostOrigin, ["config", "receive.denyCurrentBranch", "updateInstead"]);
    await runGit(systemRoot, ["remote", "add", "origin", hostOrigin]);
    await runGit(systemRoot, ["push", "-u", "origin", "main"]);

    const runtime = new DispatcherRuntime({
      bundleRoot,
      systemRoot,
      delamainName: "factory-jobs",
      statusField: "status",
      pollMs: 1000,
      worktreeRoot,
      submodules: ["nfrith-repos/als"],
    });

    await run({
      root,
      systemRoot,
      hostOrigin,
      bundleRoot,
      itemFile,
      worktreeRoot,
      primarySubmoduleRoot,
      submoduleOrigin,
      runtime,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeJobFixture(filePath: string, itemId: string, status = "in-dev"): Promise<void> {
  await writeFile(
    filePath,
    [
      "---",
      `id: ${itemId}`,
      `status: ${status}`,
      "title: Worktree runtime",
      "---",
      "",
      "Dispatcher runtime fixture.",
    ].join("\n") + "\n",
    "utf-8",
  );
}

async function replaceStatus(filePath: string, status: string): Promise<void> {
  const raw = await readFile(filePath, "utf-8");
  await writeFile(
    filePath,
    raw.replace(/^status:\s+.*$/m, `status: ${status}`),
    "utf-8",
  );
}

async function appendBody(filePath: string, line: string): Promise<void> {
  const raw = await readFile(filePath, "utf-8");
  await writeFile(filePath, raw + `${line}\n`, "utf-8");
}

async function readFrontmatterStatus(filePath: string): Promise<string | null> {
  const raw = await readFile(filePath, "utf-8");
  const match = raw.match(/^status:\s+(.*)$/m);
  return match?.[1]?.trim() ?? null;
}

async function gitCommit(cwd: string, message: string): Promise<void> {
  await runGit(cwd, ["add", "."]);
  await runGit(
    cwd,
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@local",
      "commit",
      "--no-gpg-sign",
      "-m",
      message,
    ],
  );
}

async function mutateRemoteViaClone(
  root: string,
  remoteRoot: string,
  label: string,
  mutate: (cloneRoot: string) => Promise<void>,
): Promise<void> {
  const cloneRoot = await mkdtemp(join(root, `${label}-`));
  try {
    await runGit(root, ["clone", remoteRoot, cloneRoot]);
    await mutate(cloneRoot);
    await runGit(cloneRoot, ["push", "origin", "main"]);
  } finally {
    await rm(cloneRoot, { recursive: true, force: true });
  }
}

async function installPrePushRemoteAdvanceHook(input: {
  repoRoot: string;
  root: string;
  remoteRoot: string;
  label: string;
  attempts: number;
}): Promise<void> {
  const hooksRoot = join(input.repoRoot, ".git", "hooks");
  const hookPath = join(hooksRoot, "pre-push");
  const counterPath = join(input.root, `${input.label}-pre-push-count.txt`);

  await mkdir(hooksRoot, { recursive: true });
  await writeFile(
    hookPath,
    [
      "#!/bin/sh",
      "set -eu",
      `ROOT=${shellQuote(input.root)}`,
      `REMOTE=${shellQuote(input.remoteRoot)}`,
      `COUNTER=${shellQuote(counterPath)}`,
      `LABEL=${shellQuote(input.label)}`,
      `ATTEMPTS=${input.attempts}`,
      'count=0',
      'if [ -f "$COUNTER" ]; then',
      '  count=$(cat "$COUNTER")',
      "fi",
      'if [ "$count" -ge "$ATTEMPTS" ]; then',
      "  exit 0",
      "fi",
      'next=$((count + 1))',
      'printf "%s" "$next" > "$COUNTER"',
      'clone_root="$ROOT/$LABEL-hook-$next"',
      'rm -rf "$clone_root"',
      'git clone -q "$REMOTE" "$clone_root"',
      'cd "$clone_root"',
      'printf "hook advance %s\\n" "$next" > "$LABEL-hook-$next.txt"',
      'git add .',
      'git -c user.name=Fixture -c user.email=fixture@local commit -q --no-gpg-sign -m "hook: advance remote $next"',
      'git push -q origin main',
      'cd "$ROOT"',
      'rm -rf "$clone_root"',
      "exit 0",
      "",
    ].join("\n"),
    "utf-8",
  );
  await chmod(hookPath, 0o755);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

async function captureConsole<T>(
  run: () => Promise<T>,
): Promise<{ result: T; logs: string[]; warnings: string[] }> {
  const logs: string[] = [];
  const warnings: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;

  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };

  try {
    return {
      result: await run(),
      logs,
      warnings,
    };
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

async function markRecordDead(bundleRoot: string, itemId: string): Promise<void> {
  const state = await readRuntimeState(bundleRoot);
  const nextState: RuntimeDispatchState = {
    ...state,
    records: state.records.map((record) => (
      record.item_id === itemId
        ? {
          ...record,
          owner_pid: 2_147_483_647,
          heartbeat_at: "2026-04-18T00:00:00.000Z",
          updated_at: "2026-04-18T00:00:00.000Z",
        }
        : record
    )),
  };
  await writeRuntimeState(bundleRoot, nextState);
}
