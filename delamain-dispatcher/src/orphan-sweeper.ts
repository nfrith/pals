import { DispatchRegistry } from "./dispatch-registry.js";
import { isProcessAlive } from "./git.js";
import { GitWorktreeIsolationStrategy } from "./git-worktree-isolation.js";
import { RepoMutationLock } from "./repo-mutation-lock.js";
import { buildIncidentContext } from "./forensics.js";

export interface OrphanSweepSummary {
  staleLocksReleased: number;
  pristineOrphansPruned: number;
  dirtyOrphansPreserved: number;
}

interface OrphanSweeperOptions {
  staleDispatchMs?: number;
}

export class OrphanSweeper {
  private readonly staleDispatchMs: number;

  constructor(
    private readonly registry: DispatchRegistry,
    private readonly isolation: GitWorktreeIsolationStrategy,
    private readonly repoMutationLock: RepoMutationLock,
    options: OrphanSweeperOptions = {},
  ) {
    this.staleDispatchMs = options.staleDispatchMs ?? 5 * 60_000;
  }

  async sweep(now = new Date()): Promise<OrphanSweepSummary> {
    const summary: OrphanSweepSummary = {
      staleLocksReleased: 0,
      pristineOrphansPruned: 0,
      dirtyOrphansPreserved: 0,
    };

    const staleLock = await this.repoMutationLock.sweepStaleLease(now);
    if (staleLock.released) {
      summary.staleLocksReleased += 1;
    }

    const records = await this.registry.list();
    for (const record of records) {
      if (record.status !== "active") continue;

      const heartbeatAgeMs = record.heartbeat_at
        ? now.getTime() - Date.parse(record.heartbeat_at)
        : Number.POSITIVE_INFINITY;
      if (isProcessAlive(record.owner_pid) && heartbeatAgeMs <= this.staleDispatchMs) {
        continue;
      }

      const inspection = await this.isolation.inspectWorktree({
        worktreePath: record.worktree_path,
        baseCommit: record.base_commit,
        mountedSubmodules: record.mounted_submodules.map((entry) => ({
          repo_path: entry.repo_path,
          worktree_path: entry.worktree_path,
          base_commit: entry.base_commit,
        })),
      });

      if (!inspection.exists || inspection.pristine) {
        try {
          await this.isolation.cleanupDispatch({
            worktreePath: record.worktree_path,
            branchName: record.branch_name,
            mountedSubmodules: record.mounted_submodules,
          });
        } catch (error) {
          const incidentMessage = error instanceof Error ? error.message : String(error);
          console.warn(
            `[dispatcher] orphan cleanup failed for ${record.item_id}: ${incidentMessage}`,
          );
          await this.registry.updateByItemId(record.item_id, (existing) => ({
            ...existing,
            status: "orphaned",
            updated_at: now.toISOString(),
            latest_error: incidentMessage,
            incident: {
              kind: "orphan_cleanup_failed",
              message: `Pristine orphan cleanup failed for worktree '${existing.worktree_path ?? "<missing>"}': ${incidentMessage}`,
              detected_at: now.toISOString(),
              retry_count: 0,
              incident_context: buildIncidentContext({
                phase: "orphan_cleanup",
                cause: "orphan_cleanup_failed",
                retryable: false,
                recommended_next_actor: "operator",
                repo_role: "worktree",
                repo_path: ".",
                command_label: "git.worktree.remove",
                preserved_paths: existing.worktree_path ? [existing.worktree_path] : [],
                recovery_hint: "Clean up the preserved orphaned worktree manually.",
                correlation_ids: {
                  tick_id: existing.incident?.incident_context?.correlation_ids.tick_id ?? null,
                  dispatch_id: existing.dispatch_id,
                  merge_attempt_id: null,
                  repo_attempt_id: null,
                },
              }),
            },
          }));
          continue;
        }

        await this.registry.removeByItemId(record.item_id);
        summary.pristineOrphansPruned += 1;
        continue;
      }

      await this.registry.updateByItemId(record.item_id, (existing) => ({
        ...existing,
        status: "orphaned",
        updated_at: now.toISOString(),
        latest_error: existing.latest_error ?? "Active dispatch lost ownership before cleanup",
        incident: {
          kind: "stale_dispatch",
          message: `Dispatch heartbeat went stale while worktree '${existing.worktree_path ?? "<missing>"}' still had preserved work`,
          detected_at: now.toISOString(),
          retry_count: 0,
          incident_context: buildIncidentContext({
            phase: "orphan_cleanup",
            cause: "stale_dispatch",
            retryable: false,
            recommended_next_actor: "operator",
            repo_role: "worktree",
            repo_path: ".",
            preserved_paths: existing.worktree_path ? [existing.worktree_path] : [],
            recovery_hint: "Resume investigation from the preserved orphaned worktree.",
            correlation_ids: {
              tick_id: existing.incident?.incident_context?.correlation_ids.tick_id ?? null,
              dispatch_id: existing.dispatch_id,
              merge_attempt_id: null,
              repo_attempt_id: null,
            },
          }),
        },
      }));
      summary.dirtyOrphansPreserved += 1;
    }

    return summary;
  }
}
