import { existsSync } from "fs";
import { mkdir, rm } from "fs/promises";
import { homedir } from "os";
import { dirname, join, relative, resolve } from "path";
import {
  buildCommandResult,
  sanitizeJsonObject,
  type DispatchPhaseTelemetry,
} from "./forensics.js";
import {
  gitAbortCherryPick,
  gitAbortMerge,
  gitAbortRebase,
  gitChangedFilesBetween,
  gitCherryPickNoCommit,
  gitCurrentBranch,
  gitFetchRef,
  gitHasChanges,
  gitHeadCommit,
  gitIsAncestor,
  gitIsClean,
  gitIsCleanIgnoreSubmodules,
  gitMerge,
  gitMergeFastForward,
  gitPush,
  gitRebase,
  gitRemoteRefCommit,
  gitRevParse,
  gitResolveCanonicalRefTarget,
  runCommand,
  runGit,
} from "./git.js";
import { convergePrimaryClone } from "./primary-clone-convergence.js";

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
  retryCount: number;
  telemetry: DispatchPhaseTelemetry[];
}

export interface RefreshMergeBackResult {
  status: "ready" | "blocked";
  hostWorktreeCommit: string | null;
  mountedSubmodules: MountedSubmoduleMergeState[];
  error: string | null;
  incidentKind: string | null;
  telemetry: DispatchPhaseTelemetry[];
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
  baseCommit: string;
  worktreeCommit: string;
  integratedCommit: string;
  preIntegrationHead: string;
}

interface ReconciledMountedSubmodule {
  mounted: MountedSubmoduleWorktree;
  preMergeHead: string;
}

