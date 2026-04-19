import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DispatcherRuntime } from "../../../skills/new/references/dispatcher/src/dispatcher-runtime.ts";
import { RepoMutationLock } from "../../../skills/new/references/dispatcher/src/repo-mutation-lock.ts";
import { scan } from "../../../skills/new/references/dispatcher/src/watcher.ts";
import {
  readRuntimeState,
  writeRuntimeState,
  type RuntimeDispatchState,
} from "../../../skills/new/references/dispatcher/src/runtime-state.ts";
import { runGit } from "../../../skills/new/references/dispatcher/src/git.ts";
import type { DispatchEntry } from "../../../skills/new/references/dispatcher/src/dispatcher.ts";

const ENTRY: DispatchEntry = {
  state: "in-dev",
  agentName: "in-dev",
  resumable: false,
  delegated: false,
  transitions: [{ class: "advance", to: "in-review" }],
};

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
  await withWorktreeSandbox("merge-clean", async ({ runtime, systemRoot, itemFile }) => {
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

    const lastCommitMessage = await runGit(systemRoot, ["log", "-1", "--pretty=%B"]);
    expect(lastCommitMessage).toContain("delamain: ALS-001 in-dev → in-review [factory-jobs]");
    expect(lastCommitMessage).toContain("Dispatch-Id:");
    expect(lastCommitMessage).toContain("Cost-Usd: 0.4200");
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
      "[dispatcher] ALS-018: ALS-001 has an uncommitted status transition in-dev -> in-review in the working tree; continuing to read HEAD state",
    ]);
    expect(firstCapture.warnings).toEqual([
      "[dispatcher] ALS-018: status transition is not committed; dispatcher only reads HEAD — commit the transition to proceed (ALS-001: in-dev -> in-review)",
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
      "[dispatcher] ALS-018: ALS-001 has an uncommitted status transition in-dev -> in-review in the working tree; continuing to read HEAD state",
    ]);
    expect(capture.warnings).toEqual([
      "[dispatcher] ALS-018: status transition is not committed; dispatcher only reads HEAD — commit the transition to proceed (ALS-001: in-dev -> in-review)",
    ]);
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

test("runtime preserves blocked worktrees when integration hits a conflict", async () => {
  await withWorktreeSandbox("merge-conflict", async ({ runtime, systemRoot, itemFile }) => {
    const prepared = await runtime.prepareDispatch("ALS-001", itemFile, ENTRY);
    expect(prepared).not.toBeNull();

    await replaceStatus(prepared!.isolatedItemFile, "in-review");
    await replaceStatus(itemFile, "operator-edit");
    await gitCommit(systemRoot, "operator: conflict edit");

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
    expect(result.incidentKind).toBe("merge_conflict");
    expect(existsSync(prepared!.worktreePath)).toBe(true);
    expect(await readFrontmatterStatus(itemFile)).toBe("operator-edit");

    const state = await readRuntimeState(join(systemRoot, "..", ".claude", "delamains", "factory-jobs"));
    expect(state.records[0]?.status).toBe("blocked");
    expect(state.records[0]?.incident?.kind).toBe("merge_conflict");
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
    bundleRoot: string;
    itemFile: string;
    worktreeRoot: string;
    runtime: DispatcherRuntime;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `als-delamain-worktree-${label}-`));
  const systemRoot = join(root, "system");
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
      bundleRoot,
      itemFile,
      worktreeRoot,
      runtime,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
