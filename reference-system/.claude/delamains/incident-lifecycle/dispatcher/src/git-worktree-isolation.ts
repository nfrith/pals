import { existsSync } from "fs";
import { mkdir, rm } from "fs/promises";
import { homedir } from "os";
import { dirname, join, relative, resolve } from "path";
import {
  gitCurrentBranch,
  gitHasChanges,
  gitHeadCommit,
  gitIsClean,
  runCommand,
  runGit,
} from "./git.js";

export interface MountedSubmoduleWorktree {
  repoPath: string;
  primaryRepoPath: string;
  worktreePath: string;
  branchName: string;
  baseCommit: string;
}

export interface IsolatedDispatch {
  dispatchId: string;
  itemId: string;
  baseCommit: string;
  branchName: string;
  baseBranch: string;
  itemFile: string;
  isolatedItemFile: string;
  worktreePath: string;
  mountedSubmodules: MountedSubmoduleWorktree[];
}

interface GitWorktreeIsolationOptions {
  systemRoot: string;
  delamainName: string;
  worktreeRoot?: string;
  submodules?: string[];
}

export interface MountedWorktreeInspection {
  repoPath: string;
  exists: boolean;
  pristine: boolean;
  dirty: boolean;
  headCommit: string | null;
  worktreePath: string | null;
}

export interface WorktreeInspection {
  exists: boolean;
  pristine: boolean;
  dirty: boolean;
  headCommit: string | null;
  mountedSubmodules: MountedWorktreeInspection[];
}

export interface MergeBackResult {
  status: "merged" | "blocked";
  worktreeCommit: string | null;
  integratedCommit: string | null;
  mountedSubmodules: Array<{
    repoPath: string;
    worktreeCommit: string | null;
    integratedCommit: string | null;
  }>;
  error: string | null;
  incidentKind: string | null;
}

interface MountedSubmoduleCommit {
  repoPath: string;
  worktreeCommit: string;
}

interface IntegratedSubmoduleCommit extends MountedSubmoduleCommit {
  primaryRepoPath: string;
  worktreePath: string;
  branchName: string;
  integratedCommit: string;
  preIntegrationHead: string;
}

export class GitWorktreeIsolationStrategy {
  private readonly systemRoot: string;
  private readonly delamainName: string;
  private readonly worktreeRoot: string;
  private readonly submodules: string[];

  constructor(options: GitWorktreeIsolationOptions) {
    this.systemRoot = resolve(options.systemRoot);
    this.delamainName = options.delamainName;
    this.worktreeRoot = options.worktreeRoot
      ? resolve(options.worktreeRoot)
      : join(homedir(), ".worktrees", "delamain");
    this.submodules = [...new Set((options.submodules ?? []).map((value) => normalizeRepoPath(value)))];
  }

  async prepareDispatch(input: {
    dispatchId: string;
    itemId: string;
    itemFile: string;
  }): Promise<IsolatedDispatch> {
    const baseCommit = await gitHeadCommit(this.systemRoot);
    const baseBranch = await gitCurrentBranch(this.systemRoot);
    const branchName = buildWorktreeBranchName(this.delamainName, input.itemId, input.dispatchId);
    const worktreePath = join(
      this.worktreeRoot,
      sanitizePathSegment(this.delamainName),
      sanitizePathSegment(input.itemId),
      sanitizePathSegment(input.dispatchId),
    );

    const mountedSubmodules: MountedSubmoduleWorktree[] = [];

    try {
      await mkdir(dirname(worktreePath), { recursive: true });
      await runGit(this.systemRoot, ["worktree", "add", "-b", branchName, worktreePath, baseCommit]);

      for (const repoPath of this.submodules) {
        mountedSubmodules.push(
          await this.mountSubmoduleWorktree({
            repoPath,
            worktreePath,
            branchName,
          }),
        );
      }
    } catch (error) {
      await this.cleanupDispatch({
        worktreePath,
        branchName,
        mountedSubmodules,
      }).catch(() => undefined);
      throw error;
    }

    return {
      dispatchId: input.dispatchId,
      itemId: input.itemId,
      baseCommit,
      branchName,
      baseBranch,
      itemFile: input.itemFile,
      isolatedItemFile: this.rewritePath(input.itemFile, worktreePath),
      worktreePath,
      mountedSubmodules,
    };
  }

