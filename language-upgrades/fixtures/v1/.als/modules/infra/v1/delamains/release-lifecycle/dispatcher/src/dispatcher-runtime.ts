import { buildDispatchCommitMessage } from "./dispatch-commit.js";
import { DispatchRegistry, type RegistryStatusRelease } from "./dispatch-registry.js";
import { readFrontmatterField } from "./frontmatter.js";
import {
  GitWorktreeIsolationStrategy,
  type IsolatedDispatch,
} from "./git-worktree-isolation.js";
import { OrphanSweeper, type OrphanSweepSummary } from "./orphan-sweeper.js";
import { RepoMutationLock } from "./repo-mutation-lock.js";
import type {
  RuntimeDispatchRecord,
  RuntimeMountedSubmoduleRecord,
} from "./runtime-state.js";
import type { ProviderDispatchCounts } from "./provider.js";
import type { DispatchEntry } from "./dispatcher.js";

export interface DispatcherRuntimeConfig {
  bundleRoot: string;
  systemRoot: string;
  delamainName: string;
  statusField: string;
  pollMs: number;
  worktreeRoot?: string;
  submodules?: string[];
}

export interface PreparedDispatch extends IsolatedDispatch {
  startedAt: string;
}

export interface FinalizeDispatchInput {
  prepared: PreparedDispatch;
  entry: DispatchEntry;
  sessionId: string | null;
  durationMs: number | null;
  numTurns: number | null;
  costUsd: number | null;
  success: boolean;
}

export interface FinalizeDispatchResult {
  success: boolean;
  blocked: boolean;
  finalState: string;
  mergeOutcome: "merged" | "blocked" | "no_changes" | "skipped";
  worktreeCommit: string | null;
  integratedCommit: string | null;
  mountedSubmodules: RuntimeMountedSubmoduleRecord[];
  incidentKind: string | null;
  incidentMessage: string | null;
}

export interface DispatcherRuntimeHeartbeat {
  active_dispatches: number;
  active_by_provider: ProviderDispatchCounts;
  blocked_dispatches: number;
  orphaned_dispatches: number;
  guarded_dispatches: number;
}

export class DispatcherRuntime {
  private readonly registry: DispatchRegistry;
  private readonly isolation: GitWorktreeIsolationStrategy;
  private readonly repoMutationLock: RepoMutationLock;
  private readonly orphanSweeper: OrphanSweeper;
  private readonly statusField: string;
  private readonly delamainName: string;

  constructor(config: DispatcherRuntimeConfig) {
    this.registry = new DispatchRegistry(config.bundleRoot);
    this.isolation = new GitWorktreeIsolationStrategy({
      systemRoot: config.systemRoot,
      delamainName: config.delamainName,
      worktreeRoot: config.worktreeRoot,
      submodules: config.submodules ?? [],
    });
    this.repoMutationLock = new RepoMutationLock(config.systemRoot, {
      staleMs: Math.max(config.pollMs * 4, 60_000),
    });
    this.orphanSweeper = new OrphanSweeper(
      this.registry,
      this.isolation,
      this.repoMutationLock,
      {
        staleDispatchMs: Math.max(config.pollMs * 4, 60_000),
      },
    );
    this.statusField = config.statusField;
    this.delamainName = config.delamainName;
  }

  async prepareDispatch(
    itemId: string,
    itemFile: string,
    entry: DispatchEntry,
  ): Promise<PreparedDispatch | null> {
    const existing = await this.registry.getByItemId(itemId);
    if (existing) {
      return null;
    }

    const prepared = await this.isolation.prepareDispatch({
      dispatchId: buildDispatchId(),
      itemId,
      itemFile,
    });
    const record = buildActiveRecord(this.delamainName, prepared, entry);

    const claimed = await this.registry.create(record);
    if (!claimed) {
      await this.isolation.cleanupDispatch({
        worktreePath: prepared.worktreePath,
        branchName: prepared.branchName,
        mountedSubmodules: buildCleanupMountedSubmodules(prepared.mountedSubmodules),
      });
      return null;
    }

    return {
      ...prepared,
      startedAt: record.started_at,
    };
  }

  async touchDispatch(dispatchId: string): Promise<void> {
    await this.registry.touchDispatch(dispatchId);
  }

