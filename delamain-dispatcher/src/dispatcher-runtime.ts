import { buildDispatchCommitMessage } from "./dispatch-commit.js";
import { DispatchRegistry, type RegistryStatusRelease } from "./dispatch-registry.js";
import { readFrontmatterField } from "./frontmatter.js";
import {
  GitWorktreeIsolationStrategy,
  type IsolatedDispatch,
  type MergeBackCorrelationIds,
  type MountedSubmoduleWorktree,
} from "./git-worktree-isolation.js";
import { OrphanSweeper, type OrphanSweepSummary } from "./orphan-sweeper.js";
import { ensurePrimaryClonePreCommitGuards } from "./primary-clone-convergence.js";
import { RepoMutationLock } from "./repo-mutation-lock.js";
import type {
  RuntimeDispatchRecord,
  RuntimeMountedSubmoduleRecord,
  RuntimeDispatchSummary,
} from "./runtime-state.js";
import type { ProviderDispatchCounts } from "./provider.js";
import type { DispatchEntry } from "./dispatcher.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  buildIncidentContext,
  sanitizeJsonObject,
  type BlockedIncidentDetails,
  type DispatchCommandResult,
  type DispatchPhaseTelemetry,
  type DispatchIncidentContext,
  type DispatchRelevantShas,
} from "./forensics.js";
import {
  appendTelemetryEvent,
  DISPATCH_TELEMETRY_SCHEMA,
  type DispatchTelemetryEvent,
} from "./telemetry.js";

export interface DispatcherRuntimeConfig {
  bundleRoot: string;
  systemRoot: string;
  delamainName: string;
  moduleId?: string;
  statusField: string;
  pollMs: number;
  worktreeRoot?: string;
  submodules?: string[];
}

export interface PreparedDispatch extends IsolatedDispatch {
  startedAt: string;
  tickId?: string | null;
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
  incidentContext: DispatchIncidentContext | null;
}

export interface DispatcherRuntimeHeartbeat {
  active_dispatches: number;
  active_by_provider: ProviderDispatchCounts;
  blocked_dispatches: number;
  orphaned_dispatches: number;
  guarded_dispatches: number;
}

export const DIRTY_INTEGRATION_RETRY_LIMIT = 60;

const DIRTY_INTEGRATION_INCIDENT = "dirty_integration_checkout";
const PRIMARY_DIRTY_TIMEOUT_INCIDENT = "primary_dirty_timeout";
const PRIMARY_CLONE_HELPER_PATH = fileURLToPath(
  new URL("./primary-clone-convergence.ts", import.meta.url),
);

interface MergeBackPreparedDispatch {
  dispatchId: string;
  itemId: string;
  itemFile: string;
  isolatedItemFile: string;
  worktreePath: string;
  branchName: string;
  baseCommit: string;
  tickId?: string | null;
  mountedSubmodules: MountedSubmoduleWorktree[];
}

interface MountedSubmoduleMergeMetadata {
  repoPath: string;
  worktreeCommit: string | null;
  integratedCommit: string | null;
}

interface MergeBackAttemptInput {
  prepared: MergeBackPreparedDispatch;
  entryState: string;
  finalState: string;
  sessionId: string | null;
  durationMs: number | null;
  numTurns: number | null;
  costUsd: number | null;
  commitMessage: string;
  hostWorktreeCommit: string | null;
  mountedSubmodules: MountedSubmoduleMergeMetadata[];
  dirtyRetryCount: number;
  telemetryBase: RuntimeTelemetryBase;
}

interface MergeBackAttemptOutcome {
  treeState: "clean" | "dirty";
  result: FinalizeDispatchResult;
}

interface RuntimeTelemetryBase {
  tickId: string | null;
  dispatchId: string;
  itemId: string;
  itemFile: string;
  isolatedItemFile: string | null;
  state: string;
  agentName: string;
  provider: RuntimeDispatchRecord["provider"];
  resumable: boolean;
  sessionField: string | null;
  sessionId: string | null;
  durationMs: number | null;
  numTurns: number | null;
  costUsd: number | null;
  worktreePath: string | null;
  branchName: string | null;
  transitionTargets: string[];
}

export interface BlockedDirtyRetryResult {
  itemId: string;
  dispatchId: string;
  attempt: number;
  action: "blocked" | "timed_out" | "merged";
  previousIncidentKind: string;
  treeState: "clean" | "dirty";
  itemFile: string;
  isolatedItemFile: string | null;
  state: string;
  agentName: string;
  provider: RuntimeDispatchRecord["provider"];
  resumable: boolean;
  sessionField: string | null;
  transitionTargets: string[];
  worktreePath: string | null;
  branchName: string | null;
  sessionId: string | null;
  durationMs: number | null;
  numTurns: number | null;
  costUsd: number | null;
  mergeOutcome: FinalizeDispatchResult["mergeOutcome"];
  worktreeCommit: string | null;
  integratedCommit: string | null;
  mountedSubmodules: RuntimeMountedSubmoduleRecord[];
  incidentKind: string | null;
  incidentMessage: string | null;
  incidentContext: DispatchIncidentContext | null;
}

export class DispatcherRuntime {
  private readonly registry: DispatchRegistry;
  private readonly isolation: GitWorktreeIsolationStrategy;
  private readonly repoMutationLock: RepoMutationLock;
  private readonly orphanSweeper: OrphanSweeper;
  private readonly bundleRoot: string;
  private readonly statusField: string;
  private readonly delamainName: string;
  private readonly moduleId: string;
  private readonly systemRoot: string;
  private readonly submodules: string[];