  rewritePath(mainPath: string, worktreePath: string): string {
    const relativePath = relative(this.systemRoot, resolve(mainPath));
    if (relativePath.startsWith("..") || relativePath === "") {
      throw new Error(
        `Cannot rewrite '${mainPath}' into worktree '${worktreePath}' because it is outside '${this.systemRoot}'`,
      );
    }

    return join(worktreePath, relativePath);
  }

  async inspectWorktree(input: {
    worktreePath: string | null;
    baseCommit: string | null;
    mountedSubmodules?: Array<{
      repo_path: string;
      worktree_path: string | null;
      base_commit: string | null;
    }>;
  }): Promise<WorktreeInspection> {
    const hostInspection = await inspectRepoWorkspace(input.worktreePath, input.baseCommit);
    const mountedSubmodules = await Promise.all(
      (input.mountedSubmodules ?? []).map(async (entry) => {
        const inspection = await inspectRepoWorkspace(entry.worktree_path, entry.base_commit);
        return {
          repoPath: entry.repo_path,
          ...inspection,
          worktreePath: entry.worktree_path,
        } satisfies MountedWorktreeInspection;
      }),
    );

    const dirty = hostInspection.dirty || mountedSubmodules.some((entry) => entry.dirty);
    const exists = hostInspection.exists || mountedSubmodules.some((entry) => entry.exists);
    const pristine = exists
      ? hostInspection.pristine && mountedSubmodules.every((entry) => entry.pristine)
      : true;

    return {
      exists,
      pristine,
      dirty,
      headCommit: hostInspection.headCommit,
      mountedSubmodules,
    };
  }

  async commitDispatch(
    worktreePath: string,
    baseCommit: string,
    message: string,
  ): Promise<string | null> {
    const [status, headCommit] = await Promise.all([
      runGit(worktreePath, ["status", "--porcelain"]),
      gitHeadCommit(worktreePath),
    ]);
    if (status.length === 0 && headCommit === baseCommit) {
      return null;
    }

    if (headCommit !== baseCommit) {
      // Squash any agent-authored branch history back onto the dispatch base so a
      // single audit commit carries the full isolated snapshot into integration.
      await runGit(worktreePath, ["reset", "--soft", baseCommit]);
    }

    await runGit(worktreePath, ["add", "-A"]);
    const staged = await runGit(worktreePath, ["status", "--porcelain"]);
    if (staged.length === 0) {
      return null;
    }
    await runGit(
      worktreePath,
      [
        "-c",
        "user.name=Delamain Dispatcher",
        "-c",
        "user.email=delamain@local",
        "commit",
        "--no-gpg-sign",
        "-m",
        message,
      ],
    );

    return gitHeadCommit(worktreePath);
  }

