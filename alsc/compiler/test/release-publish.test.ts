import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runCommand, runGit } from "../../../delamain-dispatcher/src/git.ts";

const helperPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../shared/release-publish.ts");

test("release-publish CLI pushes a dispatch-branch release commit to origin/main", async () => {
  await withReleasePublishSandbox("main", async ({ dispatchRoot, originRoot, dispatchBranch }) => {
    await writeFile(join(dispatchRoot, "CHANGELOG.md"), "release: 0.6.0\n", "utf-8");
    await gitCommitAll(dispatchRoot, "release: 0.6.0");
    const releaseCommit = await runGit(dispatchRoot, ["rev-parse", "HEAD"]);

    const result = runReleasePublishCli({
      repoRoot: dispatchRoot,
      sourceRef: releaseCommit,
      destinationBranch: "main",
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      source_ref: releaseCommit,
      pushed_commit: releaseCommit,
      destination_branch: "main",
      destination_ref: "refs/heads/main",
      remote_name: "origin",
    });
    expect(await runGit(originRoot, ["rev-parse", "refs/heads/main"])).toBe(releaseCommit);
    expect(await readRef(originRoot, `refs/heads/${dispatchBranch}`)).toBeNull();
  });
});

test("release-publish CLI can target origin/stable without publishing the dispatch branch", async () => {
  await withReleasePublishSandbox("stable", async ({ dispatchRoot, originRoot, dispatchBranch }) => {
    await writeFile(join(dispatchRoot, "plugin.json"), "{\n  \"version\": \"0.6.1\"\n}\n", "utf-8");
    await gitCommitAll(dispatchRoot, "release: advance stable candidate");
    const stableCommit = await runGit(dispatchRoot, ["rev-parse", "HEAD"]);

    const result = runReleasePublishCli({
      repoRoot: dispatchRoot,
      sourceRef: stableCommit,
      destinationBranch: "stable",
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      source_ref: stableCommit,
      pushed_commit: stableCommit,
      destination_branch: "stable",
      destination_ref: "refs/heads/stable",
    });
    expect(await runGit(originRoot, ["rev-parse", "refs/heads/stable"])).toBe(stableCommit);
    expect(await readRef(originRoot, `refs/heads/${dispatchBranch}`)).toBeNull();
  });
});

test("release-publish CLI fails closed when the destination branch no longer fast-forwards", async () => {
  await withReleasePublishSandbox("non-ff", async ({ root, dispatchRoot, originRoot }) => {
    await writeFile(join(dispatchRoot, "CHANGELOG.md"), "release: 0.6.2\n", "utf-8");
    await gitCommitAll(dispatchRoot, "release: 0.6.2");
    const staleReleaseCommit = await runGit(dispatchRoot, ["rev-parse", "HEAD"]);

    const integratorRoot = join(root, "integrator");
    await runGit(root, ["-c", "protocol.file.allow=always", "clone", originRoot, integratorRoot]);
    await configureGitIdentity(integratorRoot);
    await writeFile(join(integratorRoot, "HOTFIX.md"), "hotfix\n", "utf-8");
    await gitCommitAll(integratorRoot, "fix: advance main first");
    const newerMainCommit = await runGit(integratorRoot, ["rev-parse", "HEAD"]);
    await runGit(integratorRoot, ["push", "origin", "HEAD:refs/heads/main"]);

    const result = runReleasePublishCli({
      repoRoot: dispatchRoot,
      sourceRef: staleReleaseCommit,
      destinationBranch: "main",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("failed to push some refs");
    expect(await runGit(originRoot, ["rev-parse", "refs/heads/main"])).toBe(newerMainCommit);
  });
});

async function withReleasePublishSandbox(
  label: string,
  run: (input: {
    root: string;
    originRoot: string;
    dispatchRoot: string;
    dispatchBranch: string;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `als-release-publish-${label}-`));
  try {
    const originRoot = join(root, "origin.git");
    const seedRoot = join(root, "seed");
    const dispatchRoot = join(root, "dispatch");
    const dispatchBranch = `delamain/als-factory-jobs/ALS-083/d-${label}`;

    await runGit(root, ["init", "--bare", originRoot]);
    await mkdir(seedRoot, { recursive: true });
    await runGit(seedRoot, ["init"]);
    await configureGitIdentity(seedRoot);
    await runGit(seedRoot, ["branch", "-M", "main"]);
    await writeFile(join(seedRoot, "README.md"), "# release publish fixture\n", "utf-8");
    await gitCommitAll(seedRoot, "chore: seed fixture");
    await runGit(seedRoot, ["remote", "add", "origin", originRoot]);
    await runGit(seedRoot, ["push", "-u", "origin", "main"]);
    await runGit(originRoot, ["symbolic-ref", "HEAD", "refs/heads/main"]);
    await runGit(seedRoot, ["branch", "stable"]);
    await runGit(seedRoot, ["push", "origin", "stable"]);

    await runGit(root, ["-c", "protocol.file.allow=always", "clone", originRoot, dispatchRoot]);
    await configureGitIdentity(dispatchRoot);
    await runGit(dispatchRoot, ["checkout", "-b", dispatchBranch, "origin/main"]);

    await run({ root, originRoot, dispatchRoot, dispatchBranch });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function configureGitIdentity(cwd: string): Promise<void> {
  await runGit(cwd, ["config", "user.name", "ALS Release Publish Tests"]);
  await runGit(cwd, ["config", "user.email", "als-release-publish-tests@local"]);
}

async function gitCommitAll(cwd: string, message: string): Promise<void> {
  await runGit(cwd, ["add", "."]);
  await runGit(cwd, ["commit", "--no-gpg-sign", "-m", message]);
}

function runReleasePublishCli(input: {
  repoRoot: string;
  sourceRef: string;
  destinationBranch: string;
}): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: [
      "bun",
      helperPath,
      "publish",
      "--repo-root",
      input.repoRoot,
      "--source-ref",
      input.sourceRef,
      "--destination-branch",
      input.destinationBranch,
    ],
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

async function readRef(cwd: string, ref: string): Promise<string | null> {
  const result = await runCommand(["git", "rev-parse", ref], { cwd });
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout.trim();
}