  async finalizeDispatch(input: FinalizeDispatchInput): Promise<FinalizeDispatchResult> {
    const finalState = await readFrontmatterField(
      input.prepared.isolatedItemFile,
      this.statusField,
    ) ?? input.entry.state;
    const inspection = await this.isolation.inspectWorktree({
      worktreePath: input.prepared.worktreePath,
      baseCommit: input.prepared.baseCommit,
      mountedSubmodules: input.prepared.mountedSubmodules.map((entry) => ({
        repo_path: entry.repoPath,
        worktree_path: entry.worktreePath,
        base_commit: entry.baseCommit,
      })),
    });

    if (!input.success) {
      if (inspection.pristine) {
        await this.isolation.cleanupDispatch({
          worktreePath: input.prepared.worktreePath,
          branchName: input.prepared.branchName,
          mountedSubmodules: buildCleanupMountedSubmodules(input.prepared.mountedSubmodules),
        });
        await this.registry.removeByItemId(input.prepared.itemId);
        return {
          success: false,
          blocked: false,
          finalState,
          mergeOutcome: "skipped",
          worktreeCommit: null,
          integratedCommit: null,
          mountedSubmodules: [],
          incidentKind: null,
          incidentMessage: null,
        };
      }

      const incidentMessage = "Agent run failed after mutating the isolated worktree";
      const mountedSubmodules = mergeMountedSubmoduleMetadata(
        input.prepared.mountedSubmodules,
        inspection.mountedSubmodules.map((entry) => ({
          repoPath: entry.repoPath,
          worktreeCommit: entry.headCommit,
          integratedCommit: null,
        })),
      );
      await this.registry.updateByItemId(input.prepared.itemId, (record) => ({
        ...record,
        status: "blocked",
        updated_at: new Date().toISOString(),
        latest_error: incidentMessage,
        latest_session_id: input.sessionId,
        latest_duration_ms: input.durationMs,
        latest_num_turns: input.numTurns,
        latest_cost_usd: input.costUsd,
        merge_outcome: "blocked",
        mounted_submodules: mountedSubmodules,
        incident: {
          kind: "dispatch_failed_dirty",
          message: incidentMessage,
          detected_at: new Date().toISOString(),
        },
      }));

      return {
        success: false,
        blocked: true,
        finalState,
        mergeOutcome: "blocked",
        worktreeCommit: inspection.headCommit,
        integratedCommit: null,
        mountedSubmodules,
        incidentKind: "dispatch_failed_dirty",
        incidentMessage,
      };
    }

    if (inspection.pristine) {
      await this.isolation.cleanupDispatch({
        worktreePath: input.prepared.worktreePath,
        branchName: input.prepared.branchName,
        mountedSubmodules: buildCleanupMountedSubmodules(input.prepared.mountedSubmodules),
      });
      await this.completeSuccessfulGuard(input, finalState, null, null, [], "no_changes");
      return {
        success: true,
        blocked: false,
        finalState,
        mergeOutcome: "no_changes",
        worktreeCommit: null,
        integratedCommit: null,
        mountedSubmodules: [],
        incidentKind: null,
        incidentMessage: null,
      };
    }

    const commitMessage = buildDispatchCommitMessage({
      dispatchId: input.prepared.dispatchId,
      dispatcherName: this.delamainName,
      itemId: input.prepared.itemId,
      agentName: input.entry.agentName,
      fromState: input.entry.state,
      toState: finalState,
      durationMs: input.durationMs,
      numTurns: input.numTurns,
      costUsd: input.costUsd,
      sessionId: input.sessionId,
    });

    const mountedSubmoduleCommits = [];
    for (const entry of input.prepared.mountedSubmodules) {
      const worktreeCommit = await this.isolation.commitDispatch(
        entry.worktreePath,
        entry.baseCommit,
        commitMessage,
      );
      mountedSubmoduleCommits.push({
        repoPath: entry.repoPath,
        worktreeCommit,
        integratedCommit: null,
      });
    }

    let hostWorktreeCommit = await this.isolation.commitDispatch(
      input.prepared.worktreePath,
      input.prepared.baseCommit,
      commitMessage,
    );
    let refreshedMountedSubmodules = mountedSubmoduleCommits;
    const mergeResult = await this.repoMutationLock.withLease(
      {
        dispatch_id: input.prepared.dispatchId,
        dispatcher_name: this.delamainName,
        item_id: input.prepared.itemId,
        worktree_path: input.prepared.worktreePath,
      },
      async () => {
        const refreshResult = await this.isolation.refreshMergeBack({
          prepared: input.prepared,
          hostWorktreeCommit,
          mountedSubmodules: refreshedMountedSubmodules,
        });
        hostWorktreeCommit = refreshResult.hostWorktreeCommit;
        refreshedMountedSubmodules = refreshResult.mountedSubmodules;

        const refreshedMetadata = mergeMountedSubmoduleMetadata(
          input.prepared.mountedSubmodules,
          refreshedMountedSubmodules,
        );
        try {
          await this.registry.updateByItemId(input.prepared.itemId, (record) => ({
            ...record,
            updated_at: new Date().toISOString(),
            base_commit: input.prepared.baseCommit,
            worktree_commit: hostWorktreeCommit,
            mounted_submodules: refreshedMetadata,
            merge_message: commitMessage,
          }));
        } catch (error) {
          return {
            status: "blocked",
            worktreeCommit: hostWorktreeCommit,
            integratedCommit: null,
            mountedSubmodules: refreshedMountedSubmodules,
            error: error instanceof Error ? error.message : String(error),
            incidentKind: "merge_back_failed",
          };
        }

        if (refreshResult.status !== "ready") {
          return {
            status: "blocked",
            worktreeCommit: hostWorktreeCommit,
            integratedCommit: null,
            mountedSubmodules: refreshedMountedSubmodules,
            error: refreshResult.error,
            incidentKind: refreshResult.incidentKind,
          };
        }

        return this.isolation.mergeBack({
          prepared: input.prepared,
          hostCommitMessage: commitMessage,
          mountedSubmodules: refreshedMountedSubmodules,
        });
      },
    );

    const mergedMountedSubmodules = mergeMountedSubmoduleMetadata(
      input.prepared.mountedSubmodules,
      mergeResult.mountedSubmodules,
    );

    if (mergeResult.status !== "merged") {
      const incidentDetectedAt = new Date().toISOString();
      await this.registry.updateByItemId(input.prepared.itemId, (record) => ({
        ...record,
        status: "blocked",
        updated_at: incidentDetectedAt,
        latest_error: mergeResult.error,
        latest_session_id: input.sessionId,
        latest_duration_ms: input.durationMs,
        latest_num_turns: input.numTurns,
        latest_cost_usd: input.costUsd,
        worktree_commit: mergeResult.worktreeCommit,
        mounted_submodules: mergedMountedSubmodules,
        merge_outcome: "blocked",
        merge_attempted_at: incidentDetectedAt,
        merge_message: commitMessage,
        incident: {
          kind: mergeResult.incidentKind ?? "merge_blocked",
          message: mergeResult.error ?? "Merge back blocked",
          detected_at: incidentDetectedAt,
        },
      }));

      return {
        success: false,
        blocked: true,
        finalState,
        mergeOutcome: "blocked",
        worktreeCommit: mergeResult.worktreeCommit,
        integratedCommit: null,
        mountedSubmodules: mergedMountedSubmodules,
        incidentKind: mergeResult.incidentKind,
        incidentMessage: mergeResult.error,
      };
    }

    try {
      await this.isolation.cleanupDispatch({
        worktreePath: input.prepared.worktreePath,
        branchName: input.prepared.branchName,
        mountedSubmodules: buildCleanupMountedSubmodules(input.prepared.mountedSubmodules),
      });
    } catch (error) {
      const incidentMessage = error instanceof Error ? error.message : String(error);
      await this.registry.updateByItemId(input.prepared.itemId, (record) => ({
        ...record,
        status: "blocked",
        updated_at: new Date().toISOString(),
        latest_error: incidentMessage,
        latest_session_id: input.sessionId,
        latest_duration_ms: input.durationMs,
        latest_num_turns: input.numTurns,
        latest_cost_usd: input.costUsd,
        worktree_commit: mergeResult.worktreeCommit,
        integrated_commit: mergeResult.integratedCommit,
        mounted_submodules: mergedMountedSubmodules,
        merge_outcome: "merged",
        merge_attempted_at: new Date().toISOString(),
        merge_message: commitMessage,
        incident: {
          kind: "cleanup_failed",
          message: incidentMessage,
          detected_at: new Date().toISOString(),
        },
      }));

      return {
        success: true,
        blocked: true,
        finalState,
        mergeOutcome: "merged",
        worktreeCommit: mergeResult.worktreeCommit,
        integratedCommit: mergeResult.integratedCommit,
        mountedSubmodules: mergedMountedSubmodules,
        incidentKind: "cleanup_failed",
        incidentMessage,
      };
    }

    await this.completeSuccessfulGuard(
      input,
      finalState,
      mergeResult.worktreeCommit,
      mergeResult.integratedCommit,
      mergedMountedSubmodules,
      "merged",
    );

    return {
      success: true,
      blocked: false,
      finalState,
      mergeOutcome: "merged",
      worktreeCommit: mergeResult.worktreeCommit,
      integratedCommit: mergeResult.integratedCommit,
      mountedSubmodules: mergedMountedSubmodules,
      incidentKind: null,
      incidentMessage: null,
    };
  }