  async mergeBack(input: {
    prepared: Pick<IsolatedDispatch, "worktreePath" | "baseCommit" | "mountedSubmodules">;
    hostCommitMessage: string;
    mountedSubmoduleCommits: MountedSubmoduleCommit[];
  }): Promise<MergeBackResult> {
    const dirtyRepo = await this.findDirtyIntegrationRepo(input.prepared.mountedSubmodules);
    if (dirtyRepo) {
      return {
        status: "blocked",
        worktreeCommit: null,
        integratedCommit: null,
        mountedSubmodules: input.prepared.mountedSubmodules.map((entry) => ({
          repoPath: entry.repoPath,
          worktreeCommit: null,
          integratedCommit: null,
        })),
        error: `Integration checkout is dirty: ${dirtyRepo}`,
        incidentKind: "dirty_integration_checkout",
      };
    }

    const mountedByPath = new Map(
      input.prepared.mountedSubmodules.map((entry) => [entry.repoPath, entry] as const),
    );
    const integratedSubmodules: IntegratedSubmoduleCommit[] = [];
    const detachedWorktrees: IntegratedSubmoduleCommit[] = [];

    try {
      for (const submoduleCommit of input.mountedSubmoduleCommits) {
        const mounted = mountedByPath.get(submoduleCommit.repoPath);
        if (!mounted) {
          return {
            status: "blocked",
            worktreeCommit: null,
            integratedCommit: null,
            mountedSubmodules: input.prepared.mountedSubmodules.map((entry) => ({
              repoPath: entry.repoPath,
              worktreeCommit: entry.repoPath === submoduleCommit.repoPath ? submoduleCommit.worktreeCommit : null,
              integratedCommit: null,
            })),
            error: `Mounted submodule metadata missing for '${submoduleCommit.repoPath}'`,
            incidentKind: "merge_back_failed",
          };
        }

        const preIntegrationHead = await gitHeadCommit(mounted.primaryRepoPath);
        const cherryPick = await runCommand(
          ["git", "cherry-pick", submoduleCommit.worktreeCommit],
          { cwd: mounted.primaryRepoPath },
        );
        if (cherryPick.exitCode !== 0) {
          await this.abortCherryPick(mounted.primaryRepoPath);
          await this.rollbackIntegratedRepos(integratedSubmodules);
          return {
            status: "blocked",
            worktreeCommit: null,
            integratedCommit: null,
            mountedSubmodules: buildBlockedMountedSubmoduleResults(
              input.prepared.mountedSubmodules,
              input.mountedSubmoduleCommits,
            ),
            error: formatRepoScopedError(
              mounted.repoPath,
              cherryPick.stderr.trim() || cherryPick.stdout.trim() || "Cherry-pick failed",
              submoduleCommit.worktreeCommit,
            ),
            incidentKind: "merge_conflict",
          };
        }

        integratedSubmodules.push({
          repoPath: mounted.repoPath,
          primaryRepoPath: mounted.primaryRepoPath,
          worktreePath: mounted.worktreePath,
          branchName: mounted.branchName,
          worktreeCommit: submoduleCommit.worktreeCommit,
          integratedCommit: await gitHeadCommit(mounted.primaryRepoPath),
          preIntegrationHead,
        });
      }

      for (const submodule of integratedSubmodules) {
        await runGit(submodule.worktreePath, ["checkout", "--detach", submodule.integratedCommit]);
        detachedWorktrees.push(submodule);
      }

      const hostWorktreeCommit = await this.commitDispatch(
        input.prepared.worktreePath,
        input.prepared.baseCommit,
        input.hostCommitMessage,
      );

      if (!hostWorktreeCommit) {
        return {
          status: "merged",
          worktreeCommit: null,
          integratedCommit: null,
          mountedSubmodules: integratedSubmodules.map((entry) => ({
            repoPath: entry.repoPath,
            worktreeCommit: entry.worktreeCommit,
            integratedCommit: entry.integratedCommit,
          })),
          error: null,
          incidentKind: null,
        };
      }

      const hostCherryPick = await runCommand(
        ["git", "cherry-pick", hostWorktreeCommit],
        { cwd: this.systemRoot },
      );
      if (hostCherryPick.exitCode !== 0) {
        await this.abortCherryPick(this.systemRoot);
        await this.restoreDetachedMountedWorktrees(detachedWorktrees);
        await this.rollbackIntegratedRepos(integratedSubmodules);
        return {
          status: "blocked",
          worktreeCommit: hostWorktreeCommit,
          integratedCommit: null,
          mountedSubmodules: integratedSubmodules.map((entry) => ({
            repoPath: entry.repoPath,
            worktreeCommit: entry.worktreeCommit,
            integratedCommit: null,
          })),
          error: formatRepoScopedError(
            ".",
            hostCherryPick.stderr.trim() || hostCherryPick.stdout.trim() || "Cherry-pick failed",
            hostWorktreeCommit,
          ),
          incidentKind: "merge_conflict",
        };
      }

      return {
        status: "merged",
        worktreeCommit: hostWorktreeCommit,
        integratedCommit: await gitHeadCommit(this.systemRoot),
        mountedSubmodules: integratedSubmodules.map((entry) => ({
          repoPath: entry.repoPath,
          worktreeCommit: entry.worktreeCommit,
          integratedCommit: entry.integratedCommit,
        })),
        error: null,
        incidentKind: null,
      };
    } catch (error) {
      await this.abortCherryPick(this.systemRoot);
      await this.restoreDetachedMountedWorktrees(detachedWorktrees);
      await this.rollbackIntegratedRepos(integratedSubmodules);
      return {
        status: "blocked",
        worktreeCommit: null,
        integratedCommit: null,
        mountedSubmodules: buildBlockedMountedSubmoduleResults(
          input.prepared.mountedSubmodules,
          input.mountedSubmoduleCommits,
        ),
        error: error instanceof Error ? error.message : String(error),
        incidentKind: "merge_back_failed",
      };
    }
  }