  constructor(config: DispatcherRuntimeConfig) {
    this.bundleRoot = config.bundleRoot;
    this.systemRoot = resolve(config.systemRoot);
    this.submodules = [...config.submodules ?? []];
    this.registry = new DispatchRegistry(config.bundleRoot);
    this.isolation = new GitWorktreeIsolationStrategy({
      systemRoot: this.systemRoot,
      delamainName: config.delamainName,
      worktreeRoot: config.worktreeRoot,
      submodules: this.submodules,
    });
    this.repoMutationLock = new RepoMutationLock(this.systemRoot, {
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
    this.moduleId = config.moduleId ?? "unknown";
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
          incidentContext: null,
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
      const incidentContext = buildRuntimeIncidentContext({
        incidentKind: "dispatch_failed_dirty",
        dispatchId: input.prepared.dispatchId,
        tickId: input.prepared.tickId ?? null,
        worktreePath: input.prepared.worktreePath,
        baseCommit: input.prepared.baseCommit,
        worktreeCommit: inspection.headCommit,
        mountedSubmodules,
        phaseOverride: "provider_run",
        repoRole: "worktree",
        repoPath: ".",
        dirtyPaths: [input.prepared.itemFile],
      });
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
          retry_count: 0,
          incident_context: incidentContext,
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
        incidentContext,
      };
    }

    if (inspection.pristine) {
      await this.isolation.cleanupDispatch({
        worktreePath: input.prepared.worktreePath,
        branchName: input.prepared.branchName,
        mountedSubmodules: buildCleanupMountedSubmodules(input.prepared.mountedSubmodules),
      });
      await this.completeSuccessfulGuard({
        itemId: input.prepared.itemId,
        entryState: input.entry.state,
        finalState,
        sessionId: input.sessionId,
        durationMs: input.durationMs,
        numTurns: input.numTurns,
        costUsd: input.costUsd,
      }, null, null, "no_changes");
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
        incidentContext: null,
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

    const mountedSubmoduleCommits: MountedSubmoduleMergeMetadata[] = [];
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

    const hostWorktreeCommit = await this.isolation.commitDispatch(
      input.prepared.worktreePath,
      input.prepared.baseCommit,
      commitMessage,
    );

    return (
      await this.attemptMergeBack({
        prepared: input.prepared,
        entryState: input.entry.state,
        finalState,
        sessionId: input.sessionId,
        durationMs: input.durationMs,
        numTurns: input.numTurns,
        costUsd: input.costUsd,
        commitMessage,
        hostWorktreeCommit,
        mountedSubmodules: mountedSubmoduleCommits,
        dirtyRetryCount: 0,
        telemetryBase: {
          tickId: input.prepared.tickId ?? null,
          dispatchId: input.prepared.dispatchId,
          itemId: input.prepared.itemId,
          itemFile: input.prepared.itemFile,
          isolatedItemFile: input.prepared.isolatedItemFile,
          state: input.entry.state,
          agentName: input.entry.agentName,
          provider: input.entry.provider,
          resumable: input.entry.resumable,
          sessionField: input.entry.sessionField ?? null,
          sessionId: input.sessionId,
          durationMs: input.durationMs,
          numTurns: input.numTurns,
          costUsd: input.costUsd,
          worktreePath: input.prepared.worktreePath,
          branchName: input.prepared.branchName,
          transitionTargets: input.entry.transitions.map((transition) => transition.to),
        },
      })
    ).result;
  }

  async retryBlockedDirtyDispatches(): Promise<BlockedDirtyRetryResult[]> {
    const records = await this.registry.list();
    const retryable = records.filter((record) => (
      record.status === "blocked"
      && record.incident?.kind === DIRTY_INTEGRATION_INCIDENT
    ));

    const results: BlockedDirtyRetryResult[] = [];
    for (const record of retryable) {
      results.push(await this.retryBlockedDirtyDispatch(record));
    }

    return results;
  }

  async reconcileObservedItems(
    items: ReadonlyArray<{ id: string; status: string }>,
  ): Promise<RegistryStatusRelease[]> {
    return this.registry.reconcileObservedItems(items);
  }

  async hasOpenRecord(itemId: string): Promise<boolean> {
    return (await this.registry.getByItemId(itemId)) !== null;
  }

  async openDispatchSummary(): Promise<RuntimeDispatchSummary> {
    return this.registry.summary();
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

  async ensurePrimaryCloneCommitGuards(): Promise<void> {
    const repoRoots = [
      this.systemRoot,
      ...this.submodules.map((entry) => resolve(this.systemRoot, entry)),
    ];
    await ensurePrimaryClonePreCommitGuards({
      repoRoots,
      helperScriptPath: PRIMARY_CLONE_HELPER_PATH,
    });
  }

  private async retryBlockedDirtyDispatch(
    record: RuntimeDispatchRecord,
  ): Promise<BlockedDirtyRetryResult> {
    const attempt = (record.incident?.retry_count ?? 0) + 1;

    try {
      const prepared = buildPreparedDispatchFromRecord(record);
      if (!prepared) {
        throw new Error("Blocked dispatch is missing merge-back metadata required for retry");
      }

      const finalState = await readFrontmatterField(
        prepared.isolatedItemFile,
        this.statusField,
      ) ?? record.state;
      const commitMessage = record.merge_message ?? buildDispatchCommitMessage({
        dispatchId: record.dispatch_id,
        dispatcherName: this.delamainName,
        itemId: record.item_id,
        agentName: record.agent_name,
        fromState: record.state,
        toState: finalState,
        durationMs: record.latest_duration_ms,
        numTurns: record.latest_num_turns,
        costUsd: record.latest_cost_usd,
        sessionId: record.latest_session_id,
      });

      const outcome = await this.attemptMergeBack({
        prepared,
        entryState: record.state,
        finalState,
        sessionId: record.latest_session_id,
        durationMs: record.latest_duration_ms,
        numTurns: record.latest_num_turns,
        costUsd: record.latest_cost_usd,
        commitMessage,
        hostWorktreeCommit: record.worktree_commit,
        mountedSubmodules: record.mounted_submodules.map((entry) => ({
          repoPath: entry.repo_path,
          worktreeCommit: entry.worktree_commit,
          integratedCommit: entry.integrated_commit,
        })),
        dirtyRetryCount: attempt,
        telemetryBase: {
          tickId: record.incident?.incident_context?.correlation_ids.tick_id ?? null,
          dispatchId: record.dispatch_id,
          itemId: record.item_id,
          itemFile: record.item_file,
          isolatedItemFile: record.isolated_item_file,
          state: record.state,
          agentName: record.agent_name,
          provider: record.provider,
          resumable: record.resumable,
          sessionField: record.session_field,
          sessionId: record.latest_session_id,
          durationMs: record.latest_duration_ms,
          numTurns: record.latest_num_turns,
          costUsd: record.latest_cost_usd,
          worktreePath: record.worktree_path,
          branchName: record.branch_name,
          transitionTargets: [...record.transition_targets],
        },
      });

      return {
        itemId: record.item_id,
        dispatchId: record.dispatch_id,
        attempt,
        action: !outcome.result.blocked
          ? "merged"
          : outcome.result.incidentKind === PRIMARY_DIRTY_TIMEOUT_INCIDENT
            ? "timed_out"
            : "blocked",
        previousIncidentKind: DIRTY_INTEGRATION_INCIDENT,
        treeState: outcome.treeState,
        itemFile: record.item_file,
        isolatedItemFile: prepared.isolatedItemFile,
        state: record.state,
        agentName: record.agent_name,
        provider: record.provider,
        resumable: record.resumable,
        sessionField: record.session_field,
        transitionTargets: [...record.transition_targets],
        worktreePath: prepared.worktreePath,
        branchName: prepared.branchName,
        sessionId: record.latest_session_id,
        durationMs: record.latest_duration_ms,
        numTurns: record.latest_num_turns,
        costUsd: record.latest_cost_usd,
        mergeOutcome: outcome.result.mergeOutcome,
        worktreeCommit: outcome.result.worktreeCommit,
        integratedCommit: outcome.result.integratedCommit,
        mountedSubmodules: outcome.result.mountedSubmodules,
        incidentKind: outcome.result.incidentKind,
        incidentMessage: outcome.result.incidentMessage,
        incidentContext: outcome.result.incidentContext,
      };
    } catch (error) {
      const incidentMessage = error instanceof Error ? error.message : String(error);
      const now = new Date().toISOString();
      const incidentContext = buildRuntimeIncidentContext({
        incidentKind: "merge_back_failed",
        dispatchId: record.dispatch_id,
        tickId: record.incident?.incident_context?.correlation_ids.tick_id ?? null,
        worktreePath: record.worktree_path,
        baseCommit: record.base_commit,
        worktreeCommit: record.worktree_commit,
        integratedCommit: record.integrated_commit,
        mountedSubmodules: record.mounted_submodules,
      });
      await this.registry.updateByItemId(record.item_id, (current) => ({
        ...current,
        status: "blocked",
        updated_at: now,
        latest_error: incidentMessage,
        merge_outcome: "blocked",
        merge_attempted_at: now,
        incident: {
          kind: "merge_back_failed",
          message: incidentMessage,
          detected_at: now,
          retry_count: 0,
          incident_context: incidentContext,
        },
      }));

      return {
        itemId: record.item_id,
        dispatchId: record.dispatch_id,
        attempt,
        action: "blocked",
        previousIncidentKind: DIRTY_INTEGRATION_INCIDENT,
        treeState: "clean",
        itemFile: record.item_file,
        isolatedItemFile: record.isolated_item_file,
        state: record.state,
        agentName: record.agent_name,
        provider: record.provider,
        resumable: record.resumable,
        sessionField: record.session_field,
        transitionTargets: [...record.transition_targets],
        worktreePath: record.worktree_path,
        branchName: record.branch_name,
        sessionId: record.latest_session_id,
        durationMs: record.latest_duration_ms,
        numTurns: record.latest_num_turns,
        costUsd: record.latest_cost_usd,
        mergeOutcome: "blocked",
        worktreeCommit: record.worktree_commit,
        integratedCommit: record.integrated_commit,
        mountedSubmodules: record.mounted_submodules,
        incidentKind: "merge_back_failed",
        incidentMessage,
        incidentContext,
      };
    }
  }

  private async attemptMergeBack(
    input: MergeBackAttemptInput,
  ): Promise<MergeBackAttemptOutcome> {
    let hostWorktreeCommit = input.hostWorktreeCommit;
    let refreshedMountedSubmodules = input.mountedSubmodules;
    let treeState: "clean" | "dirty" = "clean";
    const correlationIds = buildMergeBackCorrelationIds(input.prepared.mountedSubmodules);

    await this.appendRuntimeTelemetry(input.telemetryBase, [
      {
        event_type: "merge_attempt_start",
        phase: "merge_back",
        cause: null,
        retryable: false,
        recommended_next_actor: "none",
        relevant_shas: {
          base_commit: input.prepared.baseCommit,
          worktree_commit: input.hostWorktreeCommit,
        },
        attributes: sanitizeJsonObject({
          final_state: input.finalState,
          dirty_retry_count: input.dirtyRetryCount,
        }),
        merge_attempt_id: correlationIds.mergeAttemptId,
      },
    ]);

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
          commitMessage: input.commitMessage,
          correlationIds,
        });
        hostWorktreeCommit = refreshResult.hostWorktreeCommit;
        refreshedMountedSubmodules = refreshResult.mountedSubmodules;
        await this.appendRuntimeTelemetry(input.telemetryBase, refreshResult.telemetry ?? [], {
          worktreeCommit: hostWorktreeCommit,
          mountedSubmodules: refreshedMountedSubmodules,
        });
        treeState = refreshResult.status === "blocked"
          && refreshResult.incidentKind === DIRTY_INTEGRATION_INCIDENT
          ? "dirty"
          : "clean";

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
            merge_message: input.commitMessage,
          }));
        } catch (error) {
          return {
            status: "blocked",
            worktreeCommit: hostWorktreeCommit,
            integratedCommit: null,
            mountedSubmodules: refreshedMountedSubmodules,
            error: error instanceof Error ? error.message : String(error),
            incidentKind: "merge_back_failed",
            incidentDetails: {
              phase: "merge_back",
              repoRole: "host",
              repoPath: ".",
              mergeAttemptId: correlationIds.mergeAttemptId,
              repoAttemptId: correlationIds.hostRepoAttemptId,
              relevantShas: {
                base_commit: input.prepared.baseCommit,
                worktree_commit: hostWorktreeCommit,
              },
            },
            retryCount: 0,
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
            incidentDetails: refreshResult.incidentDetails,
            retryCount: 0,
          };
        }

        return this.isolation.mergeBack({
          prepared: input.prepared,
          hostCommitMessage: input.commitMessage,
          hostWorktreeCommit,
          mountedSubmodules: refreshedMountedSubmodules,
          correlationIds,
        });
      },
    );

    await this.appendRuntimeTelemetry(input.telemetryBase, mergeResult.telemetry ?? [], {
      worktreeCommit: mergeResult.worktreeCommit,
      integratedCommit: mergeResult.integratedCommit,
      mountedSubmodules: mergeMountedSubmoduleMetadata(
        input.prepared.mountedSubmodules,
        mergeResult.mountedSubmodules,
      ),
      mergeOutcome: mergeResult.status === "merged" ? "merged" : "blocked",
      incidentKind: mergeResult.incidentKind,
      error: mergeResult.error,
    });

    const mergedMountedSubmodules = mergeMountedSubmoduleMetadata(
      input.prepared.mountedSubmodules,
      mergeResult.mountedSubmodules,
    );

    if (mergeResult.status !== "merged") {
      return {
        treeState,
        result: await this.persistBlockedMergeResult({
          dispatchId: input.prepared.dispatchId,
          itemId: input.prepared.itemId,
          tickId: input.prepared.tickId ?? null,
          worktreePath: input.prepared.worktreePath,
          baseCommit: input.prepared.baseCommit,
          finalState: input.finalState,
          sessionId: input.sessionId,
          durationMs: input.durationMs,
          numTurns: input.numTurns,
          costUsd: input.costUsd,
          commitMessage: input.commitMessage,
          mergeResult,
          mountedSubmodules: mergedMountedSubmodules,
          dirtyRetryCount: input.dirtyRetryCount,
          mergeAttemptId: correlationIds.mergeAttemptId,
        }),
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
      const now = new Date().toISOString();
      const incidentContext = buildRuntimeIncidentContext({
        incidentKind: "cleanup_failed",
        dispatchId: input.prepared.dispatchId,
        tickId: input.prepared.tickId ?? null,
        worktreePath: input.prepared.worktreePath,
        baseCommit: input.prepared.baseCommit,
        worktreeCommit: mergeResult.worktreeCommit,
        integratedCommit: mergeResult.integratedCommit,
        mountedSubmodules: mergedMountedSubmodules,
        phaseOverride: "cleanup",
      });
      await this.registry.updateByItemId(input.prepared.itemId, (record) => ({
        ...record,
        status: "blocked",
        updated_at: now,
        latest_error: incidentMessage,
        latest_session_id: input.sessionId,
        latest_duration_ms: input.durationMs,
        latest_num_turns: input.numTurns,
        latest_cost_usd: input.costUsd,
        worktree_commit: mergeResult.worktreeCommit,
        integrated_commit: mergeResult.integratedCommit,
        mounted_submodules: mergedMountedSubmodules,
        merge_outcome: "merged",
        merge_attempted_at: now,
        merge_message: input.commitMessage,
        incident: {
          kind: "cleanup_failed",
          message: incidentMessage,
          detected_at: now,
          retry_count: 0,
          incident_context: incidentContext,
        },
      }));

      return {
        treeState,
        result: {
          success: true,
          blocked: true,
          finalState: input.finalState,
          mergeOutcome: "merged",
          worktreeCommit: mergeResult.worktreeCommit,
          integratedCommit: mergeResult.integratedCommit,
          mountedSubmodules: mergedMountedSubmodules,
          incidentKind: "cleanup_failed",
          incidentMessage,
          incidentContext,
        },
      };
    }

    await this.completeSuccessfulGuard({
      itemId: input.prepared.itemId,
      entryState: input.entryState,
      finalState: input.finalState,
      sessionId: input.sessionId,
      durationMs: input.durationMs,
      numTurns: input.numTurns,
      costUsd: input.costUsd,
    }, mergeResult.worktreeCommit, mergeResult.integratedCommit, "merged");

    return {
      treeState,
      result: {
        success: true,
        blocked: false,
        finalState: input.finalState,
        mergeOutcome: "merged",
        worktreeCommit: mergeResult.worktreeCommit,
        integratedCommit: mergeResult.integratedCommit,
        mountedSubmodules: mergedMountedSubmodules,
        incidentKind: null,
        incidentMessage: null,
        incidentContext: null,
      },
    };
  }

  private async persistBlockedMergeResult(input: {
    dispatchId: string;
    itemId: string;
    tickId: string | null;
    mergeAttemptId: string;
    worktreePath: string;
    baseCommit: string;
    finalState: string;
    sessionId: string | null;
    durationMs: number | null;
    numTurns: number | null;
    costUsd: number | null;
    commitMessage: string;
    mergeResult: {
      worktreeCommit: string | null;
      integratedCommit: string | null;
      error: string | null;
      incidentKind: string | null;
      incidentDetails?: BlockedIncidentDetails | null;
      retryCount: number;
    };
    mountedSubmodules: RuntimeMountedSubmoduleRecord[];
    dirtyRetryCount: number;
  }): Promise<FinalizeDispatchResult> {
    const incidentDetectedAt = new Date().toISOString();
    const blockedIncident = buildBlockedIncident(
      input.mergeResult.incidentKind,
      input.mergeResult.error,
      input.dirtyRetryCount,
      input.mergeResult.retryCount,
    );
    const incidentDetails = input.mergeResult.incidentDetails ?? null;
    const incidentContext = buildRuntimeIncidentContext({
      incidentKind: blockedIncident.kind,
      dispatchId: input.dispatchId,
      tickId: input.tickId,
      mergeAttemptId: incidentDetails?.mergeAttemptId ?? input.mergeAttemptId,
      repoAttemptId: incidentDetails?.repoAttemptId ?? null,
      worktreePath: input.worktreePath,
      baseCommit: input.baseCommit,
      worktreeCommit: input.mergeResult.worktreeCommit,
      integratedCommit: input.mergeResult.integratedCommit,
      mountedSubmodules: input.mountedSubmodules,
      phaseOverride: incidentDetails?.phase ?? inferBlockedIncidentPhase(blockedIncident.kind),
      repoRole: incidentDetails?.repoRole,
      repoPath: incidentDetails?.repoPath,
      commandLabel: incidentDetails?.commandLabel,
      commandResult: incidentDetails?.commandResult,
      relevantShas: incidentDetails?.relevantShas ?? null,
      dirtyPaths: incidentDetails?.dirtyPaths,
      touchedPaths: incidentDetails?.touchedPaths,
      movedPaths: incidentDetails?.movedPaths,
      overlappingPaths: incidentDetails?.overlappingPaths,
      unmergedPaths: incidentDetails?.unmergedPaths,
      retryableOverride: blockedIncident.kind === DIRTY_INTEGRATION_INCIDENT,
      recoveryHint: incidentDetails?.recoveryHint ?? null,
      canonicalRef: incidentDetails?.canonicalRef ?? null,
    });

    await this.registry.updateByItemId(input.itemId, (record) => ({
      ...record,
      status: "blocked",
      updated_at: incidentDetectedAt,
      latest_error: blockedIncident.message,
      latest_session_id: input.sessionId,
      latest_duration_ms: input.durationMs,
      latest_num_turns: input.numTurns,
      latest_cost_usd: input.costUsd,
      worktree_commit: input.mergeResult.worktreeCommit,
      integrated_commit: input.mergeResult.integratedCommit,
      mounted_submodules: input.mountedSubmodules,
      merge_outcome: "blocked",
      merge_attempted_at: incidentDetectedAt,
      merge_message: input.commitMessage,
      incident: {
        ...blockedIncident,
        detected_at: incidentDetectedAt,
        incident_context: incidentContext,
      },
    }));

    return {
      success: false,
      blocked: true,
      finalState: input.finalState,
      mergeOutcome: "blocked",
      worktreeCommit: input.mergeResult.worktreeCommit,
      integratedCommit: input.mergeResult.integratedCommit,
      mountedSubmodules: input.mountedSubmodules,
      incidentKind: blockedIncident.kind,
      incidentMessage: blockedIncident.message,
      incidentContext,
    };
  }

  private async completeSuccessfulGuard(
    input: {
      itemId: string;
      entryState: string;
      finalState: string;
      sessionId: string | null;
      durationMs: number | null;
      numTurns: number | null;
      costUsd: number | null;
    },
    worktreeCommit: string | null,
    integratedCommit: string | null,
    mergeOutcome: "merged" | "no_changes",
  ): Promise<void> {
    const shouldPersistGuard = input.finalState === input.entryState;

    if (!shouldPersistGuard) {
      await this.registry.removeByItemId(input.itemId);
      return;
    }

    await this.registry.updateByItemId(input.itemId, (record) => ({
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
  }

  private async appendRuntimeTelemetry(
    base: RuntimeTelemetryBase,
    events: ReadonlyArray<DispatchPhaseTelemetry>,
    overrides: {
      worktreeCommit?: string | null;
      integratedCommit?: string | null;
      mountedSubmodules?: RuntimeMountedSubmoduleRecord[];
      mergeOutcome?: FinalizeDispatchResult["mergeOutcome"] | null;
      incidentKind?: string | null;
      error?: string | null;
    } = {},
  ): Promise<void> {
    for (const event of events) {
      try {
        const normalizedEvent: DispatchTelemetryEvent = {
          schema: DISPATCH_TELEMETRY_SCHEMA,
          event_id: crypto.randomUUID(),
          event_type: event.event_type,
          timestamp: new Date().toISOString(),
          dispatcher_name: this.delamainName,
          module_id: this.moduleId,
          tick_id: base.tickId,
          dispatch_id: base.dispatchId,
          merge_attempt_id: event.merge_attempt_id ?? null,
          repo_attempt_id: event.repo_attempt_id ?? null,
          item_id: base.itemId,
          item_file: base.itemFile,
          isolated_item_file: base.isolatedItemFile,
          state: base.state,
          agent_name: base.agentName,
          sub_agent_name: null,
          provider: base.provider,
          resumable: base.resumable,
          resume_requested: false,
          session_field: base.sessionField,
          runtime_session_id: base.sessionId,
          resume_session_id: null,
          worker_session_id: base.sessionId,
          worktree_path: base.worktreePath,
          branch_name: base.branchName,
          mounted_submodules: overrides.mountedSubmodules ?? [],
          worktree_commit: overrides.worktreeCommit ?? event.worktree_commit ?? null,
          integrated_commit: overrides.integratedCommit ?? event.integrated_commit ?? null,
          merge_outcome: overrides.mergeOutcome ?? event.merge_outcome ?? null,
          incident_kind: overrides.incidentKind ?? event.incident_kind ?? null,
          phase: event.phase ?? null,
          cause: event.cause ?? null,
          retryable: event.retryable ?? null,
          recommended_next_actor: event.recommended_next_actor ?? null,
          command_label: event.command_label ?? null,
          command_result: event.command_result ?? null,
          relevant_shas: {
            base_commit: event.relevant_shas?.base_commit ?? null,
            current_head: event.relevant_shas?.current_head ?? null,
            worktree_commit: event.relevant_shas?.worktree_commit ?? overrides.worktreeCommit ?? null,
            integrated_commit: event.relevant_shas?.integrated_commit ?? overrides.integratedCommit ?? null,
            remote_head_before: event.relevant_shas?.remote_head_before ?? null,
            remote_head_after: event.relevant_shas?.remote_head_after ?? null,
            theirs_commit: event.relevant_shas?.theirs_commit ?? null,
            pre_integration_head: event.relevant_shas?.pre_integration_head ?? null,
          },
          transition_targets: base.transitionTargets,
          duration_ms: base.durationMs,
          num_turns: base.numTurns,
          cost_usd: base.costUsd,
          error: event.error ?? overrides.error ?? null,
          incident_context: event.incident_context ?? null,
          attributes: sanitizeJsonObject(event.attributes),
        };
        await appendTelemetryEvent(this.bundleRoot, normalizedEvent);
      } catch (error) {
        console.warn(
          `[dispatcher] ${base.itemId} runtime telemetry write failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

function buildDispatchId(): string {
  return `d-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function buildMergeAttemptId(): string {
  return `m-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function buildRepoAttemptId(): string {
  return `r-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function buildMergeBackCorrelationIds(
  mountedSubmodules: ReadonlyArray<MountedSubmoduleWorktree>,
): MergeBackCorrelationIds {
  const mountedRepoAttemptIds = Object.fromEntries(
    mountedSubmodules.map((entry) => [entry.repoPath, buildRepoAttemptId()]),
  );
  return {
    mergeAttemptId: buildMergeAttemptId(),
    hostRepoAttemptId: buildRepoAttemptId(),
    mountedRepoAttemptIds,
  };
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

function buildPreparedDispatchFromRecord(
  record: RuntimeDispatchRecord,
): MergeBackPreparedDispatch | null {
  if (
    !record.isolated_item_file
    || !record.worktree_path
    || !record.branch_name
    || !record.base_commit
  ) {
    return null;
  }

  const mountedSubmodules: MountedSubmoduleWorktree[] = [];
  for (const entry of record.mounted_submodules) {
    if (
      !entry.primary_repo_path
      || !entry.worktree_path
      || !entry.branch_name
      || !entry.base_commit
    ) {
      return null;
    }

    mountedSubmodules.push({
      repoPath: entry.repo_path,
      primaryRepoPath: entry.primary_repo_path,
      worktreePath: entry.worktree_path,
      branchName: entry.branch_name,
      baseCommit: entry.base_commit,
    });
  }

  return {
    dispatchId: record.dispatch_id,
    itemId: record.item_id,
    itemFile: record.item_file,
    isolatedItemFile: record.isolated_item_file,
    worktreePath: record.worktree_path,
    branchName: record.branch_name,
    baseCommit: record.base_commit,
    mountedSubmodules,
  };
}

function buildCleanupMountedSubmodules(
  mountedSubmodules: ReadonlyArray<MountedSubmoduleWorktree>,
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
  mountedSubmodules: ReadonlyArray<MountedSubmoduleWorktree>,
  updates: ReadonlyArray<MountedSubmoduleMergeMetadata>,
): RuntimeMountedSubmoduleRecord[] {
  const updatesByPath = new Map(updates.map((entry) => [entry.repoPath, entry] as const));
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

function buildBlockedIncident(
  incidentKind: string | null,
  incidentMessage: string | null,
  dirtyRetryCount: number,
  incidentRetryCount: number,
): {
  kind: string;
  message: string;
  retry_count: number;
} {
  if (incidentKind === DIRTY_INTEGRATION_INCIDENT) {
    if (dirtyRetryCount > DIRTY_INTEGRATION_RETRY_LIMIT) {
      return {
        kind: PRIMARY_DIRTY_TIMEOUT_INCIDENT,
        message: buildPrimaryDirtyTimeoutMessage(
          incidentMessage ?? "Integration checkout is dirty",
          dirtyRetryCount,
        ),
        retry_count: dirtyRetryCount,
      };
    }

    return {
      kind: DIRTY_INTEGRATION_INCIDENT,
      message: incidentMessage ?? "Integration checkout is dirty",
      retry_count: dirtyRetryCount,
    };
  }

  return {
    kind: incidentKind ?? "merge_blocked",
    message: incidentMessage ?? "Merge back blocked",
    retry_count: incidentRetryCount,
  };
}

function buildPrimaryDirtyTimeoutMessage(message: string, retryCount: number): string {
  return `${message} (timed out after ${retryCount} retry checks)`;
}

function buildRuntimeIncidentContext(input: {
  incidentKind: string;
  dispatchId: string;
  tickId?: string | null;
  mergeAttemptId?: string | null;
  repoAttemptId?: string | null;
  worktreePath?: string | null;
  baseCommit?: string | null;
  worktreeCommit?: string | null;
  integratedCommit?: string | null;
  mountedSubmodules?: ReadonlyArray<RuntimeMountedSubmoduleRecord>;
  phaseOverride?: string | null;
  repoRole?: string | null;
  repoPath?: string | null;
  commandLabel?: string | null;
  commandResult?: DispatchCommandResult | null;
  relevantShas?: Partial<DispatchRelevantShas> | null;
  dirtyPaths?: ReadonlyArray<string>;
  touchedPaths?: ReadonlyArray<string>;
  movedPaths?: ReadonlyArray<string>;
  overlappingPaths?: ReadonlyArray<string>;
  unmergedPaths?: ReadonlyArray<string>;
  retryableOverride?: boolean;
  recommendedNextActor?: "operator" | "automation" | "none";
  recoveryHint?: string | null;
  canonicalRef?: string | null;
}): DispatchIncidentContext {
  const descriptor = describeIncidentKind(input.incidentKind);

  return buildIncidentContext({
    phase: input.phaseOverride ?? descriptor.phase,
    cause: descriptor.cause,
    retryable: input.retryableOverride ?? descriptor.retryable,
    recommended_next_actor: input.recommendedNextActor ?? descriptor.recommendedNextActor,
    repo_role: input.repoRole ?? descriptor.repoRole,
    repo_path: input.repoPath ?? ".",
    command_label: input.commandLabel ?? descriptor.commandLabel,
    command_result: input.commandResult ?? null,
    relevant_shas: {
      base_commit: input.relevantShas?.base_commit ?? input.baseCommit ?? null,
      current_head: input.relevantShas?.current_head ?? null,
      worktree_commit: input.relevantShas?.worktree_commit ?? input.worktreeCommit ?? null,
      integrated_commit: input.relevantShas?.integrated_commit ?? input.integratedCommit ?? null,
      remote_head_before: input.relevantShas?.remote_head_before ?? null,
      remote_head_after: input.relevantShas?.remote_head_after ?? null,
      theirs_commit: input.relevantShas?.theirs_commit ?? null,
      pre_integration_head: input.relevantShas?.pre_integration_head ?? null,
    },
    touched_paths: [...input.touchedPaths ?? []],
    moved_paths: [...input.movedPaths ?? []],
    overlapping_paths: [...input.overlappingPaths ?? []],
    dirty_paths: [...input.dirtyPaths ?? []],
    unmerged_paths: [...input.unmergedPaths ?? []],
    preserved_paths: buildPreservedPaths(input.worktreePath ?? null, input.mountedSubmodules ?? []),
    recovery_hint: input.recoveryHint ?? descriptor.recoveryHint,
    canonical_ref: input.canonicalRef ?? null,
    correlation_ids: {
      tick_id: input.tickId ?? null,
      dispatch_id: input.dispatchId,
      merge_attempt_id: input.mergeAttemptId ?? null,
      repo_attempt_id: input.repoAttemptId ?? null,
    },
  });
}

function buildPreservedPaths(
  worktreePath: string | null,
  mountedSubmodules: ReadonlyArray<RuntimeMountedSubmoduleRecord>,
): string[] {
  const preserved = new Set<string>();
  if (worktreePath) {
    preserved.add(worktreePath);
  }
  for (const entry of mountedSubmodules) {
    if (entry.worktree_path) {
      preserved.add(entry.worktree_path);
    }
  }
  return [...preserved];
}

function inferBlockedIncidentPhase(incidentKind: string): string {
  return describeIncidentKind(incidentKind).phase;
}

function describeIncidentKind(incidentKind: string): {
  phase: string;
  cause: string;
  retryable: boolean;
  repoRole: string;
  commandLabel: string | null;
  recommendedNextActor: "operator" | "automation" | "none";
  recoveryHint: string;
} {
  switch (incidentKind) {
    case "dispatch_failed_dirty":
      return {
        phase: "provider_run",
        cause: "dispatch_failed_dirty",
        retryable: false,
        repoRole: "worktree",
        commandLabel: null,
        recommendedNextActor: "operator",
        recoveryHint: "Inspect the preserved dispatch worktree before retrying.",
      };
    case DIRTY_INTEGRATION_INCIDENT:
      return {
        phase: "dirty_check",
        cause: DIRTY_INTEGRATION_INCIDENT,
        retryable: true,
        repoRole: "host",
        commandLabel: "git.status.integration",
        recommendedNextActor: "operator",
        recoveryHint: "Clean the integration checkout so the dispatcher can retry the blocked merge-back.",
      };
    case PRIMARY_DIRTY_TIMEOUT_INCIDENT:
      return {
        phase: "dirty_check",
        cause: PRIMARY_DIRTY_TIMEOUT_INCIDENT,
        retryable: false,
        repoRole: "host",
        commandLabel: "git.status.integration",
        recommendedNextActor: "operator",
        recoveryHint: "Clean the integration checkout, then manually retry the preserved dispatch.",
      };
    case "tracked_path_conflict":
      return {
        phase: "integration",
        cause: "tracked_path_conflict",
        retryable: false,
        repoRole: "host",
        commandLabel: "git.merge.integration",
        recommendedNextActor: "operator",
        recoveryHint: "Resolve the overlapping path conflict from the preserved worktree before retrying.",
      };
    case "stale_base_conflict":
      return {
        phase: "host_refresh",
        cause: "stale_base_conflict",
        retryable: false,
        repoRole: "host",
        commandLabel: "git.merge-base.host_refresh",
        recommendedNextActor: "operator",
        recoveryHint: "Reconcile the preserved worktree against the rewritten primary history.",
      };
    case "merge_back_publish_failed":
      return {
        phase: "publish",
        cause: "merge_back_publish_failed",
        retryable: false,
        repoRole: "host",
        commandLabel: "git.push.canonical",
        recommendedNextActor: "operator",
        recoveryHint: "Inspect the preserved merge-back result and remote movement before retrying publication.",
      };
    case "canonical_upstream_unsynced":
      return {
        phase: "publish",
        cause: "canonical_upstream_unsynced",
        retryable: false,
        repoRole: "host",
        commandLabel: "git.push.canonical",
        recommendedNextActor: "operator",
        recoveryHint: "Verify the canonical upstream head before replaying or retrying the preserved dispatch.",
      };
    case "submodule_concurrent_advance":
      return {
        phase: "integration",
        cause: "submodule_concurrent_advance",
        retryable: false,
        repoRole: "mounted_submodule",
        commandLabel: "git.merge.integration",
        recommendedNextActor: "operator",
        recoveryHint: "Inspect the preserved mounted submodule worktree and reconcile the concurrent advance.",
      };
    case "submodule_pointer_invariant_violation":
      return {
        phase: "integration",
        cause: "submodule_pointer_invariant_violation",
        retryable: false,
        repoRole: "mounted_submodule",
        commandLabel: "git.verify.submodule_pointer",
        recommendedNextActor: "operator",
        recoveryHint: "Validate the preserved host and submodule pointers before retrying publication.",
      };
    case "cleanup_failed":
      return {
        phase: "cleanup",
        cause: "cleanup_failed",
        retryable: false,
        repoRole: "worktree",
        commandLabel: "git.worktree.remove",
        recommendedNextActor: "operator",
        recoveryHint: "Remove the preserved worktree and branch refs after review.",
      };
    case "merge_back_failed":
      return {
        phase: "merge_back",
        cause: "merge_back_failed",
        retryable: false,
        repoRole: "host",
        commandLabel: null,
        recommendedNextActor: "operator",
        recoveryHint: "Inspect the preserved merge-back state and retry only after resolving the underlying failure.",
      };
    case "orphan_cleanup_failed":
      return {
        phase: "orphan_cleanup",
        cause: "orphan_cleanup_failed",
        retryable: false,
        repoRole: "worktree",
        commandLabel: "git.worktree.remove",
        recommendedNextActor: "operator",
        recoveryHint: "Clean up the preserved orphaned worktree manually.",
      };
    case "stale_dispatch":
      return {
        phase: "orphan_cleanup",
        cause: "stale_dispatch",
        retryable: false,
        repoRole: "worktree",
        commandLabel: null,
        recommendedNextActor: "operator",
        recoveryHint: "Resume investigation from the preserved orphaned worktree.",
      };
    default:
      return {
        phase: "merge_back",
        cause: incidentKind,
        retryable: false,
        repoRole: "host",
        commandLabel: null,
        recommendedNextActor: "operator",
        recoveryHint: "Inspect the preserved dispatcher runtime state before retrying.",
      };
  }
}