const INCIDENT_TRACKED_PATH_CONFLICT = "tracked_path_conflict";
const INCIDENT_SUBMODULE_CONCURRENT_ADVANCE = "submodule_concurrent_advance";
const INCIDENT_MERGE_BACK_PUBLISH_FAILED = "merge_back_publish_failed";
const INCIDENT_CANONICAL_UPSTREAM_UNSYNCED = "canonical_upstream_unsynced";
const INCIDENT_SUBMODULE_POINTER_INVARIANT_VIOLATION = "submodule_pointer_invariant_violation";
const MAX_PUBLISH_REPLAY_ATTEMPTS = 3;

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
    commitMessage: string;
  }): Promise<RefreshMergeBackResult> {
    const telemetry: DispatchPhaseTelemetry[] = [];
    const dirtyRepo = await this.findDirtyIntegrationRepo(input.prepared.mountedSubmodules);
    if (dirtyRepo) {
      telemetry.push({
        event_type: "dirty_check",
        phase: "dirty_check",
        cause: "dirty_integration_checkout",
        retryable: true,
        recommended_next_actor: "operator",
        command_label: "git.status.integration",
        error: `Integration checkout is dirty: ${dirtyRepo}`,
        attributes: sanitizeJsonObject({
          dirty_repo: dirtyRepo,
        }),
      });
      return {
        status: "blocked",
        hostWorktreeCommit: input.hostWorktreeCommit,
        mountedSubmodules: buildMountedSubmoduleResults(
          input.prepared.mountedSubmodules,
          input.mountedSubmodules,
        ),
        error: `Integration checkout is dirty: ${dirtyRepo}`,
        incidentKind: "dirty_integration_checkout",
        telemetry,
      };
    }

    telemetry.push({
      event_type: "dirty_check",
      phase: "dirty_check",
      cause: null,
      retryable: false,
      recommended_next_actor: "none",
      command_label: "git.status.integration",
      attributes: sanitizeJsonObject({
        dirty_repo: null,
      }),
    });

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
          commitMessage: input.commitMessage,
        });
        telemetry.push(...refresh.telemetry);

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
            telemetry,
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
        commitMessage: input.commitMessage,
        mountedSubmodules: input.prepared.mountedSubmodules,
      });
      telemetry.push(...hostRefresh.telemetry);
      input.prepared.baseCommit = hostRefresh.baseCommit;

      if (hostRefresh.status !== "ready") {
        return {
          status: "blocked",
          hostWorktreeCommit: hostRefresh.worktreeCommit,
          mountedSubmodules,
          error: hostRefresh.error,
          incidentKind: hostRefresh.incidentKind,
          telemetry,
        };
      }

      return {
        status: "ready",
        hostWorktreeCommit: hostRefresh.worktreeCommit,
        mountedSubmodules,
        error: null,
        incidentKind: null,
        telemetry,
      };
    } catch (error) {
      await this.abortRefreshMerges(input.prepared).catch(() => undefined);
      telemetry.push({
        event_type: "refresh_decision",
        phase: "merge_back",
        cause: "merge_back_failed",
        retryable: false,
        recommended_next_actor: "operator",
        command_label: null,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        status: "blocked",
        hostWorktreeCommit: input.hostWorktreeCommit,
        mountedSubmodules,
        error: error instanceof Error ? error.message : String(error),
        incidentKind: "merge_back_failed",
        telemetry,
      };
    }
  }

  async mergeBack(input: {
    prepared: Pick<IsolatedDispatch, "worktreePath" | "baseCommit" | "mountedSubmodules">;
    hostCommitMessage: string;
    hostWorktreeCommit: string | null;
    mountedSubmodules: MountedSubmoduleMergeState[];
  }): Promise<MergeBackResult> {
    const telemetry: DispatchPhaseTelemetry[] = [];
    const dirtyRepo = await this.findDirtyIntegrationRepo(input.prepared.mountedSubmodules);
    if (dirtyRepo) {
      telemetry.push({
        event_type: "dirty_check",
        phase: "dirty_check",
        cause: "dirty_integration_checkout",
        retryable: true,
        recommended_next_actor: "operator",
        command_label: "git.status.integration",
        error: `Integration checkout is dirty: ${dirtyRepo}`,
        attributes: sanitizeJsonObject({ dirty_repo: dirtyRepo }),
      });
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
        retryCount: 0,
        telemetry,
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
          telemetry.push({
            event_type: "integration_attempt",
            phase: "integration",
            cause: "merge_back_failed",
            retryable: false,
            recommended_next_actor: "operator",
            command_label: null,
            error: `Mounted submodule metadata missing for '${submoduleState.repoPath}'`,
            attributes: sanitizeJsonObject({ repo_path: submoduleState.repoPath }),
          });
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
            retryCount: 0,
            telemetry,
          };
        }

        const preIntegrationHead = await gitHeadCommit(mounted.primaryRepoPath);
        const merge = await gitMergeFastForward(mounted.primaryRepoPath, submoduleState.worktreeCommit);
        telemetry.push({
          event_type: "integration_attempt",
          phase: "integration",
          cause: merge.exitCode === 0 ? null : "submodule_concurrent_advance",
          retryable: false,
          recommended_next_actor: merge.exitCode === 0 ? "none" : "operator",
          command_label: "git.merge.integration",
          command_result: buildCommandResult({
            exitCode: merge.exitCode,
            stdout: merge.stdout,
            stderr: merge.stderr,
            rawCommand: `git merge --ff-only ${submoduleState.worktreeCommit}`,
          }),
          relevant_shas: {
            base_commit: mounted.baseCommit,
            current_head: preIntegrationHead,
            worktree_commit: submoduleState.worktreeCommit,
          },
          attributes: sanitizeJsonObject({
            repo_path: mounted.repoPath,
            repo_role: "mounted_submodule",
          }),
        });
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
            incidentKind: INCIDENT_SUBMODULE_CONCURRENT_ADVANCE,
            retryCount: 0,
            telemetry,
          };
        }

        const integratedCommit = await gitHeadCommit(mounted.primaryRepoPath);
        const integrated = {
          repoPath: mounted.repoPath,
          primaryRepoPath: mounted.primaryRepoPath,
          worktreePath: mounted.worktreePath,
          branchName: mounted.branchName,
          baseCommit: mounted.baseCommit,
          worktreeCommit: submoduleState.worktreeCommit,
          integratedCommit,
          preIntegrationHead,
        } satisfies IntegratedSubmoduleCommit;
        integratedSubmodules.push(integrated);
      }

      let hostWorktreeCommit = input.hostWorktreeCommit;
      for (const submodule of integratedSubmodules) {
        const dispatchTouchedPaths = await gitChangedFilesBetween(
          submodule.worktreePath,
          submodule.baseCommit,
          submodule.worktreeCommit,
        );
        const publishResult = await this.publishCanonicalCommit({
          repoPath: submodule.repoPath,
          repoRoot: submodule.primaryRepoPath,
          commit: submodule.integratedCommit,
          baseCommit: submodule.baseCommit,
          dispatchTouchedPaths,
        });
        telemetry.push(...publishResult.telemetry);
        if (publishResult.status === "blocked") {
          await this.rollbackMergeTransaction({
            detachedWorktrees,
            integratedSubmodules,
            hostIntegrated,
            hostPreIntegrationHead,
          });
          telemetry.push({
            event_type: "rollback",
            phase: "rollback",
            cause: publishResult.incidentKind,
            retryable: false,
            recommended_next_actor: "operator",
            command_label: null,
            error: publishResult.error,
            attributes: sanitizeJsonObject({
              repo_path: submodule.repoPath,
              repo_role: "mounted_submodule",
            }),
          });
          return {
            status: "blocked",
            worktreeCommit: hostWorktreeCommit,
            integratedCommit: null,
            mountedSubmodules: integratedSubmodules.map((entry) => ({
              repoPath: entry.repoPath,
              worktreeCommit: entry.worktreeCommit,
              integratedCommit: null,
            })),
            error: publishResult.error,
            incidentKind: publishResult.incidentKind,
            retryCount: publishResult.retryCount,
            telemetry,
          };
        }

        submodule.integratedCommit = publishResult.publishedCommit;
        const submoduleConvergence = await this.runPrimaryCloneFollowThrough(
          submodule.repoPath,
          submodule.primaryRepoPath,
        );
        telemetry.push({
          event_type: "primary_convergence",
          phase: "primary_convergence",
          cause: submoduleConvergence.status === "converged" ? null : submoduleConvergence.status,
          retryable: false,
          recommended_next_actor: submoduleConvergence.status === "converged" ? "none" : "operator",
          command_label: "git.primary_convergence",
          error: submoduleConvergence.status === "converged" ? null : submoduleConvergence.message,
          attributes: sanitizeJsonObject({
            repo_path: submodule.repoPath,
            repo_role: "mounted_submodule",
            convergence_status: submoduleConvergence.status,
          }),
        });
        await runGit(submodule.worktreePath, ["checkout", "--detach", submodule.integratedCommit]);
        detachedWorktrees.push(submodule);
        await runGit(input.prepared.worktreePath, ["add", submodule.repoPath]);
      }

      if (
        !hostWorktreeCommit
        || !(await this.canReuseHostWorktreeCommit(input.prepared.worktreePath, hostWorktreeCommit))
      ) {
        hostWorktreeCommit = await this.commitDispatch(
          input.prepared.worktreePath,
          input.prepared.baseCommit,
          input.hostCommitMessage,
        );
      }

      if (!hostWorktreeCommit) {
        await this.rollbackMergeTransaction({
          detachedWorktrees,
          integratedSubmodules,
          hostIntegrated,
          hostPreIntegrationHead,
        });
        telemetry.push({
          event_type: "rollback",
          phase: "rollback",
          cause: "submodule_pointer_invariant_violation",
          retryable: false,
          recommended_next_actor: "operator",
          command_label: null,
          error: formatRepoScopedInvariantError(
            ".",
            "host worktree produced no final commit after mounted submodule publication",
          ),
        });
        return {
          status: "blocked",
          worktreeCommit: null,
          integratedCommit: null,
          mountedSubmodules: integratedSubmodules.map((entry) => ({
            repoPath: entry.repoPath,
            worktreeCommit: entry.worktreeCommit,
            integratedCommit: null,
          })),
          error: formatRepoScopedInvariantError(
            ".",
            "host worktree produced no final commit after mounted submodule publication",
          ),
          incidentKind: INCIDENT_SUBMODULE_POINTER_INVARIANT_VIOLATION,
          retryCount: 0,
          telemetry,
        };
      }

      hostPreIntegrationHead = await gitHeadCommit(this.systemRoot);
      const hostMerge = await gitMergeFastForward(this.systemRoot, hostWorktreeCommit);
      telemetry.push({
        event_type: "integration_attempt",
        phase: "integration",
        cause: hostMerge.exitCode === 0 ? null : "tracked_path_conflict",
        retryable: false,
        recommended_next_actor: hostMerge.exitCode === 0 ? "none" : "operator",
        command_label: "git.merge.integration",
        command_result: buildCommandResult({
          exitCode: hostMerge.exitCode,
          stdout: hostMerge.stdout,
          stderr: hostMerge.stderr,
          rawCommand: `git merge --ff-only ${hostWorktreeCommit}`,
        }),
        relevant_shas: {
          base_commit: input.prepared.baseCommit,
          current_head: hostPreIntegrationHead,
          worktree_commit: hostWorktreeCommit,
        },
        attributes: sanitizeJsonObject({
          repo_path: ".",
          repo_role: "host",
        }),
      });
      if (hostMerge.exitCode !== 0) {
        await this.restoreDetachedMountedWorktrees(detachedWorktrees);
        await this.rollbackIntegratedRepos(integratedSubmodules);
        telemetry.push({
          event_type: "rollback",
          phase: "rollback",
          cause: "tracked_path_conflict",
          retryable: false,
          recommended_next_actor: "operator",
          command_label: null,
          error: formatRepoScopedIntegrationError(
            ".",
            hostMerge.stderr.trim() || hostMerge.stdout.trim() || "Fast-forward merge failed",
            hostWorktreeCommit,
          ),
        });
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
          incidentKind: INCIDENT_TRACKED_PATH_CONFLICT,
          retryCount: 0,
          telemetry,
        };
      }
      hostIntegrated = true;

      const pointerVerification = await this.verifyIntegratedSubmodulePointers(integratedSubmodules);
      if (pointerVerification.status === "blocked") {
        await this.rollbackMergeTransaction({
          detachedWorktrees,
          integratedSubmodules,
          hostIntegrated,
          hostPreIntegrationHead,
        });
        telemetry.push({
          event_type: "rollback",
          phase: "rollback",
          cause: "submodule_pointer_invariant_violation",
          retryable: false,
          recommended_next_actor: "operator",
          command_label: "git.verify.submodule_pointer",
          error: pointerVerification.error,
        });
        return {
          status: "blocked",
          worktreeCommit: hostWorktreeCommit,
          integratedCommit: null,
          mountedSubmodules: integratedSubmodules.map((entry) => ({
            repoPath: entry.repoPath,
            worktreeCommit: entry.worktreeCommit,
            integratedCommit: null,
          })),
          error: pointerVerification.error,
          incidentKind: INCIDENT_SUBMODULE_POINTER_INVARIANT_VIOLATION,
          retryCount: 0,
          telemetry,
        };
      }

      let hostIntegratedCommit = await gitHeadCommit(this.systemRoot);
      const hostDispatchTouchedPaths = await this.listHostDispatchTouchedPaths({
        worktreePath: input.prepared.worktreePath,
        baseCommit: input.prepared.baseCommit,
        worktreeCommit: hostWorktreeCommit,
        mountedSubmodules: input.prepared.mountedSubmodules,
      });
      const hostPublishResult = await this.publishCanonicalCommit({
        repoPath: ".",
        repoRoot: this.systemRoot,
        commit: hostIntegratedCommit,
        baseCommit: input.prepared.baseCommit,
        dispatchTouchedPaths: hostDispatchTouchedPaths,
      });
      telemetry.push(...hostPublishResult.telemetry);
      if (hostPublishResult.status === "blocked") {
        await this.rollbackMergeTransaction({
          detachedWorktrees,
          integratedSubmodules,
          hostIntegrated,
          hostPreIntegrationHead,
        });
        telemetry.push({
          event_type: "rollback",
          phase: "rollback",
          cause: hostPublishResult.incidentKind,
          retryable: false,
          recommended_next_actor: "operator",
          command_label: null,
          error: hostPublishResult.error,
          attributes: sanitizeJsonObject({
            repo_path: ".",
            repo_role: "host",
          }),
        });
        return {
          status: "blocked",
          worktreeCommit: hostWorktreeCommit,
          integratedCommit: null,
          mountedSubmodules: integratedSubmodules.map((entry) => ({
            repoPath: entry.repoPath,
            worktreeCommit: entry.worktreeCommit,
              integratedCommit: null,
            })),
            error: hostPublishResult.error,
            incidentKind: hostPublishResult.incidentKind,
            retryCount: hostPublishResult.retryCount,
            telemetry,
          };
        }

      hostIntegratedCommit = hostPublishResult.publishedCommit;
      const hostConvergence = await this.runPrimaryCloneFollowThrough(".", this.systemRoot);
      telemetry.push({
        event_type: "primary_convergence",
        phase: "primary_convergence",
        cause: hostConvergence.status === "converged" ? null : hostConvergence.status,
        retryable: false,
        recommended_next_actor: hostConvergence.status === "converged" ? "none" : "operator",
        command_label: "git.primary_convergence",
        error: hostConvergence.status === "converged" ? null : hostConvergence.message,
        attributes: sanitizeJsonObject({
          repo_path: ".",
          repo_role: "host",
          convergence_status: hostConvergence.status,
        }),
      });

      return {
        status: "merged",
        worktreeCommit: hostWorktreeCommit,
        integratedCommit: hostIntegratedCommit,
        mountedSubmodules: integratedSubmodules.map((entry) => ({
          repoPath: entry.repoPath,
          worktreeCommit: entry.worktreeCommit,
          integratedCommit: entry.integratedCommit,
        })),
        error: null,
        incidentKind: null,
        retryCount: 0,
        telemetry,
      };
    } catch (error) {
      await this.restoreDetachedMountedWorktrees(detachedWorktrees);
      await this.rollbackIntegratedRepos(integratedSubmodules);
      if (hostIntegrated && hostPreIntegrationHead) {
        await this.rollbackHostIntegration(hostPreIntegrationHead);
      }
      telemetry.push({
        event_type: "rollback",
        phase: "rollback",
        cause: "merge_back_failed",
        retryable: false,
        recommended_next_actor: "operator",
        command_label: null,
        error: error instanceof Error ? error.message : String(error),
      });
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
        retryCount: 0,
        telemetry,
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
    commitMessage: string;
    mountedSubmodules?: ReadonlyArray<MountedSubmoduleWorktree>;
  }): Promise<{
    status: "ready" | "blocked";
    baseCommit: string;
    worktreeCommit: string | null;
    error: string | null;
    incidentKind: string | null;
    telemetry: DispatchPhaseTelemetry[];
  }> {
    const telemetry: DispatchPhaseTelemetry[] = [];
    if (input.currentHead === input.baseCommit) {
      return {
        status: "ready",
        baseCommit: input.currentHead,
        worktreeCommit: input.worktreeCommit,
        error: null,
        incidentKind: null,
        telemetry,
      };
    }

    const baseStillReachable = await gitIsAncestor(
      input.worktreePath,
      input.baseCommit,
      input.currentHead,
    );
    if (!baseStillReachable) {
      telemetry.push({
        event_type: "refresh_decision",
        phase: "host_refresh",
        cause: input.repoPath === "." ? "stale_base_conflict" : "submodule_concurrent_advance",
        retryable: false,
        recommended_next_actor: "operator",
        command_label: "git.merge-base.host_refresh",
        relevant_shas: {
          base_commit: input.baseCommit,
          current_head: input.currentHead,
        },
        attributes: sanitizeJsonObject({
          repo_path: input.repoPath,
          chosen_path: "block",
          overlap_result: "not_ancestor",
        }),
      });
      return {
        status: "blocked",
        baseCommit: input.currentHead,
        worktreeCommit: input.worktreeCommit,
        error: formatRepoScopedRefreshError(
          input.repoPath,
          `recorded base ${input.baseCommit} is not an ancestor of current HEAD ${input.currentHead}`,
        ),
        incidentKind: input.repoPath === "."
          ? "stale_base_conflict"
          : INCIDENT_SUBMODULE_CONCURRENT_ADVANCE,
        telemetry,
      };
    }

    if (input.repoPath === "." && input.worktreeCommit) {
      const dispatchTouchedPaths = await this.listHostDispatchTouchedPaths({
        worktreePath: input.worktreePath,
        baseCommit: input.baseCommit,
        worktreeCommit: input.worktreeCommit,
        mountedSubmodules: input.mountedSubmodules ?? [],
      });
      const hostMovedPaths = await gitChangedFilesBetween(
        this.systemRoot,
        input.baseCommit,
        input.currentHead,
      );
      if (!pathsOverlap(dispatchTouchedPaths, hostMovedPaths)) {
        const orthogonal = await this.refreshOrthogonalHostWorktree({
          worktreePath: input.worktreePath,
          baseCommit: input.baseCommit,
          currentHead: input.currentHead,
          worktreeCommit: input.worktreeCommit,
          commitMessage: input.commitMessage,
        });
        return {
          ...orthogonal,
          telemetry: [
            {
              event_type: "refresh_decision",
              phase: "host_refresh",
              cause: orthogonal.incidentKind,
              retryable: orthogonal.status === "blocked",
              recommended_next_actor: orthogonal.status === "blocked" ? "operator" : "none",
              command_label: orthogonal.status === "blocked"
                ? "git.cherry_pick.host_refresh"
                : "git.reset.host_refresh",
              relevant_shas: {
                base_commit: input.baseCommit,
                current_head: input.currentHead,
                worktree_commit: input.worktreeCommit,
              },
              attributes: sanitizeJsonObject({
                repo_path: input.repoPath,
                chosen_path: "cherry_pick",
                dispatch_touched_paths: dispatchTouchedPaths,
                host_moved_paths: hostMovedPaths,
                overlap_result: "disjoint",
              }),
              error: orthogonal.error,
            },
          ],
        };
      }
    }

    if (!input.worktreeCommit) {
      await runGit(input.worktreePath, ["reset", "--hard", input.currentHead]);
      telemetry.push({
        event_type: "refresh_decision",
        phase: input.repoPath === "." ? "host_refresh" : "integration",
        cause: null,
        retryable: false,
        recommended_next_actor: "none",
        command_label: "git.reset.host_refresh",
        relevant_shas: {
          base_commit: input.baseCommit,
          current_head: input.currentHead,
        },
        attributes: sanitizeJsonObject({
          repo_path: input.repoPath,
          chosen_path: "reset",
        }),
      });
      return {
        status: "ready",
        baseCommit: input.currentHead,
        worktreeCommit: null,
        error: null,
        incidentKind: null,
        telemetry,
      };
    }

    const merge = await gitMerge(input.worktreePath, input.currentHead, input.commitMessage);
    if (merge.exitCode !== 0) {
      if (input.repoPath === ".") {
        const reconciliation = await this.reconcileHostRefreshMerge({
          worktreePath: input.worktreePath,
          currentHead: input.currentHead,
          commitMessage: input.commitMessage,
          mountedSubmodules: input.mountedSubmodules ?? [],
        });
        if (reconciliation.status === "ready") {
          telemetry.push({
            event_type: "refresh_decision",
            phase: "host_refresh",
            cause: null,
            retryable: false,
            recommended_next_actor: "none",
            command_label: "git.merge.host_refresh",
            command_result: buildCommandResult({
              exitCode: merge.exitCode,
              stdout: merge.stdout,
              stderr: merge.stderr,
              rawCommand: `git merge --no-ff ${input.currentHead}`,
            }),
            relevant_shas: {
              base_commit: input.baseCommit,
              current_head: input.currentHead,
              worktree_commit: input.worktreeCommit,
            },
            attributes: sanitizeJsonObject({
              repo_path: input.repoPath,
              chosen_path: "merge_reconciled_submodule_descendant",
            }),
          });
          return {
            status: "ready",
            baseCommit: input.currentHead,
            worktreeCommit: await gitHeadCommit(input.worktreePath),
            error: null,
            incidentKind: null,
            telemetry,
          };
        }
        if (reconciliation.status === "blocked") {
          telemetry.push({
            event_type: "refresh_decision",
            phase: "host_refresh",
            cause: reconciliation.incidentKind,
            retryable: false,
            recommended_next_actor: "operator",
            command_label: "git.merge.host_refresh",
            command_result: buildCommandResult({
              exitCode: merge.exitCode,
              stdout: merge.stdout,
              stderr: merge.stderr,
              rawCommand: `git merge --no-ff ${input.currentHead}`,
            }),
            relevant_shas: {
              base_commit: input.baseCommit,
              current_head: input.currentHead,
              worktree_commit: input.worktreeCommit,
            },
            attributes: sanitizeJsonObject({
              repo_path: input.repoPath,
              chosen_path: "block",
            }),
            error: reconciliation.error,
          });
          return {
            status: "blocked",
            baseCommit: input.currentHead,
            worktreeCommit: input.worktreeCommit,
            error: reconciliation.error,
            incidentKind: reconciliation.incidentKind,
            telemetry,
          };
        }
      }

      await gitAbortMerge(input.worktreePath).catch(() => undefined);
      telemetry.push({
        event_type: "refresh_decision",
        phase: input.repoPath === "." ? "host_refresh" : "integration",
        cause: input.repoPath === "." ? "tracked_path_conflict" : "submodule_concurrent_advance",
        retryable: false,
        recommended_next_actor: "operator",
        command_label: "git.merge.host_refresh",
        command_result: buildCommandResult({
          exitCode: merge.exitCode,
          stdout: merge.stdout,
          stderr: merge.stderr,
          rawCommand: `git merge --no-ff ${input.currentHead}`,
        }),
        relevant_shas: {
          base_commit: input.baseCommit,
          current_head: input.currentHead,
          worktree_commit: input.worktreeCommit,
        },
        attributes: sanitizeJsonObject({
          repo_path: input.repoPath,
          chosen_path: "block",
        }),
      });
      return {
        status: "blocked",
        baseCommit: input.currentHead,
        worktreeCommit: input.worktreeCommit,
        error: formatRepoScopedRefreshError(
          input.repoPath,
          merge.stderr.trim() || merge.stdout.trim() || `merge ${input.currentHead} failed`,
        ),
        incidentKind: input.repoPath === "."
          ? INCIDENT_TRACKED_PATH_CONFLICT
          : INCIDENT_SUBMODULE_CONCURRENT_ADVANCE,
        telemetry,
      };
    }

    telemetry.push({
      event_type: "refresh_decision",
      phase: input.repoPath === "." ? "host_refresh" : "integration",
      cause: null,
      retryable: false,
      recommended_next_actor: "none",
      command_label: "git.merge.host_refresh",
      command_result: buildCommandResult({
        exitCode: merge.exitCode,
        stdout: merge.stdout,
        stderr: merge.stderr,
        rawCommand: `git merge --no-ff ${input.currentHead}`,
      }),
      relevant_shas: {
        base_commit: input.baseCommit,
        current_head: input.currentHead,
        worktree_commit: input.worktreeCommit,
      },
      attributes: sanitizeJsonObject({
        repo_path: input.repoPath,
        chosen_path: "merge",
      }),
    });
    return {
      status: "ready",
      baseCommit: input.currentHead,
      worktreeCommit: await gitHeadCommit(input.worktreePath),
      error: null,
      incidentKind: null,
      telemetry,
    };
  }

  private async canReuseHostWorktreeCommit(
    worktreePath: string,
    worktreeCommit: string,
  ): Promise<boolean> {
    const [status, headCommit] = await Promise.all([
      runGit(worktreePath, ["status", "--porcelain"]),
      gitHeadCommit(worktreePath),
    ]);
    return status.length === 0 && headCommit === worktreeCommit;
  }

  private async listHostDispatchTouchedPaths(input: {
    worktreePath: string;
    baseCommit: string;
    worktreeCommit: string;
    mountedSubmodules: ReadonlyArray<MountedSubmoduleWorktree>;
  }): Promise<string[]> {
    const touched = new Set(
      await gitChangedFilesBetween(
        input.worktreePath,
        input.baseCommit,
        input.worktreeCommit,
      ),
    );

    for (const mounted of input.mountedSubmodules) {
      if (!(await gitHasChanges(mounted.worktreePath, mounted.baseCommit))) {
        continue;
      }
      touched.add(mounted.repoPath);
    }

    return [...touched];
  }

  private async refreshOrthogonalHostWorktree(input: {
    worktreePath: string;
    baseCommit: string;
    currentHead: string;
    worktreeCommit: string;
    commitMessage: string;
  }): Promise<{
    status: "ready" | "blocked";
    baseCommit: string;
    worktreeCommit: string | null;
    error: string | null;
    incidentKind: string | null;
    telemetry: DispatchPhaseTelemetry[];
  }> {
    const telemetry: DispatchPhaseTelemetry[] = [];
    await runGit(input.worktreePath, ["reset", "--hard", input.currentHead]);
    const replay = await gitCherryPickNoCommit(input.worktreePath, input.worktreeCommit);
    if (replay.exitCode !== 0) {
      await gitAbortCherryPick(input.worktreePath).catch(() => undefined);
      await runGit(input.worktreePath, ["reset", "--hard", input.worktreeCommit]).catch(() => undefined);
      telemetry.push({
        event_type: "refresh_decision",
        phase: "host_refresh",
        cause: "tracked_path_conflict",
        retryable: false,
        recommended_next_actor: "operator",
        command_label: "git.cherry_pick.host_refresh",
        command_result: buildCommandResult({
          exitCode: replay.exitCode,
          stdout: replay.stdout,
          stderr: replay.stderr,
          rawCommand: `git cherry-pick --no-commit ${input.worktreeCommit}`,
        }),
        relevant_shas: {
          base_commit: input.baseCommit,
          current_head: input.currentHead,
          worktree_commit: input.worktreeCommit,
        },
      });
      return {
        status: "blocked",
        baseCommit: input.currentHead,
        worktreeCommit: input.worktreeCommit,
        error: formatRepoScopedRefreshError(
          ".",
          replay.stderr.trim() || replay.stdout.trim() || `cherry-pick ${input.worktreeCommit} failed`,
        ),
        incidentKind: INCIDENT_TRACKED_PATH_CONFLICT,
        telemetry,
      };
    }

    telemetry.push({
      event_type: "refresh_decision",
      phase: "host_refresh",
      cause: null,
      retryable: false,
      recommended_next_actor: "none",
      command_label: "git.cherry_pick.host_refresh",
      command_result: buildCommandResult({
        exitCode: replay.exitCode,
        stdout: replay.stdout,
        stderr: replay.stderr,
        rawCommand: `git cherry-pick --no-commit ${input.worktreeCommit}`,
      }),
      relevant_shas: {
        base_commit: input.baseCommit,
        current_head: input.currentHead,
        worktree_commit: input.worktreeCommit,
      },
    });
    return {
      status: "ready",
      baseCommit: input.currentHead,
      worktreeCommit: await this.commitDispatch(
        input.worktreePath,
        input.currentHead,
        input.commitMessage,
      ),
      error: null,
      incidentKind: null,
      telemetry,
    };
  }

  private async reconcileHostRefreshMerge(input: {
    worktreePath: string;
    currentHead: string;
    commitMessage: string;
    mountedSubmodules: ReadonlyArray<MountedSubmoduleWorktree>;
  }): Promise<
    | { status: "ready" }
    | { status: "not_applicable" }
    | { status: "blocked"; error: string; incidentKind: string }
  > {
    const conflicts = await this.readUnmergedSubmodulePaths(input.worktreePath);
    if (conflicts.length === 0) {
      return { status: "not_applicable" };
    }

    const registeredSubmodules = await this.readRegisteredSubmodulePaths(input.worktreePath);
    if (conflicts.some((entry) => !registeredSubmodules.has(entry))) {
      return { status: "not_applicable" };
    }

    const mountedByPath = new Map(
      input.mountedSubmodules.map((entry) => [entry.repoPath, entry] as const),
    );
    const reconciledMountedSubmodules: ReconciledMountedSubmodule[] = [];

    try {
      for (const conflict of conflicts) {
        const mounted = mountedByPath.get(conflict);
        if (!mounted) {
          await this.rollbackReconciledHostRefreshMerge(
            input.worktreePath,
            reconciledMountedSubmodules,
            input.mountedSubmodules.map((entry) => entry.worktreePath),
          );
          return {
            status: "blocked",
            error: formatRepoScopedRefreshError(
              ".",
              `mounted submodule metadata missing for '${conflict}'`,
            ),
            incidentKind: INCIDENT_SUBMODULE_POINTER_INVARIANT_VIOLATION,
          };
        }

        const theirsCommit = await this.readSubmoduleTreeCommit(
          input.worktreePath,
          input.currentHead,
          conflict,
        );
        const preMergeHead = await gitHeadCommit(mounted.worktreePath);
        const innerMerge = await gitMerge(mounted.worktreePath, theirsCommit, input.commitMessage);
        if (innerMerge.exitCode !== 0) {
          await this.rollbackReconciledHostRefreshMerge(
            input.worktreePath,
            reconciledMountedSubmodules,
            [mounted.worktreePath],
          );
          return {
            status: "blocked",
            error: formatRepoScopedRefreshError(
              mounted.repoPath,
              innerMerge.stderr.trim()
                || innerMerge.stdout.trim()
                || `merge ${theirsCommit} failed`,
            ),
            incidentKind: INCIDENT_SUBMODULE_CONCURRENT_ADVANCE,
          };
        }

        reconciledMountedSubmodules.push({
          mounted,
          preMergeHead,
        });
        await runGit(input.worktreePath, ["add", conflict]);
      }

      await runGit(
        input.worktreePath,
        [
          "-c",
          "user.name=Delamain Dispatcher",
          "-c",
          "user.email=delamain@local",
          "commit",
          "--no-gpg-sign",
          "-m",
          input.commitMessage,
        ],
      );
      return { status: "ready" };
    } catch (error) {
      await this.rollbackReconciledHostRefreshMerge(
        input.worktreePath,
        reconciledMountedSubmodules,
        input.mountedSubmodules.map((entry) => entry.worktreePath),
      );
      return {
        status: "blocked",
        error: formatRepoScopedRefreshError(
          ".",
          error instanceof Error ? error.message : String(error),
        ),
        incidentKind: INCIDENT_SUBMODULE_POINTER_INVARIANT_VIOLATION,
      };
    }
  }

  private async readRegisteredSubmodulePaths(worktreePath: string): Promise<Set<string>> {
    const result = await runCommand(
      ["git", "config", "--file", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"],
      { cwd: worktreePath },
    );
    const stderr = result.stderr.toLowerCase();
    if (result.exitCode === 0) {
      return new Set(
        result.stdout
          .trim()
          .split("\n")
          .map((line) => normalizeRepoPath(line.slice(line.indexOf(" ") + 1).trim()))
          .filter(Boolean),
      );
    }

    if (
      stderr.includes("no such file or directory")
      || (result.exitCode === 1 && result.stdout.trim().length === 0 && stderr.trim().length === 0)
    ) {
      return new Set();
    }

    throw new Error(
      `git config --file .gitmodules failed in '${worktreePath}': ${
        result.stderr || result.stdout || `exit ${result.exitCode}`
      }`,
    );
  }

  private async readUnmergedSubmodulePaths(worktreePath: string): Promise<string[]> {
    const conflicts = await this.readUnmergedPaths(worktreePath);
    return conflicts.filter((path) => path.length > 0);
  }

  private async readUnmergedPaths(worktreePath: string): Promise<string[]> {
    const output = await runGit(worktreePath, ["ls-files", "-u"]);
    if (output.length === 0) {
      return [];
    }

    const conflicts = new Set<string>();
    for (const line of output.split("\n")) {
      const path = line.split("\t")[1]?.trim();
      if (!path) continue;
      conflicts.add(normalizeRepoPath(path));
    }
    return [...conflicts].sort();
  }

  private async rollbackReconciledHostRefreshMerge(
    hostWorktreePath: string,
    reconciledMountedSubmodules: ReadonlyArray<ReconciledMountedSubmodule>,
    mergeAbortPaths: ReadonlyArray<string>,
  ): Promise<void> {
    await this.abortMergeStates([
      hostWorktreePath,
      ...mergeAbortPaths,
      ...reconciledMountedSubmodules.map((entry) => entry.mounted.worktreePath),
    ]);

    for (const entry of [...reconciledMountedSubmodules].reverse()) {
      try {
        await runGit(entry.mounted.worktreePath, ["reset", "--hard", entry.preMergeHead]);
      } catch (error) {
        console.warn(
          `[dispatcher] mounted refresh rollback failed for '${entry.mounted.repoPath}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async readSubmoduleTreeCommit(
    worktreePath: string,
    treeish: string,
    repoPath: string,
  ): Promise<string> {
    const output = await runGit(worktreePath, ["ls-tree", treeish, "--", repoPath]);
    const match = output.match(/^160000 commit ([0-9a-f]{40})\t/);
    if (!match) {
      throw new Error(`Expected gitlink for '${repoPath}' in ${treeish}`);
    }
    return match[1];
  }

  private async verifyIntegratedSubmodulePointers(
    integratedSubmodules: ReadonlyArray<IntegratedSubmoduleCommit>,
  ): Promise<{ status: "ready" } | { status: "blocked"; error: string }> {
    try {
      for (const submodule of integratedSubmodules) {
        const recordedCommit = await this.readSubmoduleTreeCommit(
          this.systemRoot,
          "HEAD",
          submodule.repoPath,
        );
        if (recordedCommit !== submodule.integratedCommit) {
          return {
            status: "blocked",
            error: formatRepoScopedInvariantError(
              submodule.repoPath,
              `host gitlink recorded ${recordedCommit} but expected ${submodule.integratedCommit}`,
            ),
          };
        }
      }
    } catch (error) {
      return {
        status: "blocked",
        error: formatRepoScopedInvariantError(
          ".",
          error instanceof Error ? error.message : String(error),
        ),
      };
    }

    return { status: "ready" };
  }

  private async publishCanonicalCommit(input: {
    repoPath: string;
    repoRoot: string;
    commit: string;
    baseCommit: string;
    dispatchTouchedPaths: ReadonlyArray<string>;
  }): Promise<
    | { status: "ready"; publishedCommit: string; retryCount: number; telemetry: DispatchPhaseTelemetry[] }
    | { status: "blocked"; incidentKind: string; error: string; retryCount: number; telemetry: DispatchPhaseTelemetry[] }
  > {
    const telemetry: DispatchPhaseTelemetry[] = [];
    try {
      const target = await gitResolveCanonicalRefTarget(input.repoRoot);
      if (!target) {
        telemetry.push({
          event_type: "publish_attempt",
          phase: "publish",
          cause: "merge_back_publish_failed",
          retryable: false,
          recommended_next_actor: "operator",
          command_label: "git.push.canonical",
          error: formatRepoScopedPublishTargetError(
            input.repoPath,
            "canonical upstream ref is not configured on the integration checkout",
          ),
          attributes: sanitizeJsonObject({
            repo_path: input.repoPath,
          }),
        });
        return {
          status: "blocked",
          incidentKind: INCIDENT_MERGE_BACK_PUBLISH_FAILED,
          error: formatRepoScopedPublishTargetError(
            input.repoPath,
            "canonical upstream ref is not configured on the integration checkout",
          ),
          retryCount: 0,
          telemetry,
        };
      }

      const targetName = `${target.remoteName}/${target.branchName}`;
      const trackingRef = `refs/remotes/${target.remoteName}/${target.branchName}`;
      let currentCommit = input.commit;
      let retryCount = 0;

      while (true) {
        const remoteHeadBefore = await gitRemoteRefCommit(
          input.repoRoot,
          target.remoteName,
          target.fullRef,
        ).catch(() => null);
        const push = await gitPush(
          input.repoRoot,
          target.remoteName,
          `${currentCommit}:${target.fullRef}`,
        );
        telemetry.push({
          event_type: "publish_attempt",
          phase: "publish",
          cause: push.exitCode === 0 ? null : "merge_back_publish_failed",
          retryable: false,
          recommended_next_actor: push.exitCode === 0 ? "none" : "operator",
          command_label: "git.push.canonical",
          command_result: buildCommandResult({
            exitCode: push.exitCode,
            stdout: push.stdout,
            stderr: push.stderr,
            rawCommand: `git push ${target.remoteName} ${currentCommit}:${target.fullRef}`,
          }),
          relevant_shas: {
            base_commit: input.baseCommit,
            integrated_commit: currentCommit,
            remote_head_before: remoteHeadBefore,
          },
          attributes: sanitizeJsonObject({
            repo_path: input.repoPath,
            canonical_ref: targetName,
            retry_count: retryCount,
          }),
        });
        if (push.exitCode === 0) {
          const remoteCommit = await gitRemoteRefCommit(input.repoRoot, target.remoteName, target.fullRef);
          if (remoteCommit !== currentCommit) {
            telemetry.push({
              event_type: "publish_attempt",
              phase: "publish",
              cause: "canonical_upstream_unsynced",
              retryable: false,
              recommended_next_actor: "operator",
              command_label: "git.push.canonical",
              relevant_shas: {
                base_commit: input.baseCommit,
                integrated_commit: currentCommit,
                remote_head_before: remoteHeadBefore,
                remote_head_after: remoteCommit,
              },
              error: formatRepoScopedRemoteMismatchError(
                input.repoPath,
                targetName,
                currentCommit,
                remoteCommit,
              ),
              attributes: sanitizeJsonObject({
                repo_path: input.repoPath,
                canonical_ref: targetName,
              }),
            });
            return {
              status: "blocked",
              incidentKind: INCIDENT_CANONICAL_UPSTREAM_UNSYNCED,
              error: formatRepoScopedRemoteMismatchError(
                input.repoPath,
                targetName,
                currentCommit,
                remoteCommit,
              ),
              retryCount,
              telemetry,
            };
          }

          return {
            status: "ready",
            publishedCommit: currentCommit,
            retryCount,
            telemetry: telemetry.concat({
              event_type: "publish_attempt",
              phase: "publish",
              cause: null,
              retryable: false,
              recommended_next_actor: "none",
              command_label: "git.push.canonical",
              relevant_shas: {
                base_commit: input.baseCommit,
                integrated_commit: currentCommit,
                remote_head_before: remoteHeadBefore,
                remote_head_after: remoteCommit,
              },
              attributes: sanitizeJsonObject({
                repo_path: input.repoPath,
                canonical_ref: targetName,
                retry_count: retryCount,
              }),
            }),
          };
        }

        const pushMessage = push.stderr.trim() || push.stdout.trim() || "Push failed";
        if (!isNonFastForwardPushFailure(pushMessage)) {
          return {
            status: "blocked",
            incidentKind: INCIDENT_MERGE_BACK_PUBLISH_FAILED,
            error: formatRepoScopedPublishError(
              input.repoPath,
              targetName,
              currentCommit,
              pushMessage,
            ),
            retryCount,
            telemetry,
          };
        }

        if (retryCount >= MAX_PUBLISH_REPLAY_ATTEMPTS) {
          telemetry.push({
            event_type: "publish_replay",
            phase: "publish",
            cause: "merge_back_publish_failed",
            retryable: false,
            recommended_next_actor: "operator",
            command_label: "git.push.canonical",
            error: `non-fast-forward persisted after ${MAX_PUBLISH_REPLAY_ATTEMPTS} replay attempts: ${pushMessage}`,
            relevant_shas: {
              base_commit: input.baseCommit,
              integrated_commit: currentCommit,
              remote_head_before: remoteHeadBefore,
            },
            attributes: sanitizeJsonObject({
              repo_path: input.repoPath,
              canonical_ref: targetName,
              retry_count: retryCount,
            }),
          });
          return {
            status: "blocked",
            incidentKind: INCIDENT_MERGE_BACK_PUBLISH_FAILED,
            error: formatRepoScopedPublishError(
              input.repoPath,
              targetName,
              currentCommit,
              `non-fast-forward persisted after ${MAX_PUBLISH_REPLAY_ATTEMPTS} replay attempts: ${pushMessage}`,
            ),
            retryCount,
            telemetry,
          };
        }

        retryCount += 1;

        const fetch = await gitFetchRef(
          input.repoRoot,
          target.remoteName,
          target.fullRef,
          trackingRef,
        );
        telemetry.push({
          event_type: "publish_replay",
          phase: "publish",
          cause: fetch.exitCode === 0 ? null : "merge_back_publish_failed",
          retryable: false,
          recommended_next_actor: fetch.exitCode === 0 ? "automation" : "operator",
          command_label: "git.fetch.canonical",
          command_result: buildCommandResult({
            exitCode: fetch.exitCode,
            stdout: fetch.stdout,
            stderr: fetch.stderr,
            rawCommand: `git fetch ${target.remoteName} ${target.fullRef} ${trackingRef}`,
          }),
          relevant_shas: {
            base_commit: input.baseCommit,
            integrated_commit: currentCommit,
          },
          attributes: sanitizeJsonObject({
            repo_path: input.repoPath,
            canonical_ref: targetName,
            retry_count: retryCount,
          }),
        });
        if (fetch.exitCode !== 0) {
          return {
            status: "blocked",
            incidentKind: INCIDENT_MERGE_BACK_PUBLISH_FAILED,
            error: formatRepoScopedPublishError(
              input.repoPath,
              targetName,
              currentCommit,
              `fetch failed before replay: ${fetch.stderr.trim() || fetch.stdout.trim() || "fetch failed"}`,
            ),
            retryCount,
            telemetry,
          };
        }

        const remoteCommit = await gitRevParse(input.repoRoot, trackingRef);
        if (!(await gitIsAncestor(input.repoRoot, input.baseCommit, remoteCommit))) {
          return {
            status: "blocked",
            incidentKind: INCIDENT_MERGE_BACK_PUBLISH_FAILED,
            error: formatRepoScopedPublishError(
              input.repoPath,
              targetName,
              currentCommit,
              `canonical upstream moved below recorded base ${input.baseCommit} -> ${remoteCommit}; automatic replay requires an ancestor-preserving remote`,
            ),
            retryCount,
            telemetry: telemetry.concat({
              event_type: "publish_replay",
              phase: "publish",
              cause: "merge_back_publish_failed",
              retryable: false,
              recommended_next_actor: "operator",
              command_label: "git.merge-base.publish_replay",
              relevant_shas: {
                base_commit: input.baseCommit,
                integrated_commit: currentCommit,
                remote_head_after: remoteCommit,
              },
              attributes: sanitizeJsonObject({
                repo_path: input.repoPath,
                canonical_ref: targetName,
                retry_count: retryCount,
              }),
            }),
          };
        }

        const remoteMovedPaths = await gitChangedFilesBetween(
          input.repoRoot,
          input.baseCommit,
          remoteCommit,
        );
        const conflictingPaths = overlappingPaths(input.dispatchTouchedPaths, remoteMovedPaths);
        if (conflictingPaths.length > 0) {
          telemetry.push({
            event_type: "publish_replay",
            phase: "publish",
            cause: "merge_back_publish_failed",
            retryable: false,
            recommended_next_actor: "operator",
            command_label: "git.diff.publish_replay_overlap",
            relevant_shas: {
              base_commit: input.baseCommit,
              integrated_commit: currentCommit,
              remote_head_after: remoteCommit,
            },
            attributes: sanitizeJsonObject({
              repo_path: input.repoPath,
              canonical_ref: targetName,
              retry_count: retryCount,
              remote_moved_paths: remoteMovedPaths,
              conflicting_paths: conflictingPaths,
            }),
          });
          return {
            status: "blocked",
            incidentKind: INCIDENT_MERGE_BACK_PUBLISH_FAILED,
            error: formatRepoScopedPublishConflictError(
              input.repoPath,
              targetName,
              currentCommit,
              conflictingPaths,
            ),
            retryCount,
            telemetry,
          };
        }

        const rebase = await gitRebase(input.repoRoot, trackingRef);
        if (rebase.exitCode !== 0) {
          const rebaseConflictPaths = await this.readUnmergedPaths(input.repoRoot);
          await gitAbortRebase(input.repoRoot).catch(() => undefined);
          telemetry.push({
            event_type: "publish_replay",
            phase: "publish",
            cause: "merge_back_publish_failed",
            retryable: false,
            recommended_next_actor: "operator",
            command_label: "git.rebase.publish_replay",
            command_result: buildCommandResult({
              exitCode: rebase.exitCode,
              stdout: rebase.stdout,
              stderr: rebase.stderr,
              rawCommand: `git rebase ${trackingRef}`,
            }),
            relevant_shas: {
              base_commit: input.baseCommit,
              integrated_commit: currentCommit,
              remote_head_after: remoteCommit,
            },
            attributes: sanitizeJsonObject({
              repo_path: input.repoPath,
              canonical_ref: targetName,
              retry_count: retryCount,
              unmerged_paths: rebaseConflictPaths,
            }),
          });
          return {
            status: "blocked",
            incidentKind: INCIDENT_MERGE_BACK_PUBLISH_FAILED,
            error: formatRepoScopedPublishReplayError(
              input.repoPath,
              targetName,
              currentCommit,
              rebase.stderr.trim() || rebase.stdout.trim() || `rebase onto ${trackingRef} failed`,
              rebaseConflictPaths,
            ),
            retryCount,
            telemetry,
          };
        }

        telemetry.push({
          event_type: "publish_replay",
          phase: "publish",
          cause: null,
          retryable: false,
          recommended_next_actor: "automation",
          command_label: "git.rebase.publish_replay",
          command_result: buildCommandResult({
            exitCode: rebase.exitCode,
            stdout: rebase.stdout,
            stderr: rebase.stderr,
            rawCommand: `git rebase ${trackingRef}`,
          }),
          relevant_shas: {
            base_commit: input.baseCommit,
            integrated_commit: currentCommit,
            remote_head_after: remoteCommit,
          },
          attributes: sanitizeJsonObject({
            repo_path: input.repoPath,
            canonical_ref: targetName,
            retry_count: retryCount,
          }),
        });
        currentCommit = await gitHeadCommit(input.repoRoot);
      }
    } catch (error) {
      telemetry.push({
        event_type: "publish_attempt",
        phase: "publish",
        cause: "merge_back_publish_failed",
        retryable: false,
        recommended_next_actor: "operator",
        command_label: "git.push.canonical",
        error: error instanceof Error ? error.message : String(error),
        attributes: sanitizeJsonObject({
          repo_path: input.repoPath,
        }),
      });
      return {
        status: "blocked",
        incidentKind: INCIDENT_MERGE_BACK_PUBLISH_FAILED,
        error: formatRepoScopedPublishTargetError(
          input.repoPath,
          error instanceof Error ? error.message : String(error),
        ),
        retryCount: 0,
        telemetry,
      };
    }
  }

  private async runPrimaryCloneFollowThrough(
    repoPath: string,
    repoRoot: string,
  ): Promise<Awaited<ReturnType<typeof convergePrimaryClone>>> {
    const convergence = await convergePrimaryClone({
      repoRoot,
      publisher: "dispatcher-merge-back",
    });
    if (convergence.status === "converged") {
      return convergence;
    }

    console.warn(
      `[dispatcher] primary clone follow-through for '${repoPath}' returned ${convergence.status}: ${convergence.message}`,
    );
    return convergence;
  }

  private async rollbackMergeTransaction(input: {
    detachedWorktrees: ReadonlyArray<IntegratedSubmoduleCommit>;
    integratedSubmodules: ReadonlyArray<IntegratedSubmoduleCommit>;
    hostIntegrated: boolean;
    hostPreIntegrationHead: string | null;
  }): Promise<void> {
    await this.restoreDetachedMountedWorktrees(input.detachedWorktrees);
    await this.rollbackIntegratedRepos(input.integratedSubmodules);
    if (input.hostIntegrated && input.hostPreIntegrationHead) {
      await this.rollbackHostIntegration(input.hostPreIntegrationHead);
    }
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

  private async abortRefreshMerges(
    prepared: Pick<IsolatedDispatch, "worktreePath" | "mountedSubmodules">,
  ): Promise<void> {
    await this.abortMergeStates([
      prepared.worktreePath,
      ...prepared.mountedSubmodules.map((entry) => entry.worktreePath),
    ]);
  }

  private async abortMergeStates(worktreePaths: ReadonlyArray<string>): Promise<void> {
    for (const worktreePath of worktreePaths) {
      try {
        await gitAbortMerge(worktreePath);
      } catch (error) {
        console.warn(
          `[dispatcher] merge abort failed in '${worktreePath}': ${error instanceof Error ? error.message : String(error)}`,
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

function formatRepoScopedPublishError(
  repoPath: string,
  target: string,
  commit: string,
  message: string,
): string {
  const scope = repoPath === "." ? "host repo" : `repo '${repoPath}'`;
  return `${scope} publish ${target} (${commit}) failed: ${message}`;
}

function formatRepoScopedPublishConflictError(
  repoPath: string,
  target: string,
  commit: string,
  conflictingPaths: ReadonlyArray<string>,
): string {
  return formatRepoScopedPublishError(
    repoPath,
    target,
    commit,
    `non-fast-forward replay blocked by overlapping paths: ${conflictingPaths.join(", ")}`,
  );
}

function formatRepoScopedPublishReplayError(
  repoPath: string,
  target: string,
  commit: string,
  message: string,
  conflictingPaths: ReadonlyArray<string>,
): string {
  const suffix = conflictingPaths.length > 0
    ? ` Conflicting paths: ${conflictingPaths.join(", ")}`
    : "";
  return formatRepoScopedPublishError(
    repoPath,
    target,
    commit,
    `non-fast-forward replay failed: ${message}${suffix}`,
  );
}

function formatRepoScopedPublishTargetError(repoPath: string, message: string): string {
  const scope = repoPath === "." ? "host repo" : `repo '${repoPath}'`;
  return `${scope} publish target resolution failed: ${message}`;
}

function formatRepoScopedRemoteMismatchError(
  repoPath: string,
  target: string,
  expectedCommit: string,
  observedCommit: string | null,
): string {
  const scope = repoPath === "." ? "host repo" : `repo '${repoPath}'`;
  return `${scope} publish verification for ${target} expected ${expectedCommit} but observed ${observedCommit ?? "<missing>"}`;
}

function formatRepoScopedInvariantError(repoPath: string, message: string): string {
  const scope = repoPath === "." ? "host repo" : `repo '${repoPath}'`;
  return `${scope} merge-back invariant failed: ${message}`;
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

function overlappingPaths(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): string[] {
  const rightSet = new Set(right.map((value) => normalizeRepoPath(value)));
  return [...new Set(
    left
      .map((value) => normalizeRepoPath(value))
      .filter((value) => rightSet.has(value)),
  )].sort();
}

function pathsOverlap(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return overlappingPaths(left, right).length > 0;
}

function isNonFastForwardPushFailure(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("non-fast-forward")
    || normalized.includes("fetch first")
    || normalized.includes("failed to push some refs")
    || normalized.includes("contains work that you do not have locally");
}