  async cleanupDispatch(input: {
    worktreePath: string | null;
    branchName: string | null;
    mountedSubmodules?: Array<{
      repo_path?: string | null;
      primary_repo_path?: string | null;
      worktree_path: string | null;
      branch_name: string | null;
    } | MountedSubmoduleWorktree>;
  }): Promise<void> {
    for (const entry of input.mountedSubmodules ?? []) {
      const worktreePath = "worktreePath" in entry ? entry.worktreePath : entry.worktree_path;
      const branchName = "branchName" in entry ? entry.branchName : entry.branch_name;
      const repoPath = "repoPath" in entry ? entry.repoPath : entry.repo_path;
      const primaryRepoPath = "primaryRepoPath" in entry
        ? entry.primaryRepoPath
        : entry.primary_repo_path ?? (repoPath ? resolve(this.systemRoot, repoPath) : null);
      if (!primaryRepoPath) continue;

      if (worktreePath && existsSync(worktreePath)) {
        await runGit(primaryRepoPath, ["worktree", "remove", "--force", worktreePath]);
      }

      if (worktreePath || branchName) {
        await runGit(primaryRepoPath, ["worktree", "prune"]);
      }

      if (branchName) {
        const result = await runCommand(
          ["git", "branch", "-D", branchName],
          { cwd: primaryRepoPath },
        );
        if (result.exitCode !== 0 && !result.stderr.includes("not found")) {
          throw new Error(result.stderr.trim() || result.stdout.trim() || "branch delete failed");
        }
      }
    }

    if (input.worktreePath && existsSync(input.worktreePath)) {
      await runGit(this.systemRoot, ["worktree", "remove", "--force", input.worktreePath]);
    }

    if (input.worktreePath || input.branchName) {
      await runGit(this.systemRoot, ["worktree", "prune"]);
    }

    if (input.branchName) {
      const result = await runCommand(
        ["git", "branch", "-D", input.branchName],
        { cwd: this.systemRoot },
      );
      if (result.exitCode !== 0 && !result.stderr.includes("not found")) {
        throw new Error(result.stderr.trim() || result.stdout.trim() || "branch delete failed");
      }
    }
  }

  private async mountSubmoduleWorktree(input: {
    repoPath: string;
    worktreePath: string;
    branchName: string;
  }): Promise<MountedSubmoduleWorktree> {
    const repoPath = normalizeRepoPath(input.repoPath);
    const primaryRepoPath = resolve(this.systemRoot, repoPath);
    const baseCommit = await gitHeadCommit(primaryRepoPath);
    const mountPath = join(input.worktreePath, repoPath);
    await mkdir(dirname(mountPath), { recursive: true });
    await rm(mountPath, { recursive: true, force: true });
    await runGit(primaryRepoPath, ["worktree", "add", "-b", input.branchName, mountPath, baseCommit]);

    return {
      repoPath,
      primaryRepoPath,
      worktreePath: mountPath,
      branchName: input.branchName,
      baseCommit,
    };
  }

