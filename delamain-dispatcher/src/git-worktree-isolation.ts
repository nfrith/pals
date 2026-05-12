import { existsSync } from "fs";
import { mkdir, rm } from "fs/promises";
import { homedir } from "os";
import { dirname, join, relative, resolve } from "path";
import {
  buildCommandResult,
  sanitizeJsonObject,
  type BlockedIncidentDetails,
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
  incidentDetails: BlockedIncidentDetails | null;
  retryCount: number;
  telemetry: DispatchPhaseTelemetry[];
}

export interface RefreshMergeBackResult {
  status: "ready" | "blocked";
  hostWorktreeCommit: string | null;
  mountedSubmodules: MountedSubmoduleMergeState[];
  error: string | null;
  incidentKind: string | null;
  incidentDetails: BlockedIncidentDetails | null;
  telemetry: DispatchPhaseTelemetry[];
}

export interface MergeBackCorrelationIds {
  mergeAttemptId: string;
  hostRepoAttemptId: string;
  mountedRepoAttemptIds: Record<string, string>;
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
    correlationIds: MergeBackCorrelationIds;
  }): Promise<RefreshMergeBackResult> {
    const telemetry: DispatchPhaseTelemetry[] = [];
    const dirtyRepo = await this.findDirtyIntegrationRepo(input.prepared.mountedSubmodules);
    if (dirtyRepo) {
      const repoRole = dirtyRepo === "." ? "host" : "mounted_submodule";
      const repoAttemptId = resolveRepoAttemptId(input.correlationIds, dirtyRepo);
      telemetry.push(withCorrelationIds({
        event_type: "dirty_check",
        phase: "dirty_check",
        cause: "dirty_integration_checkout",
        retryable: true,
        recommended_next_actor: "operator",
        command_label: "git.status.integration",
        error: `Integration checkout is dirty: ${dirtyRepo}`,
        attributes: sanitizeJsonObject({
          dirty_repo: dirtyRepo,
          repo_path: dirtyRepo,
          repo_role: repoRole,
        }),
      }, input.correlationIds.mergeAttemptId, repoAttemptId));
      return {
        status: "blocked",
        hostWorktreeCommit: input.hostWorktreeCommit,
        mountedSubmodules: buildMountedSubmoduleResults(
          input.prepared.mountedSubmodules,
          input.mountedSubmodules,
        ),
        error: `Integration checkout is dirty: ${dirtyRepo}`,
        incidentKind: "dirty_integration_checkout",
        incidentDetails: buildBlockedIncidentDetails({
          phase: "dirty_check",
          repoRole,
          repoPath: dirtyRepo,
          commandLabel: "git.status.integration",
          relevantShas: {
            base_commit: input.prepared.baseCommit,
          },
          mergeAttemptId: input.correlationIds.mergeAttemptId,
          repoAttemptId,
        }),
        telemetry,
      };
    }

    telemetry.push(withCorrelationIds({
      event_type: "dirty_check",
      phase: "dirty_check",
      cause: null,
      retryable: false,
      recommended_next_actor: "none",
      command_label: "git.status.integration",
      attributes: sanitizeJsonObject({
        dirty_repo: null,
      }),
    }, input.correlationIds.mergeAttemptId));

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
          correlationIds: input.correlationIds,
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
            incidentDetails: refresh.incidentDetails,
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
        correlationIds: input.correlationIds,
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
          incidentDetails: hostRefresh.incidentDetails,
          telemetry,
        };
      }

      return {
        status: "ready",
        hostWorktreeCommit: hostRefresh.worktreeCommit,
        mountedSubmodules,
        error: null,
        incidentKind: null,
        incidentDetails: null,
        telemetry,
      };
    } catch (error) {
      await this.abortRefreshMerges(input.prepared).catch(() => undefined);
      telemetry.push(withCorrelationIds({
        event_type: "refresh_decision",
        phase: "merge_back",
        cause: "merge_back_failed",
        retryable: false,
        recommended_next_actor: "operator",
        command_label: null,
        error: error instanceof Error ? error.message : String(error),
      }, input.correlationIds.mergeAttemptId, input.correlationIds.hostRepoAttemptId));
      return {
        status: "blocked",
        hostWorktreeCommit: input.hostWorktreeCommit,
        mountedSubmodules,
        error: error instanceof Error ? error.message : String(error),
        incidentKind: "merge_back_failed",
        incidentDetails: buildBlockedIncidentDetails({
          phase: "merge_back",
          repoRole: "host",
          repoPath: ".",
          commandLabel: null,
          relevantShas: {
            base_commit: input.prepared.baseCommit,
            worktree_commit: input.hostWorktreeCommit,
          },
          mergeAttemptId: input.correlationIds.mergeAttemptId,
          repoAttemptId: input.correlationIds.hostRepoAttemptId,
        }),
        telemetry,
      };
    }
  }

  async mergeBack(input: {
    prepared: Pick<IsolatedDispatch, "worktreePath" | "baseCommit" | "mountedSubmodules">;
    hostCommitMessage: string;
    hostWorktreeCommit: string | null;
    mountedSubmodules: MountedSubmoduleMergeState[];
    correlationIds: MergeBackCorrelationIds;
  }): Promise<MergeBackResult> {
    const telemetry: DispatchPhaseTelemetry[] = [];
    const dirtyRepo = await this.findDirtyIntegrationRepo(input.prepared.mountedSubmodules);
    if (dirtyRepo) {
      const repoRole = dirtyRepo === "." ? "host" : "mounted_submodule";
      const repoAttemptId = resolveRepoAttemptId(input.correlationIds, dirtyRepo);
      telemetry.push(withCorrelationIds({
        event_type: "dirty_check",
        phase: "dirty_check",
        cause: "dirty_integration_checkout",
        retryable: true,
        recommended_next_actor: "operator",
        command_label: "git.status.integration",
        error: `Integration checkout is dirty: ${dirtyRepo}`,
        attributes: sanitizeJsonObject({
          dirty_repo: dirtyRepo,
          repo_path: dirtyRepo,
          repo_role: repoRole,
        }),
      }, input.correlationIds.mergeAttemptId, repoAttemptId));
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
        incidentDetails: buildBlockedIncidentDetails({
          phase: "dirty_check",
          repoRole,
          repoPath: dirtyRepo,
          commandLabel: "git.status.integration",
          relevantShas: {
            base_commit: input.prepared.baseCommit,
          },
          mergeAttemptId: input.correlationIds.mergeAttemptId,
          repoAttemptId,
        }),
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
          const repoAttemptId = resolveRepoAttemptId(input.correlationIds, submoduleState.repoPath);
          telemetry.push(withCorrelationIds({
            event_type: "integration_attempt",
            phase: "integration",
            cause: "merge_back_failed",
            retryable: false,
            recommended_next_actor: "operator",
            command_label: null,
            error: `Mounted submodule metadata missing for '${submoduleState.repoPath}'`,
            attributes: sanitizeJsonObject({ repo_path: submoduleState.repoPath }),
          }, input.correlationIds.mergeAttemptId, repoAttemptId));
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
            incidentDetails: buildBlockedIncidentDetails({
              phase: "integration",
              repoRole: "mounted_submodule",
              repoPath: submoduleState.repoPath,
              commandLabel: null,
              relevantShas: {
                base_commit: input.prepared.baseCommit,
              },
              mergeAttemptId: input.correlationIds.mergeAttemptId,
              repoAttemptId,
            }),
            retryCount: 0,
            telemetry,
          };
        }

        const preIntegrationHead = await gitHeadCommit(mounted.primaryRepoPath);
        const merge = await gitMergeFastForward(mounted.primaryRepoPath, submoduleState.worktreeCommit);
        const repoAttemptId = resolveRepoAttemptId(input.correlationIds, mounted.repoPath);
        const commandResult = buildCommandResult({
          exitCode: merge.exitCode,
          stdout: merge.stdout,
          stderr: merge.stderr,
          rawCommand: `git merge --ff-only ${submoduleState.worktreeCommit}`,
        });
        telemetry.push(withCorrelationIds({
          event_type: "integration_attempt",
          phase: "integration",
          cause: merge.exitCode === 0 ? null : "submodule_concurrent_advance",
          retryable: false,
          recommended_next_actor: merge.exitCode === 0 ? "none" : "operator",
          command_label: "git.merge.integration",
          command_result: commandResult,
          relevant_shas: {
            base_commit: mounted.baseCommit,
            current_head: preIntegrationHead,
            worktree_commit: submoduleState.worktreeCommit,
          },
          attributes: sanitizeJsonObject({
            repo_path: mounted.repoPath,
            repo_role: "mounted_submodule",
          }),
        }, input.correlationIds.mergeAttemptId, repoAttemptId));
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
            incidentDetails: buildBlockedIncidentDetails({
              phase: "integration",
              repoRole: "mounted_submodule",
              repoPath: mounted.repoPath,
              commandLabel: "git.merge.integration",
              commandResult,
              relevantShas: {
                base_commit: mounted.baseCommit,
                current_head: preIntegrationHead,
                worktree_commit: submoduleState.worktreeCommit,
              },
              mergeAttemptId: input.correlationIds.mergeAttemptId,
              repoAttemptId,
            }),
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
          mergeAttemptId: input.correlationIds.mergeAttemptId,
          repoAttemptId: resolveRepoAttemptId(input.correlationIds, submodule.repoPath),
          repoRole: "primary_clone",
        });
        telemetry.push(...publishResult.telemetry);
        if (publishResult.status === "blocked") {
          await this.rollbackMergeTransaction({
            detachedWorktrees,
            integratedSubmodules,
            hostIntegrated,
            hostPreIntegrationHead,
          });
          telemetry.push(withCorrelationIds({
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
          }, input.correlationIds.mergeAttemptId, resolveRepoAttemptId(input.correlationIds, submodule.repoPath)));
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
            incidentDetails: publishResult.incidentDetails,
            retryCount: publishResult.retryCount,
            telemetry,
          };
        }

        submodule.integratedCommit = publishResult.publishedCommit;
        const submoduleConvergence = await this.runPrimaryCloneFollowThrough(
          submodule.repoPath,
          submodule.primaryRepoPath,
        );
        telemetry.push(withCorrelationIds({
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
        }, input.correlationIds.mergeAttemptId, resolveRepoAttemptId(input.correlationIds, submodule.repoPath)));
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
        telemetry.push(withCorrelationIds({
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
        }, input.correlationIds.mergeAttemptId, input.correlationIds.hostRepoAttemptId));
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
          incidentDetails: buildBlockedIncidentDetails({
            phase: "rollback",
            repoRole: "host",
            repoPath: ".",
            commandLabel: null,
            relevantShas: {
              base_commit: input.prepared.baseCommit,
            },
            mergeAttemptId: input.correlationIds.mergeAttemptId,
            repoAttemptId: input.correlationIds.hostRepoAttemptId,
          }),
          retryCount: 0,
          telemetry,
        };
      }

      hostPreIntegrationHead = await gitHeadCommit(this.systemRoot);
      const hostDispatchTouchedPaths = await this.listHostDispatchTouchedPaths({
        worktreePath: input.prepared.worktreePath,
        baseCommit: input.prepared.baseCommit,
        worktreeCommit: hostWorktreeCommit,
        mountedSubmodules: input.prepared.mountedSubmodules,
      });
      const hostMovedPaths = await gitChangedFilesBetween(
        this.systemRoot,
        input.prepared.baseCommit,
        hostPreIntegrationHead,
      );
      const hostOverlappingPaths = overlappingPaths(hostDispatchTouchedPaths, hostMovedPaths);
      const hostMerge = await gitMergeFastForward(this.systemRoot, hostWorktreeCommit);
      const hostMergeCommandResult = buildCommandResult({
        exitCode: hostMerge.exitCode,
        stdout: hostMerge.stdout,
        stderr: hostMerge.stderr,
        rawCommand: `git merge --ff-only ${hostWorktreeCommit}`,
      });
      telemetry.push(withCorrelationIds({
        event_type: "integration_attempt",
        phase: "integration",
        cause: hostMerge.exitCode === 0 ? null : "tracked_path_conflict",
        retryable: false,
        recommended_next_actor: hostMerge.exitCode === 0 ? "none" : "operator",
        command_label: "git.merge.integration",
        command_result: hostMergeCommandResult,
        relevant_shas: {
          base_commit: input.prepared.baseCommit,
          current_head: hostPreIntegrationHead,
          worktree_commit: hostWorktreeCommit,
        },
        attributes: sanitizeJsonObject({
          repo_path: ".",
          repo_role: "host",
        }),
      }, input.correlationIds.mergeAttemptId, input.correlationIds.hostRepoAttemptId));
      if (hostMerge.exitCode !== 0) {
        await this.restoreDetachedMountedWorktrees(detachedWorktrees);
        await this.rollbackIntegratedRepos(integratedSubmodules);
        telemetry.push(withCorrelationIds({
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
        }, input.correlationIds.mergeAttemptId, input.correlationIds.hostRepoAttemptId));
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
          incidentDetails: buildBlockedIncidentDetails({
            phase: "integration",
            repoRole: "host",
            repoPath: ".",
            commandLabel: "git.merge.integration",
            commandResult: hostMergeCommandResult,
            relevantShas: {
              base_commit: input.prepared.baseCommit,
              current_head: hostPreIntegrationHead,
              worktree_commit: hostWorktreeCommit,
            },
            touchedPaths: hostDispatchTouchedPaths,
            movedPaths: hostMovedPaths,
            overlappingPaths: hostOverlappingPaths,
            recoveryHint: hostOverlappingPaths.length > 0
              ? "Git left no unmerged index for the fast-forward failure; use overlapping_paths as the structural conflict surface."
              : null,
            mergeAttemptId: input.correlationIds.mergeAttemptId,
            repoAttemptId: input.correlationIds.hostRepoAttemptId,
          }),
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
        telemetry.push(withCorrelationIds({
          event_type: "rollback",
          phase: "rollback",
          cause: "submodule_pointer_invariant_violation",
          retryable: false,
          recommended_next_actor: "operator",
          command_label: "git.verify.submodule_pointer",
          error: pointerVerification.error,
        }, input.correlationIds.mergeAttemptId, input.correlationIds.hostRepoAttemptId));
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
          incidentDetails: buildBlockedIncidentDetails({
            phase: "rollback",
            repoRole: "host",
            repoPath: ".",
            commandLabel: "git.verify.submodule_pointer",
            relevantShas: {
              base_commit: input.prepared.baseCommit,
              worktree_commit: hostWorktreeCommit,
            },
            mergeAttemptId: input.correlationIds.mergeAttemptId,
            repoAttemptId: input.correlationIds.hostRepoAttemptId,
          }),
          retryCount: 0,
          telemetry,
        };
      }

      let hostIntegratedCommit = await gitHeadCommit(this.systemRoot);
      const hostPublishResult = await this.publishCanonicalCommit({
        repoPath: ".",
        repoRoot: this.systemRoot,
        commit: hostIntegratedCommit,
        baseCommit: input.prepared.baseCommit,
        dispatchTouchedPaths: hostDispatchTouchedPaths,
        mergeAttemptId: input.correlationIds.mergeAttemptId,
        repoAttemptId: input.correlationIds.hostRepoAttemptId,
        repoRole: "host",
      });
      telemetry.push(...hostPublishResult.telemetry);
      if (hostPublishResult.status === "blocked") {
        await this.rollbackMergeTransaction({
          detachedWorktrees,
          integratedSubmodules,
          hostIntegrated,
          hostPreIntegrationHead,
        });
        telemetry.push(withCorrelationIds({
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
        }, input.correlationIds.mergeAttemptId, input.correlationIds.hostRepoAttemptId));
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
            incidentDetails: hostPublishResult.incidentDetails,
            retryCount: hostPublishResult.retryCount,
            telemetry,
          };
        }

      hostIntegratedCommit = hostPublishResult.publishedCommit;
      const hostConvergence = await this.runPrimaryCloneFollowThrough(".", this.systemRoot);
      telemetry.push(withCorrelationIds({
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
      }, input.correlationIds.mergeAttemptId, input.correlationIds.hostRepoAttemptId));

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
        incidentDetails: null,
        retryCount: 0,
        telemetry,
      };
    } catch (error) {
      await this.restoreDetachedMountedWorktrees(detachedWorktrees);
      await this.rollbackIntegratedRepos(integratedSubmodules);
      if (hostIntegrated && hostPreIntegrationHead) {
        await this.rollbackHostIntegration(hostPreIntegrationHead);
      }
      telemetry.push(withCorrelationIds({
        event_type: "rollback",
        phase: "rollback",
        cause: "merge_back_failed",
        retryable: false,
        recommended_next_actor: "operator",
        command_label: null,
        error: error instanceof Error ? error.message : String(error),
      }, input.correlationIds.mergeAttemptId, input.correlationIds.hostRepoAttemptId));
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
        incidentDetails: buildBlockedIncidentDetails({
          phase: "rollback",
          repoRole: "host",
          repoPath: ".",
          commandLabel: null,
          relevantShas: {
            base_commit: input.prepared.baseCommit,
            current_head: hostPreIntegrationHead,
          },
          mergeAttemptId: input.correlationIds.mergeAttemptId,
          repoAttemptId: input.correlationIds.hostRepoAttemptId,
        }),
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
    correlationIds: MergeBackCorrelationIds;
  }): Promise<{
    status: "ready" | "blocked";
    baseCommit: string;
    worktreeCommit: string | null;
    error: string | null;
    incidentKind: string | null;
    incidentDetails: BlockedIncidentDetails | null;
    telemetry: DispatchPhaseTelemetry[];
  }> {
    const telemetry: DispatchPhaseTelemetry[] = [];
    const repoRole = input.repoPath === "." ? "host" : "mounted_submodule";
    const repoAttemptId = resolveRepoAttemptId(input.correlationIds, input.repoPath);
    if (input.currentHead === input.baseCommit) {
      return {
        status: "ready",
        baseCommit: input.currentHead,
        worktreeCommit: input.worktreeCommit,
        error: null,
        incidentKind: null,
        incidentDetails: null,
        telemetry,
      };
    }

    const baseStillReachable = await gitIsAncestor(
      input.worktreePath,
      input.baseCommit,
      input.currentHead,
    );
    if (!baseStillReachable) {
      telemetry.push(withCorrelationIds({
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
      }, input.correlationIds.mergeAttemptId, repoAttemptId));
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
        incidentDetails: buildBlockedIncidentDetails({
          phase: "host_refresh",
          repoRole,
          repoPath: input.repoPath,
          commandLabel: "git.merge-base.host_refresh",
          relevantShas: {
            base_commit: input.baseCommit,
            current_head: input.currentHead,
          },
          mergeAttemptId: input.correlationIds.mergeAttemptId,
          repoAttemptId,
        }),
        telemetry,
      };
    }

    const dispatchTouchedPaths = input.repoPath === "." && input.worktreeCommit
      ? await this.listHostDispatchTouchedPaths({
        worktreePath: input.worktreePath,
        baseCommit: input.baseCommit,
        worktreeCommit: input.worktreeCommit,
        mountedSubmodules: input.mountedSubmodules ?? [],
      })
      : [];
    const hostMovedPaths = input.repoPath === "." && input.worktreeCommit
      ? await gitChangedFilesBetween(
        this.systemRoot,
        input.baseCommit,
        input.currentHead,
      )
      : [];

    if (input.repoPath === "." && input.worktreeCommit) {
      if (!pathsOverlap(dispatchTouchedPaths, hostMovedPaths)) {
        const orthogonal = await this.refreshOrthogonalHostWorktree({
          worktreePath: input.worktreePath,
          baseCommit: input.baseCommit,
          currentHead: input.currentHead,
          worktreeCommit: input.worktreeCommit,
          commitMessage: input.commitMessage,
          dispatchTouchedPaths,
          hostMovedPaths,
          correlationIds: input.correlationIds,
        });
        return {
          ...orthogonal,
          telemetry: [
            withCorrelationIds({
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
            }, input.correlationIds.mergeAttemptId, repoAttemptId),
          ],
        };
      }
    }

    if (!input.worktreeCommit) {
      await runGit(input.worktreePath, ["reset", "--hard", input.currentHead]);
      telemetry.push(withCorrelationIds({
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
      }, input.correlationIds.mergeAttemptId, repoAttemptId));
      return {
        status: "ready",
        baseCommit: input.currentHead,
        worktreeCommit: null,
        error: null,
        incidentKind: null,
        incidentDetails: null,
        telemetry,
      };
    }

    const merge = await gitMerge(input.worktreePath, input.currentHead, input.commitMessage);
    const mergeCommandResult = buildCommandResult({
      exitCode: merge.exitCode,
      stdout: merge.stdout,
      stderr: merge.stderr,
      rawCommand: `git merge --no-ff ${input.currentHead}`,
    });
    if (merge.exitCode !== 0) {
      if (input.repoPath === ".") {
        const reconciliation = await this.reconcileHostRefreshMerge({
          worktreePath: input.worktreePath,
          currentHead: input.currentHead,
          commitMessage: input.commitMessage,
          mountedSubmodules: input.mountedSubmodules ?? [],
        });
        if (reconciliation.status === "ready") {
          telemetry.push(withCorrelationIds({
            event_type: "refresh_decision",
            phase: "host_refresh",
            cause: null,
            retryable: false,
            recommended_next_actor: "none",
            command_label: "git.merge.host_refresh",
            command_result: mergeCommandResult,
            relevant_shas: {
              base_commit: input.baseCommit,
              current_head: input.currentHead,
              worktree_commit: input.worktreeCommit,
            },
            attributes: sanitizeJsonObject({
              repo_path: input.repoPath,
              chosen_path: "merge_reconciled_submodule_descendant",
            }),
          }, input.correlationIds.mergeAttemptId, repoAttemptId));
          return {
            status: "ready",
            baseCommit: input.currentHead,
            worktreeCommit: await gitHeadCommit(input.worktreePath),
            error: null,
            incidentKind: null,
            incidentDetails: null,
            telemetry,
          };
        }
        if (reconciliation.status === "blocked") {
          telemetry.push(withCorrelationIds({
            event_type: "refresh_decision",
            phase: "host_refresh",
            cause: reconciliation.incidentKind,
            retryable: false,
            recommended_next_actor: "operator",
            command_label: "git.merge.host_refresh",
            command_result: mergeCommandResult,
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
          }, input.correlationIds.mergeAttemptId, repoAttemptId));
          return {
            status: "blocked",
            baseCommit: input.currentHead,
            worktreeCommit: input.worktreeCommit,
            error: reconciliation.error,
            incidentKind: reconciliation.incidentKind,
            incidentDetails: buildBlockedIncidentDetails({
              phase: "host_refresh",
              repoRole,
              repoPath: input.repoPath,
              commandLabel: "git.merge.host_refresh",
              commandResult: mergeCommandResult,
              relevantShas: {
                base_commit: input.baseCommit,
                current_head: input.currentHead,
                worktree_commit: input.worktreeCommit,
              },
              mergeAttemptId: input.correlationIds.mergeAttemptId,
              repoAttemptId,
            }),
            telemetry,
          };
        }
      }

      const unmergedPaths = input.repoPath === "."
        ? await this.readUnmergedPaths(input.worktreePath).catch(() => [])
        : [];
      await gitAbortMerge(input.worktreePath).catch(() => undefined);
      telemetry.push(withCorrelationIds({
        event_type: "refresh_decision",
        phase: input.repoPath === "." ? "host_refresh" : "integration",
        cause: input.repoPath === "." ? "tracked_path_conflict" : "submodule_concurrent_advance",
        retryable: false,
        recommended_next_actor: "operator",
        command_label: "git.merge.host_refresh",
        command_result: mergeCommandResult,
        relevant_shas: {
          base_commit: input.baseCommit,
          current_head: input.currentHead,
          worktree_commit: input.worktreeCommit,
        },
        attributes: sanitizeJsonObject({
          repo_path: input.repoPath,
          chosen_path: "block",
        }),
      }, input.correlationIds.mergeAttemptId, repoAttemptId));
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
        incidentDetails: buildBlockedIncidentDetails({
          phase: input.repoPath === "." ? "host_refresh" : "integration",
          repoRole,
          repoPath: input.repoPath,
          commandLabel: "git.merge.host_refresh",
          commandResult: mergeCommandResult,
          relevantShas: {
            base_commit: input.baseCommit,
            current_head: input.currentHead,
            worktree_commit: input.worktreeCommit,
          },
          touchedPaths: input.repoPath === "." ? dispatchTouchedPaths : [],
          movedPaths: input.repoPath === "." ? hostMovedPaths : [],
          overlappingPaths: input.repoPath === "." ? overlappingPaths(dispatchTouchedPaths, hostMovedPaths) : [],
          unmergedPaths,
          mergeAttemptId: input.correlationIds.mergeAttemptId,
          repoAttemptId,
        }),
        telemetry,
      };
    }

    telemetry.push(withCorrelationIds({
      event_type: "refresh_decision",
      phase: input.repoPath === "." ? "host_refresh" : "integration",
      cause: null,
      retryable: false,
      recommended_next_actor: "none",
      command_label: "git.merge.host_refresh",
      command_result: mergeCommandResult,
      relevant_shas: {
        base_commit: input.baseCommit,
        current_head: input.currentHead,
        worktree_commit: input.worktreeCommit,
      },
      attributes: sanitizeJsonObject({
        repo_path: input.repoPath,
        chosen_path: "merge",
      }),
    }, input.correlationIds.mergeAttemptId, repoAttemptId));
    return {
      status: "ready",
      baseCommit: input.currentHead,
      worktreeCommit: await gitHeadCommit(input.worktreePath),
      error: null,
      incidentKind: null,
      incidentDetails: null,
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
    dispatchTouchedPaths: ReadonlyArray<string>;
    hostMovedPaths: ReadonlyArray<string>;
    correlationIds: MergeBackCorrelationIds;
  }): Promise<{
    status: "ready" | "blocked";
    baseCommit: string;
    worktreeCommit: string | null;
    error: string | null;
    incidentKind: string | null;
    incidentDetails: BlockedIncidentDetails | null;
    telemetry: DispatchPhaseTelemetry[];
  }> {
    const telemetry: DispatchPhaseTelemetry[] = [];
    await runGit(input.worktreePath, ["reset", "--hard", input.currentHead]);
    const replay = await gitCherryPickNoCommit(input.worktreePath, input.worktreeCommit);
    const replayCommandResult = buildCommandResult({
      exitCode: replay.exitCode,
      stdout: replay.stdout,
      stderr: replay.stderr,
      rawCommand: `git cherry-pick --no-commit ${input.worktreeCommit}`,
    });
    if (replay.exitCode !== 0) {
      const unmergedPaths = await this.readUnmergedPaths(input.worktreePath).catch(() => []);
      await gitAbortCherryPick(input.worktreePath).catch(() => undefined);
      await runGit(input.worktreePath, ["reset", "--hard", input.worktreeCommit]).catch(() => undefined);
      telemetry.push(withCorrelationIds({
        event_type: "refresh_decision",
        phase: "host_refresh",
        cause: "tracked_path_conflict",
        retryable: false,
        recommended_next_actor: "operator",
        command_label: "git.cherry_pick.host_refresh",
        command_result: replayCommandResult,
        relevant_shas: {
          base_commit: input.baseCommit,
          current_head: input.currentHead,
          worktree_commit: input.worktreeCommit,
        },
      }, input.correlationIds.mergeAttemptId, input.correlationIds.hostRepoAttemptId));
      return {
        status: "blocked",
        baseCommit: input.currentHead,
        worktreeCommit: input.worktreeCommit,
        error: formatRepoScopedRefreshError(
          ".",
          replay.stderr.trim() || replay.stdout.trim() || `cherry-pick ${input.worktreeCommit} failed`,
        ),
        incidentKind: INCIDENT_TRACKED_PATH_CONFLICT,
        incidentDetails: buildBlockedIncidentDetails({
          phase: "host_refresh",
          repoRole: "host",
          repoPath: ".",
          commandLabel: "git.cherry_pick.host_refresh",
          commandResult: replayCommandResult,
          relevantShas: {
            base_commit: input.baseCommit,
            current_head: input.currentHead,
            worktree_commit: input.worktreeCommit,
          },
          touchedPaths: input.dispatchTouchedPaths,
          movedPaths: input.hostMovedPaths,
          unmergedPaths,
          mergeAttemptId: input.correlationIds.mergeAttemptId,
          repoAttemptId: input.correlationIds.hostRepoAttemptId,
        }),
        telemetry,
      };
    }

    telemetry.push(withCorrelationIds({
      event_type: "refresh_decision",
      phase: "host_refresh",
      cause: null,
      retryable: false,
      recommended_next_actor: "none",
      command_label: "git.cherry_pick.host_refresh",
      command_result: replayCommandResult,
      relevant_shas: {
        base_commit: input.baseCommit,
        current_head: input.currentHead,
        worktree_commit: input.worktreeCommit,
      },
    }, input.correlationIds.mergeAttemptId, input.correlationIds.hostRepoAttemptId));
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
      incidentDetails: null,
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
    mergeAttemptId: string;
    repoAttemptId: string;
    repoRole: "host" | "primary_clone";
  }): Promise<
    | { status: "ready"; publishedCommit: string; retryCount: number; telemetry: DispatchPhaseTelemetry[] }
    | {
      status: "blocked";
      incidentKind: string;
      incidentDetails: BlockedIncidentDetails;
      error: string;
      retryCount: number;
      telemetry: DispatchPhaseTelemetry[];
    }
  > {
    const telemetry: DispatchPhaseTelemetry[] = [];
    try {
      const target = await gitResolveCanonicalRefTarget(input.repoRoot);
      if (!target) {
        telemetry.push(withCorrelationIds({
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
        }, input.mergeAttemptId, input.repoAttemptId));
        return {
          status: "blocked",
          incidentKind: INCIDENT_MERGE_BACK_PUBLISH_FAILED,
          incidentDetails: buildBlockedIncidentDetails({
            phase: "publish",
            repoRole: input.repoRole,
            repoPath: input.repoPath,
            commandLabel: "git.push.canonical",
            relevantShas: {
              base_commit: input.baseCommit,
              integrated_commit: input.commit,
            },
            mergeAttemptId: input.mergeAttemptId,
            repoAttemptId: input.repoAttemptId,
          }),
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
        const pushCommandResult = buildCommandResult({
          exitCode: push.exitCode,
          stdout: push.stdout,
          stderr: push.stderr,
          rawCommand: `git push ${target.remoteName} ${currentCommit}:${target.fullRef}`,
        });
        telemetry.push(withCorrelationIds({
          event_type: "publish_attempt",
          phase: "publish",
          cause: push.exitCode === 0 ? null : "merge_back_publish_failed",
          retryable: false,
          recommended_next_actor: push.exitCode === 0 ? "none" : "operator",
          command_label: "git.push.canonical",
          command_result: pushCommandResult,
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
        }, input.mergeAttemptId, input.repoAttemptId));
        if (push.exitCode === 0) {
          const remoteCommit = await gitRemoteRefCommit(input.repoRoot, target.remoteName, target.fullRef);
          if (remoteCommit !== currentCommit) {
            telemetry.push(withCorrelationIds({
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
            }, input.mergeAttemptId, input.repoAttemptId));
            return {
              status: "blocked",
              incidentKind: INCIDENT_CANONICAL_UPSTREAM_UNSYNCED,
              incidentDetails: buildBlockedIncidentDetails({
                phase: "publish",
                repoRole: input.repoRole,
                repoPath: input.repoPath,
                commandLabel: "git.push.canonical",
                commandResult: pushCommandResult,
                relevantShas: {
                  base_commit: input.baseCommit,
                  integrated_commit: currentCommit,
                  remote_head_before: remoteHeadBefore,
                  remote_head_after: remoteCommit,
                },
                canonicalRef: targetName,
                mergeAttemptId: input.mergeAttemptId,
                repoAttemptId: input.repoAttemptId,
              }),
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
            telemetry: telemetry.concat(withCorrelationIds({
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
            }, input.mergeAttemptId, input.repoAttemptId)),
          };
        }

        const pushMessage = push.stderr.trim() || push.stdout.trim() || "Push failed";
        if (!isNonFastForwardPushFailure(pushMessage)) {
          return {
            status: "blocked",
            incidentKind: INCIDENT_MERGE_BACK_PUBLISH_FAILED,
            incidentDetails: buildBlockedIncidentDetails({
              phase: "publish",
              repoRole: input.repoRole,
              repoPath: input.repoPath,
              commandLabel: "git.push.canonical",
              commandResult: pushCommandResult,
              relevantShas: {
                base_commit: input.baseCommit,
                integrated_commit: currentCommit,
                remote_head_before: remoteHeadBefore,
              },
              canonicalRef: targetName,
              mergeAttemptId: input.mergeAttemptId,
              repoAttemptId: input.repoAttemptId,
            }),
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
          telemetry.push(withCorrelationIds({
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
          }, input.mergeAttemptId, input.repoAttemptId));
          return {
            status: "blocked",
            incidentKind: INCIDENT_MERGE_BACK_PUBLISH_FAILED,
            incidentDetails: buildBlockedIncidentDetails({
              phase: "publish",
              repoRole: input.repoRole,
              repoPath: input.repoPath,
              commandLabel: "git.push.canonical",
              commandResult: pushCommandResult,
              relevantShas: {
                base_commit: input.baseCommit,
                integrated_commit: currentCommit,
                remote_head_before: remoteHeadBefore,
              },
              canonicalRef: targetName,
              mergeAttemptId: input.mergeAttemptId,
              repoAttemptId: input.repoAttemptId,
            }),
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
        const fetchCommandResult = buildCommandResult({
          exitCode: fetch.exitCode,
          stdout: fetch.stdout,
          stderr: fetch.stderr,
          rawCommand: `git fetch ${target.remoteName} ${target.fullRef} ${trackingRef}`,
        });
        telemetry.push(withCorrelationIds({
          event_type: "publish_replay",
          phase: "publish",
          cause: fetch.exitCode === 0 ? null : "merge_back_publish_failed",
          retryable: false,
          recommended_next_actor: fetch.exitCode === 0 ? "automation" : "operator",
          command_label: "git.fetch.canonical",
          command_result: fetchCommandResult,
          relevant_shas: {
            base_commit: input.baseCommit,
            integrated_commit: currentCommit,
          },
          attributes: sanitizeJsonObject({
            repo_path: input.repoPath,
            canonical_ref: targetName,
            retry_count: retryCount,
          }),
        }, input.mergeAttemptId, input.repoAttemptId));
        if (fetch.exitCode !== 0) {
          return {
            status: "blocked",
            incidentKind: INCIDENT_MERGE_BACK_PUBLISH_FAILED,
            incidentDetails: buildBlockedIncidentDetails({
              phase: "publish",
              repoRole: input.repoRole,
              repoPath: input.repoPath,
              commandLabel: "git.fetch.canonical",
              commandResult: fetchCommandResult,
              relevantShas: {
                base_commit: input.baseCommit,
                integrated_commit: currentCommit,
              },
              canonicalRef: targetName,
              mergeAttemptId: input.mergeAttemptId,
              repoAttemptId: input.repoAttemptId,
            }),
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
            incidentDetails: buildBlockedIncidentDetails({
              phase: "publish",
              repoRole: input.repoRole,
              repoPath: input.repoPath,
              commandLabel: "git.merge-base.publish_replay",
              relevantShas: {
                base_commit: input.baseCommit,
                integrated_commit: currentCommit,
                remote_head_after: remoteCommit,
              },
              canonicalRef: targetName,
              mergeAttemptId: input.mergeAttemptId,
              repoAttemptId: input.repoAttemptId,
            }),
            error: formatRepoScopedPublishError(
              input.repoPath,
              targetName,
              currentCommit,
              `canonical upstream moved below recorded base ${input.baseCommit} -> ${remoteCommit}; automatic replay requires an ancestor-preserving remote`,
            ),
            retryCount,
            telemetry: telemetry.concat(withCorrelationIds({
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
            }, input.mergeAttemptId, input.repoAttemptId)),
          };
        }

        const remoteMovedPaths = await gitChangedFilesBetween(
          input.repoRoot,
          input.baseCommit,
          remoteCommit,
        );
        const conflictingPaths = overlappingPaths(input.dispatchTouchedPaths, remoteMovedPaths);
        if (conflictingPaths.length > 0) {
          telemetry.push(withCorrelationIds({
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
          }, input.mergeAttemptId, input.repoAttemptId));
          return {
            status: "blocked",
            incidentKind: INCIDENT_MERGE_BACK_PUBLISH_FAILED,
            incidentDetails: buildBlockedIncidentDetails({
              phase: "publish",
              repoRole: input.repoRole,
              repoPath: input.repoPath,
              commandLabel: "git.diff.publish_replay_overlap",
              relevantShas: {
                base_commit: input.baseCommit,
                integrated_commit: currentCommit,
                remote_head_after: remoteCommit,
              },
              touchedPaths: input.dispatchTouchedPaths,
              movedPaths: remoteMovedPaths,
              overlappingPaths: conflictingPaths,
              canonicalRef: targetName,
              mergeAttemptId: input.mergeAttemptId,
              repoAttemptId: input.repoAttemptId,
            }),
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
          const rebaseCommandResult = buildCommandResult({
            exitCode: rebase.exitCode,
            stdout: rebase.stdout,
            stderr: rebase.stderr,
            rawCommand: `git rebase ${trackingRef}`,
          });
          telemetry.push(withCorrelationIds({
            event_type: "publish_replay",
            phase: "publish",
            cause: "merge_back_publish_failed",
            retryable: false,
            recommended_next_actor: "operator",
            command_label: "git.rebase.publish_replay",
            command_result: rebaseCommandResult,
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
          }, input.mergeAttemptId, input.repoAttemptId));
          return {
            status: "blocked",
            incidentKind: INCIDENT_MERGE_BACK_PUBLISH_FAILED,
            incidentDetails: buildBlockedIncidentDetails({
              phase: "publish",
              repoRole: input.repoRole,
              repoPath: input.repoPath,
              commandLabel: "git.rebase.publish_replay",
              commandResult: rebaseCommandResult,
              relevantShas: {
                base_commit: input.baseCommit,
                integrated_commit: currentCommit,
                remote_head_after: remoteCommit,
              },
              unmergedPaths: rebaseConflictPaths,
              canonicalRef: targetName,
              mergeAttemptId: input.mergeAttemptId,
              repoAttemptId: input.repoAttemptId,
            }),
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

        const rebaseCommandResult = buildCommandResult({
          exitCode: rebase.exitCode,
          stdout: rebase.stdout,
          stderr: rebase.stderr,
          rawCommand: `git rebase ${trackingRef}`,
        });
        telemetry.push(withCorrelationIds({
          event_type: "publish_replay",
          phase: "publish",
          cause: null,
          retryable: false,
          recommended_next_actor: "automation",
          command_label: "git.rebase.publish_replay",
          command_result: rebaseCommandResult,
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
        }, input.mergeAttemptId, input.repoAttemptId));
        currentCommit = await gitHeadCommit(input.repoRoot);
      }
    } catch (error) {
      telemetry.push(withCorrelationIds({
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
      }, input.mergeAttemptId, input.repoAttemptId));
      return {
        status: "blocked",
        incidentKind: INCIDENT_MERGE_BACK_PUBLISH_FAILED,
        incidentDetails: buildBlockedIncidentDetails({
          phase: "publish",
          repoRole: input.repoRole,
          repoPath: input.repoPath,
          commandLabel: "git.push.canonical",
          relevantShas: {
            base_commit: input.baseCommit,
            integrated_commit: input.commit,
          },
          mergeAttemptId: input.mergeAttemptId,
          repoAttemptId: input.repoAttemptId,
        }),
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

function withCorrelationIds(
  event: DispatchPhaseTelemetry,
  mergeAttemptId: string,
  repoAttemptId: string | null = null,
): DispatchPhaseTelemetry {
  return {
    ...event,
    merge_attempt_id: mergeAttemptId,
    repo_attempt_id: repoAttemptId,
  };
}

function resolveRepoAttemptId(
  correlationIds: MergeBackCorrelationIds,
  repoPath: string,
): string {
  if (repoPath === ".") {
    return correlationIds.hostRepoAttemptId;
  }

  return correlationIds.mountedRepoAttemptIds[normalizeRepoPath(repoPath)] ?? correlationIds.hostRepoAttemptId;
}

function buildBlockedIncidentDetails(input: {
  phase: string;
  repoRole: string | null;
  repoPath: string | null;
  commandLabel: string | null;
  commandResult?: BlockedIncidentDetails["commandResult"];
  relevantShas?: BlockedIncidentDetails["relevantShas"];
  dirtyPaths?: ReadonlyArray<string>;
  touchedPaths?: ReadonlyArray<string>;
  movedPaths?: ReadonlyArray<string>;
  overlappingPaths?: ReadonlyArray<string>;
  unmergedPaths?: ReadonlyArray<string>;
  recoveryHint?: string | null;
  canonicalRef?: string | null;
  mergeAttemptId: string;
  repoAttemptId: string | null;
}): BlockedIncidentDetails {
  return {
    phase: input.phase,
    repoRole: input.repoRole,
    repoPath: input.repoPath,
    commandLabel: input.commandLabel,
    commandResult: input.commandResult ?? null,
    relevantShas: input.relevantShas ?? null,
    dirtyPaths: [...input.dirtyPaths ?? []],
    touchedPaths: [...input.touchedPaths ?? []],
    movedPaths: [...input.movedPaths ?? []],
    overlappingPaths: [...input.overlappingPaths ?? []],
    unmergedPaths: [...input.unmergedPaths ?? []],
    recoveryHint: input.recoveryHint ?? null,
    canonicalRef: input.canonicalRef ?? null,
    mergeAttemptId: input.mergeAttemptId,
    repoAttemptId: input.repoAttemptId,
  };
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
