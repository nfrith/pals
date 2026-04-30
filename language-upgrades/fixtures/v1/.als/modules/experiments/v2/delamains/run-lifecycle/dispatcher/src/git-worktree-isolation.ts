import { existsSync } from "fs";
import { mkdir, rm } from "fs/promises";
import { homedir } from "os";
import { dirname, join, relative, resolve } from "path";
import {
  gitAbortRebase,
  gitCurrentBranch,
  gitHasChanges,
  gitHeadCommit,
  gitIsAncestor,
  gitIsClean,
  gitIsCleanIgnoreSubmodules,
  gitMergeFastForward,
  gitRebase,
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
  mountedSubmodules: MountedSubmoduleMergeState[];
  error: string | null;
  incidentKind: string | null;
}

export interface RefreshMergeBackResult {
  status: "ready" | "blocked";
  hostWorktreeCommit: string | null;
  mountedSubmodules: MountedSubmoduleMergeState[];
  error: string | null;
  incidentKind: string | null;
}

interface MountedSubmoduleMergeState {
  repoPath: string;
  worktreeCommit: string | null;
  integratedCommit: string | null;
}

interface IntegratedSubmoduleCommit extends MountedSubmoduleMergeState {
  primaryRepoPath: string;
  worktreePath: string;
  branchName: string;
  worktreeCommit: string;
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

  async refreshMergeBack(input: {
    prepared: Pick<IsolatedDispatch, "worktreePath" | "baseCommit" | "mountedSubmodules">;
    hostWorktreeCommit: string | null;
    mountedSubmodules: MountedSubmoduleMergeState[];
  }): Promise<RefreshMergeBackResult> {
    const dirtyRepo = await this.findDirtyIntegrationRepo(input.prepared.mountedSubmodules);
    if (dirtyRepo) {
      return {
        status: "blocked",
        hostWorktreeCommit: input.hostWorktreeCommit,
        mountedSubmodules: buildMountedSubmoduleResults(
          input.prepared.mountedSubmodules,
          input.mountedSubmodules,
        ),
        error: `Integration checkout is dirty: ${dirtyRepo}`,
        incidentKind: "dirty_integration_checkout",
      };
    }

    const mountedSubmodules = buildMountedSubmoduleResults(
      input.prepared.mountedSubmodules,
      input.mountedSubmodules,
    );
    const mountedByPath = new Map(mountedSubmodules.map((entry) => [entry.repoPath, entry] as const));

    try {
      for (const mounted of input.prepared.mountedSubmodules) {
        const currentHead = await gitHeadCommit(mounted.primaryRepoPath);
        const current = mountedByPath.get(mounted.repoPath) ?? {
          repoPath: mounted.repoPath,
          worktreeCommit: null,
          integratedCommit: null,
        };
        const refresh = await this.refreshWorktreeBase({
          repoPath: mounted.repoPath,
          worktreePath: mounted.worktreePath,
          baseCommit: mounted.baseCommit,
          currentHead,
          worktreeCommit: current.worktreeCommit,
        });

        mounted.baseCommit = refresh.baseCommit;
        current.worktreeCommit = refresh.worktreeCommit;
        current.integratedCommit = null;

        if (refresh.status !== "ready") {
          return {
            status: "blocked",
            hostWorktreeCommit: input.hostWorktreeCommit,
            mountedSubmodules,
            error: refresh.error,
            incidentKind: refresh.incidentKind,
          };
        }
      }

      const hostCurrentHead = await gitHeadCommit(this.systemRoot);
      const hostRefresh = await this.refreshWorktreeBase({
        repoPath: ".",
        worktreePath: input.prepared.worktreePath,
        baseCommit: input.prepared.baseCommit,
        currentHead: hostCurrentHead,
        worktreeCommit: input.hostWorktreeCommit,
      });
      input.prepared.baseCommit = hostRefresh.baseCommit;

      if (hostRefresh.status !== "ready") {
        return {
          status: "blocked",
          hostWorktreeCommit: hostRefresh.worktreeCommit,
          mountedSubmodules,
          error: hostRefresh.error,
          incidentKind: hostRefresh.incidentKind,
        };
      }

      return {
        status: "ready",
        hostWorktreeCommit: hostRefresh.worktreeCommit,
        mountedSubmodules,
        error: null,
        incidentKind: null,
      };
    } catch (error) {
      await this.abortRefreshRebases(input.prepared).catch(() => undefined);
      return {
        status: "blocked",
        hostWorktreeCommit: input.hostWorktreeCommit,
        mountedSubmodules,
        error: error instanceof Error ? error.message : String(error),
        incidentKind: "merge_back_failed",
      };
    }
  }