  private async findDirtyIntegrationRepo(
    mountedSubmodules: ReadonlyArray<MountedSubmoduleWorktree>,
  ): Promise<string | null> {
    if (!(await gitIsClean(this.systemRoot))) {
      return ".";
    }

    for (const entry of mountedSubmodules) {
      if (!(await gitIsClean(entry.primaryRepoPath))) {
        return entry.repoPath;
      }
    }

    return null;
  }

  private async rollbackIntegratedRepos(
    integratedSubmodules: ReadonlyArray<IntegratedSubmoduleCommit>,
  ): Promise<void> {
    for (const entry of [...integratedSubmodules].reverse()) {
      try {
        await runGit(entry.primaryRepoPath, ["reset", "--hard", entry.preIntegrationHead]);
      } catch (error) {
        console.warn(
          `[dispatcher] rollback failed for '${entry.repoPath}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async restoreDetachedMountedWorktrees(
    integratedSubmodules: ReadonlyArray<IntegratedSubmoduleCommit>,
  ): Promise<void> {
    for (const entry of [...integratedSubmodules].reverse()) {
      try {
        await runGit(entry.worktreePath, ["checkout", entry.branchName]);
      } catch (error) {
        console.warn(
          `[dispatcher] mounted worktree restore failed for '${entry.repoPath}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async abortCherryPick(cwd: string): Promise<void> {
    const result = await runCommand(
      ["git", "cherry-pick", "--abort"],
      { cwd },
    );
    if (result.exitCode !== 0 && !result.stderr.includes("no cherry-pick")) {
      console.warn(
        `[dispatcher] cherry-pick abort failed in '${cwd}': ${result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`}`,
      );
    }
  }
}

async function inspectRepoWorkspace(
  worktreePath: string | null,
  baseCommit: string | null,
): Promise<{
  exists: boolean;
  pristine: boolean;
  dirty: boolean;
  headCommit: string | null;
}> {
  if (!worktreePath || !existsSync(worktreePath)) {
    return {
      exists: false,
      pristine: true,
      dirty: false,
      headCommit: null,
    };
  }

  const headCommit = await gitHeadCommit(worktreePath);
  const dirty = baseCommit
    ? await gitHasChanges(worktreePath, baseCommit)
    : true;

  return {
    exists: true,
    pristine: !dirty && baseCommit === headCommit,
    dirty,
    headCommit,
  };
}

function buildBlockedMountedSubmoduleResults(
  mountedSubmodules: ReadonlyArray<MountedSubmoduleWorktree>,
  mountedSubmoduleCommits: ReadonlyArray<MountedSubmoduleCommit>,
): Array<{ repoPath: string; worktreeCommit: string | null; integratedCommit: null }> {
  const commitsByRepo = new Map(mountedSubmoduleCommits.map((entry) => [entry.repoPath, entry.worktreeCommit]));
  return mountedSubmodules.map((entry) => ({
    repoPath: entry.repoPath,
    worktreeCommit: commitsByRepo.get(entry.repoPath) ?? null,
    integratedCommit: null,
  }));
}

function formatRepoScopedError(repoPath: string, message: string, commit: string): string {
  const scope = repoPath === "." ? "host repo" : `repo '${repoPath}'`;
  return `${scope} cherry-pick ${commit} failed: ${message}`;
}

function buildWorktreeBranchName(
  delamainName: string,
  itemId: string,
  dispatchId: string,
): string {
  return [
    "delamain",
    sanitizePathSegment(delamainName),
    sanitizePathSegment(itemId),
    sanitizePathSegment(dispatchId),
  ].join("/");
}

function normalizeRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "");
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}