  async reconcileObservedItems(
    items: ReadonlyArray<{ id: string; status: string }>,
  ): Promise<RegistryStatusRelease[]> {
    return this.registry.reconcileObservedItems(items);
  }

  async hasOpenRecord(itemId: string): Promise<boolean> {
    return (await this.registry.getByItemId(itemId)) !== null;
  }

  async heartbeat(): Promise<DispatcherRuntimeHeartbeat> {
    const summary = await this.registry.summary();

    return {
      active_dispatches: summary.activeCount,
      active_by_provider: summary.activeByProvider,
      blocked_dispatches: summary.blockedCount,
      orphaned_dispatches: summary.orphanedCount,
      guarded_dispatches: summary.guardedCount,
    };
  }

  async sweepOrphans(): Promise<OrphanSweepSummary> {
    return this.orphanSweeper.sweep();
  }

  private async completeSuccessfulGuard(
    input: FinalizeDispatchInput,
    finalState: string,
    worktreeCommit: string | null,
    integratedCommit: string | null,
    mountedSubmodules: RuntimeMountedSubmoduleRecord[],
    mergeOutcome: "merged" | "no_changes",
  ): Promise<void> {
    const shouldPersistGuard = finalState === input.entry.state;

    if (!shouldPersistGuard) {
      await this.registry.removeByItemId(input.prepared.itemId);
      return;
    }

    await this.registry.updateByItemId(input.prepared.itemId, (record) => ({
      ...record,
      status: "guarded",
      worktree_path: null,
      branch_name: null,
      isolated_item_file: null,
      mounted_submodules: [],
      updated_at: new Date().toISOString(),
      heartbeat_at: null,
      worktree_commit: worktreeCommit,
      integrated_commit: integratedCommit,
      merge_outcome: mergeOutcome,
      merge_attempted_at: mergeOutcome === "merged" ? new Date().toISOString() : null,
      latest_error: null,
      latest_session_id: input.sessionId,
      latest_duration_ms: input.durationMs,
      latest_num_turns: input.numTurns,
      latest_cost_usd: input.costUsd,
      incident: null,
    }));
    void mountedSubmodules;
  }
}