  async mergeBack(input: {
    prepared: Pick<IsolatedDispatch, "worktreePath" | "baseCommit" | "mountedSubmodules">;
    hostCommitMessage: string;
    mountedSubmodules: MountedSubmoduleMergeState[];
  }): Promise<MergeBackResult> {
    const dirtyRepo = await this.findDirtyIntegrationRepo(input.prepared.mountedSubmodules);
    if (dirtyRepo) {
      return {
        status: "blocked",
        worktreeCommit: await gitHeadCommit(input.prepared.worktreePath).catch(() => null),
        integratedCommit: null,
        mountedSubmodules: buildMountedSubmoduleResults(
          input.prepared.mountedSubmodules,
          input.mountedSubmodules,
        ),
        error: `Integration checkout is dirty: ${dirtyRepo}`,
        incidentKind: "dirty_integration_checkout",
      };
    }

    const mountedByPath = new Map(
      input.prepared.mountedSubmodules.map((entry) => [entry.repoPath, entry] as const),
    );
    const integratedSubmodules: IntegratedSubmoduleCommit[] = [];
    const detachedWorktrees: IntegratedSubmoduleCommit[] = [];
    let hostPreIntegrationHead: string | null = null;
    let hostIntegrated = false;

    try {
      for (const submoduleState of input.mountedSubmodules) {
        if (!submoduleState.worktreeCommit) continue;

        const mounted = mountedByPath.get(submoduleState.repoPath);
        if (!mounted) {
          return {
            status: "blocked",
            worktreeCommit: await gitHeadCommit(input.prepared.worktreePath).catch(() => null),
            integratedCommit: null,
            mountedSubmodules: buildMountedSubmoduleResults(
              input.prepared.mountedSubmodules,
              input.mountedSubmodules,
            ),
            error: `Mounted submodule metadata missing for '${submoduleState.repoPath}'`,
            incidentKind: "merge_back_failed",
          };
        }

        const preIntegrationHead = await gitHeadCommit(mounted.primaryRepoPath);
        const merge = await gitMergeFastForward(mounted.primaryRepoPath, submoduleState.worktreeCommit);
        if (merge.exitCode !== 0) {
          await this.rollbackIntegratedRepos(integratedSubmodules);
          return {
            status: "blocked",
            worktreeCommit: await gitHeadCommit(input.prepared.worktreePath).catch(() => null),
            integratedCommit: null,
            mountedSubmodules: buildMountedSubmoduleResults(
              input.prepared.mountedSubmodules,
              input.mountedSubmodules,
            ),
            error: formatRepoScopedIntegrationError(
              mounted.repoPath,
              merge.stderr.trim() || merge.stdout.trim() || "Fast-forward merge failed",
              submoduleState.worktreeCommit,
            ),
            incidentKind: "merge_conflict",
          };
        }

        const integratedCommit = await gitHeadCommit(mounted.primaryRepoPath);
        const integrated = {
          repoPath: mounted.repoPath,
          primaryRepoPath: mounted.primaryRepoPath,
          worktreePath: mounted.worktreePath,
          branchName: mounted.branchName,
          worktreeCommit: submoduleState.worktreeCommit,
          integratedCommit,
          preIntegrationHead,
        } satisfies IntegratedSubmoduleCommit;
        integratedSubmodules.push(integrated);
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

      hostPreIntegrationHead = await gitHeadCommit(this.systemRoot);
      const hostMerge = await gitMergeFastForward(this.systemRoot, hostWorktreeCommit);
      if (hostMerge.exitCode !== 0) {
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
          error: formatRepoScopedIntegrationError(
            ".",
            hostMerge.stderr.trim() || hostMerge.stdout.trim() || "Fast-forward merge failed",
            hostWorktreeCommit,
          ),
          incidentKind: "merge_conflict",
        };
      }
      hostIntegrated = true;

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
      await this.restoreDetachedMountedWorktrees(detachedWorktrees);
      await this.rollbackIntegratedRepos(integratedSubmodules);
      if (hostIntegrated && hostPreIntegrationHead) {
        await this.rollbackHostIntegration(hostPreIntegrationHead);
      }
      return {
        status: "blocked",
        worktreeCommit: null,
        integratedCommit: null,
        mountedSubmodules: buildMountedSubmoduleResults(
          input.prepared.mountedSubmodules,
          input.mountedSubmodules,
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
    if (!(await gitIsCleanIgnoreSubmodules(this.systemRoot))) {
      return ".";
    }

    for (const entry of mountedSubmodules) {
      if (!(await gitIsClean(entry.primaryRepoPath))) {
        return entry.repoPath;
      }
    }

    return null;
  }

  private async refreshWorktreeBase(input: {
    repoPath: string;
    worktreePath: string;
    baseCommit: string;
    currentHead: string;
    worktreeCommit: string | null;
  }): Promise<{
    status: "ready" | "blocked";
    baseCommit: string;
    worktreeCommit: string | null;
    error: string | null;
    incidentKind: string | null;
  }> {
    if (input.currentHead === input.baseCommit) {
      return {
        status: "ready",
        baseCommit: input.currentHead,
        worktreeCommit: input.worktreeCommit,
        error: null,
        incidentKind: null,
      };
    }

    const baseStillReachable = await gitIsAncestor(
      input.worktreePath,
      input.baseCommit,
      input.currentHead,
    );
    if (!baseStillReachable) {
      return {
        status: "blocked",
        baseCommit: input.currentHead,
        worktreeCommit: input.worktreeCommit,
        error: formatRepoScopedRefreshError(
          input.repoPath,
          `recorded base ${input.baseCommit} is not an ancestor of current HEAD ${input.currentHead}`,
        ),
        incidentKind: "stale_base_conflict",
      };
    }

    if (!input.worktreeCommit) {
      await runGit(input.worktreePath, ["reset", "--hard", input.currentHead]);
      return {
        status: "ready",
        baseCommit: input.currentHead,
        worktreeCommit: null,
        error: null,
        incidentKind: null,
      };
    }

    const rebase = await gitRebase(input.worktreePath, input.currentHead);
    if (rebase.exitCode !== 0) {
      return {
        status: "blocked",
        baseCommit: input.currentHead,
        worktreeCommit: input.worktreeCommit,
        error: formatRepoScopedRefreshError(
          input.repoPath,
          rebase.stderr.trim() || rebase.stdout.trim() || `rebase onto ${input.currentHead} failed`,
        ),
        incidentKind: "stale_base_conflict",
      };
    }

    return {
      status: "ready",
      baseCommit: input.currentHead,
      worktreeCommit: await gitHeadCommit(input.worktreePath),
      error: null,
      incidentKind: null,
    };
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

  private async rollbackHostIntegration(preIntegrationHead: string): Promise<void> {
    try {
      await runGit(this.systemRoot, ["reset", "--hard", preIntegrationHead]);
    } catch (error) {
      console.warn(
        `[dispatcher] host rollback failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async abortRefreshRebases(
    prepared: Pick<IsolatedDispatch, "worktreePath" | "mountedSubmodules">,
  ): Promise<void> {
    const worktrees = [
      prepared.worktreePath,
      ...prepared.mountedSubmodules.map((entry) => entry.worktreePath),
    ];

    for (const worktreePath of worktrees) {
      try {
        await gitAbortRebase(worktreePath);
      } catch (error) {
        console.warn(
          `[dispatcher] rebase abort failed in '${worktreePath}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
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

function buildMountedSubmoduleResults(
  mountedSubmodules: ReadonlyArray<MountedSubmoduleWorktree>,
  updates: ReadonlyArray<MountedSubmoduleMergeState>,
): MountedSubmoduleMergeState[] {
  const updatesByRepo = new Map(updates.map((entry) => [entry.repoPath, entry]));
  return mountedSubmodules.map((entry) => {
    const update = updatesByRepo.get(entry.repoPath);
    return {
      repoPath: entry.repoPath,
      worktreeCommit: update?.worktreeCommit ?? null,
      integratedCommit: update?.integratedCommit ?? null,
    } satisfies MountedSubmoduleMergeState;
  });
}

function formatRepoScopedRefreshError(repoPath: string, message: string): string {
  const scope = repoPath === "." ? "host repo" : `repo '${repoPath}'`;
  return `${scope} stale-base refresh failed: ${message}`;
}

function formatRepoScopedIntegrationError(repoPath: string, message: string, commit: string): string {
  const scope = repoPath === "." ? "host repo" : `repo '${repoPath}'`;
  return `${scope} fast-forward merge ${commit} failed: ${message}`;
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
