import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DispatcherRuntime } from "../../../delamain-dispatcher/src/dispatcher-runtime.ts";
import {
  convergePrimaryClone,
  ensurePrimaryClonePreCommitGuard,
  PRIMARY_CLONE_PENDING_SCHEMA,
} from "../../../delamain-dispatcher/src/primary-clone-convergence.ts";
import { runCommand, runGit } from "../../../delamain-dispatcher/src/git.ts";

const helperPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../delamain-dispatcher/src/primary-clone-convergence.ts",
);

test("convergence fast-forwards a clean primary clone that is behind origin/main", async () => {
  await withPrimaryCloneSandbox("fast-forward", async ({ primaryRoot, originRoot, root }) => {
    await advanceOrigin(root, originRoot, "origin-fast-forward", async (cloneRoot) => {
      await writeFile(join(cloneRoot, "REMOTE.md"), "remote\n", "utf-8");
      await gitCommitAll(cloneRoot, "release: move origin first");
    });

    const result = await convergePrimaryClone({
      repoRoot: primaryRoot,
      publisher: "test-fast-forward",
    });

    expect(result.status).toBe("converged");
    expect(result.mode).toBe("fast_forwarded");
    expect(await runGit(primaryRoot, ["rev-parse", "HEAD"])).toBe(
      await runGit(originRoot, ["rev-parse", "refs/heads/main"]),
    );
    expect(existsSync(await readPendingStatePath(primaryRoot))).toBe(false);
  });
});

test("convergence records pending state when origin/main advances under dirty tracked and untracked work", async () => {
  await withPrimaryCloneSandbox("dirty-pending", async ({ primaryRoot, originRoot, root }) => {
    await advanceOrigin(root, originRoot, "origin-dirty-pending", async (cloneRoot) => {
      await writeFile(join(cloneRoot, "REMOTE.md"), "remote\n", "utf-8");
      await gitCommitAll(cloneRoot, "release: remote first");
    });

    await writeFile(join(primaryRoot, "README.md"), "# local rewrite\n", "utf-8");
    await writeFile(join(primaryRoot, "assets.png"), "binary\n", "utf-8");

    const previousHead = await runGit(primaryRoot, ["rev-parse", "HEAD"]);
    const result = await convergePrimaryClone({
      repoRoot: primaryRoot,
      publisher: "test-dirty-pending",
    });

    expect(result.status).toBe("pending");
    expect(result.reason).toBe("dirty_worktree");
    expect(result.pending_state.schema).toBe(PRIMARY_CLONE_PENDING_SCHEMA);
    expect(result.pending_state.worktree_paths).toEqual(
      expect.arrayContaining(["README.md", "assets.png"]),
    );
    expect(await runGit(primaryRoot, ["rev-parse", "HEAD"])).toBe(previousHead);

    const pending = JSON.parse(
      await readFile(await readPendingStatePath(primaryRoot), "utf-8"),
    ) as { schema: string; reason: string };
    expect(pending).toMatchObject({
      schema: PRIMARY_CLONE_PENDING_SCHEMA,
      reason: "dirty_worktree",
    });
  });
});

test("convergence replays a clean local commit onto the new canonical head when paths are orthogonal", async () => {
  await withPrimaryCloneSandbox("replay-local", async ({ primaryRoot, originRoot, root }) => {
    await writeFile(join(primaryRoot, "LOCAL.md"), "local\n", "utf-8");
    await gitCommitAll(primaryRoot, "docs: local commit first");
    const previousLocalHead = await runGit(primaryRoot, ["rev-parse", "HEAD"]);

    await advanceOrigin(root, originRoot, "origin-replay-local", async (cloneRoot) => {
      await writeFile(join(cloneRoot, "REMOTE.md"), "remote\n", "utf-8");
      await gitCommitAll(cloneRoot, "release: remote commit");
    });

    const result = await convergePrimaryClone({
      repoRoot: primaryRoot,
      publisher: "test-replay-local",
    });

    expect(result.status).toBe("converged");
    expect(result.mode).toBe("replayed_local_commits");
    expect(await runGit(primaryRoot, ["rev-parse", "HEAD"])).not.toBe(previousLocalHead);
    expect(
      await runCommand(
        [
          "git",
          "merge-base",
          "--is-ancestor",
          await runGit(originRoot, ["rev-parse", "refs/heads/main"]),
          await runGit(primaryRoot, ["rev-parse", "HEAD"]),
        ],
        { cwd: primaryRoot },
      ),
    ).toMatchObject({ exitCode: 0 });
    expect(await readFile(join(primaryRoot, "LOCAL.md"), "utf-8")).toBe("local\n");
    expect(await readFile(join(primaryRoot, "REMOTE.md"), "utf-8")).toBe("remote\n");
  });
});