function buildDispatchId(): string {
  return `d-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function buildActiveRecord(
  dispatcherName: string,
  prepared: PreparedDispatch | IsolatedDispatch,
  entry: DispatchEntry,
): RuntimeDispatchRecord {
  const now = new Date().toISOString();
  return {
    dispatch_id: prepared.dispatchId,
    item_id: prepared.itemId,
    item_file: prepared.itemFile,
    isolated_item_file: prepared.isolatedItemFile,
    state: entry.state,
    agent_name: entry.agentName,
    dispatcher_name: dispatcherName,
    provider: entry.provider,
    resumable: entry.resumable,
    session_field: entry.sessionField ?? null,
    status: "active",
    worktree_path: prepared.worktreePath,
    branch_name: prepared.branchName,
    base_commit: prepared.baseCommit,
    mounted_submodules: prepared.mountedSubmodules.map((entry) => ({
      repo_path: entry.repoPath,
      primary_repo_path: entry.primaryRepoPath,
      worktree_path: entry.worktreePath,
      branch_name: entry.branchName,
      base_commit: entry.baseCommit,
      worktree_commit: null,
      integrated_commit: null,
    })),
    worktree_commit: null,
    integrated_commit: null,
    started_at: now,
    updated_at: now,
    heartbeat_at: now,
    owner_pid: process.pid,
    transition_targets: entry.transitions.map((transition) => transition.to),
    merge_outcome: "pending",
    merge_attempted_at: null,
    merge_message: null,
    latest_error: null,
    latest_session_id: null,
    latest_duration_ms: null,
    latest_num_turns: null,
    latest_cost_usd: null,
    incident: null,
  };
}

function buildCleanupMountedSubmodules(
  mountedSubmodules: ReadonlyArray<PreparedDispatch["mountedSubmodules"][number]>,
): Array<{
  repo_path: string;
  primary_repo_path: string;
  worktree_path: string;
  branch_name: string;
}> {
  return mountedSubmodules.map((entry) => ({
    repo_path: entry.repoPath,
    primary_repo_path: entry.primaryRepoPath,
    worktree_path: entry.worktreePath,
    branch_name: entry.branchName,
  }));
}

function mergeMountedSubmoduleMetadata(
  mountedSubmodules: ReadonlyArray<PreparedDispatch["mountedSubmodules"][number]>,
  updates: ReadonlyArray<{
    repoPath: string;
    worktreeCommit: string | null;
    integratedCommit: string | null;
  }>,
): RuntimeMountedSubmoduleRecord[] {
  const updatesByPath = new Map(updates.map((entry) => [entry.repoPath, entry]));
  return mountedSubmodules.map((entry) => {
    const update = updatesByPath.get(entry.repoPath);
    return {
      repo_path: entry.repoPath,
      primary_repo_path: entry.primaryRepoPath,
      worktree_path: entry.worktreePath,
      branch_name: entry.branchName,
      base_commit: entry.baseCommit,
      worktree_commit: update?.worktreeCommit ?? null,
      integrated_commit: update?.integratedCommit ?? null,
    };
  });
}