test("convergence records overlap_blocked when local and remote commits touch the same path", async () => {
  await withPrimaryCloneSandbox("overlap-blocked", async ({ primaryRoot, originRoot, root }) => {
    await writeFile(join(primaryRoot, "README.md"), "# local change\n", "utf-8");
    await gitCommitAll(primaryRoot, "docs: local change");
    const previousHead = await runGit(primaryRoot, ["rev-parse", "HEAD"]);

    await advanceOrigin(root, originRoot, "origin-overlap-blocked", async (cloneRoot) => {
      await writeFile(join(cloneRoot, "README.md"), "# remote change\n", "utf-8");
      await gitCommitAll(cloneRoot, "release: remote change");
    });

    const result = await convergePrimaryClone({
      repoRoot: primaryRoot,
      publisher: "test-overlap-blocked",
    });

    expect(result.status).toBe("pending");
    expect(result.reason).toBe("overlap_blocked");
    expect(result.pending_state.conflict_paths).toEqual(["README.md"]);
    expect(await runGit(primaryRoot, ["rev-parse", "HEAD"])).toBe(previousHead);
  });
});

test("pre-commit guard blocks stale-base commits before git writes the commit object", async () => {
  await withPrimaryCloneSandbox("pre-commit-guard", async ({ primaryRoot, originRoot, root }) => {
    await ensurePrimaryClonePreCommitGuard({
      repoRoot: primaryRoot,
      helperScriptPath: helperPath,
    });

    await advanceOrigin(root, originRoot, "origin-pre-commit-guard", async (cloneRoot) => {
      await writeFile(join(cloneRoot, "REMOTE.md"), "remote\n", "utf-8");
      await gitCommitAll(cloneRoot, "release: remote first");
    });

    await writeFile(join(primaryRoot, "README.md"), "# staged local change\n", "utf-8");
    await runGit(primaryRoot, ["add", "README.md"]);
    const headBefore = await runGit(primaryRoot, ["rev-parse", "HEAD"]);

    const commit = await runCommand(
      ["git", "commit", "--no-gpg-sign", "-m", "docs: staged local change"],
      { cwd: primaryRoot },
    );

    expect(commit.exitCode).toBe(1);
    expect(`${commit.stderr}${commit.stdout}`).toContain("Primary clone convergence is still pending.");
    expect(await runGit(primaryRoot, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(existsSync(await readPendingStatePath(primaryRoot))).toBe(true);
  });
});

test("pre-commit guard skips secondary linked worktrees that share the primary hook", async () => {
  await withPrimaryCloneSandbox("secondary-worktree-skip", async ({ primaryRoot, originRoot, root }) => {
    await ensurePrimaryClonePreCommitGuard({
      repoRoot: primaryRoot,
      helperScriptPath: helperPath,
    });

    await advanceOrigin(root, originRoot, "origin-secondary-worktree-skip", async (cloneRoot) => {
      await writeFile(join(cloneRoot, "REMOTE.md"), "remote\n", "utf-8");
      await gitCommitAll(cloneRoot, "release: remote first");
    });

    const secondaryRoot = join(root, "dispatch");
    await runGit(primaryRoot, [
      "worktree",
      "add",
      "-b",
      "delamain/test-secondary-worktree",
      secondaryRoot,
      "HEAD",
    ]);

    expect(await realpath(await readHookPath(primaryRoot))).toBe(
      await realpath(await readHookPath(secondaryRoot)),
    );

    await writeFile(join(secondaryRoot, "DISPATCH.md"), "secondary\n", "utf-8");
    await runGit(secondaryRoot, ["add", "DISPATCH.md"]);
    const headBefore = await runGit(secondaryRoot, ["rev-parse", "HEAD"]);

    const commit = await runCommand(
      ["git", "commit", "--no-gpg-sign", "-m", "docs: secondary worktree change"],
      { cwd: secondaryRoot },
    );

    expect(commit.exitCode).toBe(0);
    expect(await runGit(secondaryRoot, ["rev-parse", "HEAD"])).not.toBe(headBefore);
    expect(existsSync(await readPendingStatePath(primaryRoot))).toBe(false);
    expect(existsSync(await readPendingStatePath(secondaryRoot))).toBe(false);
  });
});

test("pre-commit guard skips no-upstream fixture repos", async () => {
  const root = await mkdtemp(join(tmpdir(), "als-primary-clone-no-upstream-"));

  try {
    await initRepo(root);
    await writeFile(join(root, "README.md"), "# fixture seed\n", "utf-8");
    await gitCommitAll(root, "fixture: initial commit");

    await ensurePrimaryClonePreCommitGuard({
      repoRoot: root,
      helperScriptPath: helperPath,
    });

    await writeFile(join(root, "README.md"), "# fixture freeze\n", "utf-8");
    await runGit(root, ["add", "README.md"]);
    const headBefore = await runGit(root, ["rev-parse", "HEAD"]);

    const commit = await runCommand(
      ["git", "commit", "--no-gpg-sign", "-m", "test-prep: freeze fixture state"],
      { cwd: root },
    );

    expect(commit.exitCode).toBe(0);
    expect(await runGit(root, ["rev-parse", "HEAD"])).not.toBe(headBefore);
    expect(existsSync(await readPendingStatePath(root))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dispatcher runtime owns symmetric guard installation for host and mounted primary repos", async () => {
  const root = await mkdtemp(join(tmpdir(), "als-primary-clone-runtime-"));
  const hostRoot = join(root, "host");
  const bundleRoot = join(root, "bundle");
  const nestedRepoRoot = join(hostRoot, "nfrith-repos", "als");

  try {
    await initRepo(hostRoot);
    await initRepo(nestedRepoRoot);
    await mkdir(bundleRoot, { recursive: true });

    const runtime = new DispatcherRuntime({
      bundleRoot,
      systemRoot: hostRoot,
      delamainName: "factory-jobs",
      statusField: "status",
      pollMs: 1_000,
      submodules: ["nfrith-repos/als"],
    });

    await runtime.ensurePrimaryCloneCommitGuards();

    const hostHook = await readHookPath(hostRoot);
    const nestedHook = await readHookPath(nestedRepoRoot);
    expect(existsSync(hostHook)).toBe(true);
    expect(existsSync(nestedHook)).toBe(true);
    expect(await readFile(hostHook, "utf-8")).toContain("ALS_PRIMARY_CLONE_GUARD");
    expect(await readFile(nestedHook, "utf-8")).toContain("ALS_PRIMARY_CLONE_GUARD");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function withPrimaryCloneSandbox(
  label: string,
  run: (input: {
    root: string;
    originRoot: string;
    primaryRoot: string;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `als-primary-clone-${label}-`));
  try {
    const originRoot = join(root, "origin.git");
    const seedRoot = join(root, "seed");
    const primaryRoot = join(root, "primary");

    await runGit(root, ["init", "--bare", originRoot]);
    await initRepo(seedRoot);
    await runGit(seedRoot, ["branch", "-M", "main"]);
    await writeFile(join(seedRoot, "README.md"), "# seed\n", "utf-8");
    await gitCommitAll(seedRoot, "chore: seed repo");
    await runGit(seedRoot, ["remote", "add", "origin", originRoot]);
    await runGit(seedRoot, ["push", "-u", "origin", "main"]);
    await runGit(originRoot, ["symbolic-ref", "HEAD", "refs/heads/main"]);

    await runGit(root, ["-c", "protocol.file.allow=always", "clone", originRoot, primaryRoot]);
    await configureGitIdentity(primaryRoot);

    await run({ root, originRoot, primaryRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function initRepo(repoRoot: string): Promise<void> {
  await mkdir(repoRoot, { recursive: true });
  await runGit(repoRoot, ["init"]);
  await configureGitIdentity(repoRoot);
}

async function configureGitIdentity(cwd: string): Promise<void> {
  await runGit(cwd, ["config", "user.name", "ALS Primary Clone Tests"]);
  await runGit(cwd, ["config", "user.email", "als-primary-clone-tests@local"]);
}

async function gitCommitAll(cwd: string, message: string): Promise<void> {
  await runGit(cwd, ["add", "."]);
  await runGit(cwd, ["commit", "--no-gpg-sign", "-m", message]);
}

async function advanceOrigin(
  root: string,
  originRoot: string,
  label: string,
  mutate: (cloneRoot: string) => Promise<void>,
): Promise<void> {
  const cloneRoot = await mkdtemp(join(root, `${label}-`));
  try {
    await runGit(root, ["-c", "protocol.file.allow=always", "clone", originRoot, cloneRoot]);
    await configureGitIdentity(cloneRoot);
    await mutate(cloneRoot);
    await runGit(cloneRoot, ["push", "origin", "HEAD:refs/heads/main"]);
  } finally {
    await rm(cloneRoot, { recursive: true, force: true });
  }
}

async function readPendingStatePath(repoRoot: string): Promise<string> {
  const output = await runGit(repoRoot, ["rev-parse", "--git-path", "als/primary-clone-convergence.json"]);
  return output.startsWith("/") ? output : resolve(repoRoot, output);
}

async function readHookPath(repoRoot: string): Promise<string> {
  const output = await runGit(repoRoot, ["rev-parse", "--git-path", "hooks/pre-commit"]);
  return output.startsWith("/") ? output : resolve(repoRoot, output);
}
