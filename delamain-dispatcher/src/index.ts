import "./preflight.js";
import { existsSync } from "fs";
import { writeFileSync, unlinkSync } from "fs";
import { resolve as resolvePath, dirname, join } from "path";
import { resolve, dispatch, type DispatchEntry } from "./dispatcher.js";
import {
  buildConcurrencySnapshot,
  evaluateDispatchConcurrency,
  reserveDispatchConcurrency,
  type DispatchConcurrencySuppression,
} from "./concurrency.js";
import {
  DispatcherRuntime,
  type BlockedDirtyRetryResult,
  type DispatcherRuntimeHeartbeat,
} from "./dispatcher-runtime.js";
import type { RuntimeDispatchSummary } from "./runtime-state.js";
import { formatDispatcherVersionLine, loadDispatcherVersionInfo } from "./dispatcher-version.js";
import {
  appendTelemetryEvent,
  DISPATCH_TELEMETRY_SCHEMA,
  readDispatchTelemetrySlice,
  resolveIncidentBundlePath,
  writeIncidentBundle,
} from "./telemetry.js";
import { createDrainControlPlane, type DrainControlPlane } from "./drain-control.js";
import { scanWithDiagnostics, type WorkItemScanDecision } from "./watcher.js";
import { sanitizeJsonObject } from "./forensics.js";
import { resolveDispatchActiveOperator } from "./active-operator.js";

function findSystemRoot(start: string): string {
  let dir = start;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, ".als", "system.ts"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("No .als/system.ts found in parent directories");
}

const SYSTEM_ROOT = process.env["SYSTEM_ROOT"]
  ? resolvePath(process.env["SYSTEM_ROOT"])
  : findSystemRoot(resolvePath(import.meta.dir));
const BUNDLE_ROOT = dirname(dirname(resolvePath(import.meta.dir)));

const POLL_MS = parseInt(process.env["POLL_MS"] ?? "30000", 10);
const CONTROL_POLL_MS = parseInt(process.env["CONTROL_POLL_MS"] ?? "250", 10);

try {
  console.log(formatDispatcherVersionLine(await loadDispatcherVersionInfo(BUNDLE_ROOT)));
} catch (error) {
  console.error(`[dispatcher] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const config = await resolve(BUNDLE_ROOT, SYSTEM_ROOT);
const runtime = new DispatcherRuntime({
  bundleRoot: BUNDLE_ROOT,
  systemRoot: SYSTEM_ROOT,
  delamainName: config.delamainName,
  moduleId: config.moduleId,
  statusField: config.statusField,
  pollMs: POLL_MS,
  submodules: config.submodules,
});
await runtime.ensurePrimaryCloneCommitGuards();

console.log(`[dispatcher] system: ${SYSTEM_ROOT}`);
console.log(`[dispatcher] bundle: ${BUNDLE_ROOT}`);
console.log(`[dispatcher] module: ${config.moduleId}`);
console.log(`[dispatcher] delamain: ${config.delamainName}`);
console.log(`[dispatcher] status field: ${config.statusField}`);
console.log(`[dispatcher] entity: ${config.entityName}`);
console.log(`[dispatcher] entity path: ${config.entityPath}`);
console.log(`[dispatcher] module root: ${config.moduleRoot}`);
console.log(
  `[dispatcher] limits: maxTurns=${config.maxTurns} / maxBudgetUsdByProvider={anthropic:${config.maxBudgetUsdByProvider.anthropic}, openai:${config.maxBudgetUsdByProvider.openai}}`,
);
if (config.submodules.length > 0) {
  console.log(`[dispatcher] mounted submodules: ${config.submodules.join(", ")}`);
}
if (config.discriminatorField) {
  console.log(`[dispatcher] discriminator: ${config.discriminatorField}=${config.discriminatorValue}`);
}
if (config.activeOperatorAssignment) {
  console.log(
    `[dispatcher] active-operator assignment: field=${config.activeOperatorAssignment.field} mode=${config.activeOperatorAssignment.mode}`,
  );
}
console.log(`[dispatcher] states: ${config.allStates.join(", ")}`);
console.log(`[dispatcher] watching: ${config.dispatchTable.map((e) => e.state).join(", ")}`);
console.log(`[dispatcher] polling every ${POLL_MS}ms`);
console.log(`[dispatcher] drain control poll every ${CONTROL_POLL_MS}ms`);

const STATUS_FILE = join(
  SYSTEM_ROOT,
  ".claude",
  "delamains",
  config.delamainName,
  "status.json",
);
const DRAIN_REQUEST_FILE = join(
  SYSTEM_ROOT,
  ".claude",
  "delamains",
  config.delamainName,
  "dispatcher",
  "control",
  "drain-request.json",
);

type DispatcherLifecycleMode = "running" | "draining";

let lastItemsScanned = 0;
let lastRuntimeHeartbeat: DispatcherRuntimeHeartbeat = {
  active_dispatches: 0,
  active_by_provider: {
    anthropic: 0,
    openai: 0,
  },
  blocked_dispatches: 0,
  orphaned_dispatches: 0,
  guarded_dispatches: 0,
};
let lifecycleMode: DispatcherLifecycleMode = "running";
let drainRequestedAt: string | null = null;
let drainControl: DrainControlPlane | null = null;
let lastActiveOperatorRefusalSignature: string | null = null;

async function writeHeartbeat(itemsScanned: number) {
  lastRuntimeHeartbeat = await runtime.heartbeat();
  const drainControlSnapshot = drainControl?.snapshot() ?? {
    control_poll_ms: CONTROL_POLL_MS,
    watch_state: "initializing" as const,
    last_watch_event_at: null,
    last_watch_error: null,
    last_drain_detection_source: null,
    last_drain_detection_at: null,
  };
  try {
    writeFileSync(
      STATUS_FILE,
      JSON.stringify({
        name: config.delamainName,
        pid: process.pid,
        last_tick: new Date().toISOString(),
        poll_ms: POLL_MS,
        active_dispatches: lastRuntimeHeartbeat.active_dispatches,
        active_by_provider: lastRuntimeHeartbeat.active_by_provider,
        blocked_dispatches: lastRuntimeHeartbeat.blocked_dispatches,
        orphaned_dispatches: lastRuntimeHeartbeat.orphaned_dispatches,
        guarded_dispatches: lastRuntimeHeartbeat.guarded_dispatches,
        items_scanned: itemsScanned,
        lifecycle_mode: lifecycleMode,
        drain_requested_at: drainRequestedAt,
        control_poll_ms: drainControlSnapshot.control_poll_ms,
        control_watch_state: drainControlSnapshot.watch_state,
        control_watch_last_event_at: drainControlSnapshot.last_watch_event_at,
        control_watch_last_error: drainControlSnapshot.last_watch_error,
        drain_detection_source: drainControlSnapshot.last_drain_detection_source,
        drain_detection_at: drainControlSnapshot.last_drain_detection_at,
      }) + "\n",
    );
  } catch {
    // Non-fatal — statusline just won't see us
  }
}

function clearHeartbeat() {
  try {
    unlinkSync(STATUS_FILE);
  } catch {
    // Already gone
  }
}

function clearDrainRequest() {
  try {
    unlinkSync(DRAIN_REQUEST_FILE);
  } catch {
    // Already gone
  }
}

function findRule(status: string): DispatchEntry | undefined {
  return config.dispatchTable.find((entry) => entry.state === status);
}

function logCounts(prefix: string) {
  console.log(
    `${prefix} (active=${lastRuntimeHeartbeat.active_dispatches} [anthropic=${lastRuntimeHeartbeat.active_by_provider.anthropic}, openai=${lastRuntimeHeartbeat.active_by_provider.openai}], blocked=${lastRuntimeHeartbeat.blocked_dispatches}, orphaned=${lastRuntimeHeartbeat.orphaned_dispatches})`,
  );
}

function logActiveOperatorRefusal(messages: string[]) {
  const signature = messages.join("\n");
  if (lastActiveOperatorRefusalSignature === signature) {
    return;
  }

  messages.forEach((message) => console.warn(message));
  lastActiveOperatorRefusalSignature = signature;
}

async function updateHeartbeat() {
  await writeHeartbeat(lastItemsScanned);
}

async function enterDrainingMode(source: string): Promise<void> {
  if (lifecycleMode === "draining") {
    return;
  }

  lifecycleMode = "draining";
  drainRequestedAt = new Date().toISOString();
  console.log(
    `[dispatcher] drain requested via ${source} — stopping new dispatches and waiting for ${lastRuntimeHeartbeat.active_dispatches} active dispatch(es) to finish`,
  );
  await updateHeartbeat();
}

async function writeRetryTelemetry(
  result: BlockedDirtyRetryResult,
  tickId: string | null,
): Promise<void> {
  try {
    await appendTelemetryEvent(BUNDLE_ROOT, {
      schema: DISPATCH_TELEMETRY_SCHEMA,
      event_id: crypto.randomUUID(),
      event_type: result.action === "merged" ? "dispatch_merge_success" : "dispatch_merge_blocked",
      timestamp: new Date().toISOString(),
      dispatcher_name: config.delamainName,
      module_id: config.moduleId,
      tick_id: tickId,
      dispatch_id: result.dispatchId,
      merge_attempt_id: null,
      repo_attempt_id: null,
      item_id: result.itemId,
      item_file: result.itemFile,
      isolated_item_file: result.isolatedItemFile,
      state: result.state,
      agent_name: result.agentName,
      sub_agent_name: null,
      provider: result.provider,
      resumable: result.resumable,
      resume_requested: false,
      session_field: result.sessionField,
      runtime_session_id: result.sessionId,
      resume_session_id: null,
      worker_session_id: result.sessionId,
      worktree_path: result.worktreePath,
      branch_name: result.branchName,
      mounted_submodules: result.mountedSubmodules,
      worktree_commit: result.worktreeCommit,
      integrated_commit: result.integratedCommit,
      merge_outcome: result.mergeOutcome,
      incident_kind: result.incidentKind,
      phase: result.incidentContext?.phase ?? null,
      cause: result.incidentContext?.cause ?? null,
      retryable: result.incidentContext?.retryable ?? null,
      recommended_next_actor: result.incidentContext?.recommended_next_actor ?? null,
      command_label: result.incidentContext?.command_label ?? null,
      command_result: result.incidentContext?.command_result ?? null,
      relevant_shas: result.incidentContext?.relevant_shas ?? {
        base_commit: null,
        current_head: null,
        worktree_commit: result.worktreeCommit,
        integrated_commit: result.integratedCommit,
        remote_head_before: null,
        remote_head_after: null,
        theirs_commit: null,
        pre_integration_head: null,
      },
      transition_targets: result.transitionTargets,
      duration_ms: result.durationMs,
      num_turns: result.numTurns,
      cost_usd: result.costUsd,
      error: result.action === "merged" ? null : result.incidentMessage,
      incident_context: result.incidentContext,
      attributes: sanitizeJsonObject({
        retry_attempt: result.attempt,
        previous_incident_kind: result.previousIncidentKind,
        tree_state: result.treeState,
      }),
    });

    if (result.action !== "merged" && result.incidentKind && result.incidentContext) {
      const bundlePath = resolveIncidentBundlePath(BUNDLE_ROOT, result.dispatchId);
      await appendTelemetryEvent(BUNDLE_ROOT, {
        schema: DISPATCH_TELEMETRY_SCHEMA,
        event_id: crypto.randomUUID(),
        event_type: "incident_preserved",
        timestamp: new Date().toISOString(),
        dispatcher_name: config.delamainName,
        module_id: config.moduleId,
        tick_id: tickId,
        dispatch_id: result.dispatchId,
        merge_attempt_id: result.incidentContext.correlation_ids.merge_attempt_id,
        repo_attempt_id: result.incidentContext.correlation_ids.repo_attempt_id,
        item_id: result.itemId,
        item_file: result.itemFile,
        isolated_item_file: result.isolatedItemFile,
        state: result.state,
        agent_name: result.agentName,
        sub_agent_name: null,
        provider: result.provider,
        resumable: result.resumable,
        resume_requested: false,
        session_field: result.sessionField,
        runtime_session_id: result.sessionId,
        resume_session_id: null,
        worker_session_id: result.sessionId,
        worktree_path: result.worktreePath,
        branch_name: result.branchName,
        mounted_submodules: result.mountedSubmodules,
        worktree_commit: result.worktreeCommit,
        integrated_commit: result.integratedCommit,
        merge_outcome: result.mergeOutcome,
        incident_kind: result.incidentKind,
        phase: "incident_preserved",
        cause: result.incidentContext.cause,
        retryable: result.incidentContext.retryable,
        recommended_next_actor: result.incidentContext.recommended_next_actor,
        command_label: result.incidentContext.command_label,
        command_result: result.incidentContext.command_result,
        relevant_shas: result.incidentContext.relevant_shas,
        transition_targets: result.transitionTargets,
        duration_ms: result.durationMs,
        num_turns: result.numTurns,
        cost_usd: result.costUsd,
        error: result.incidentMessage,
        incident_context: result.incidentContext,
        attributes: sanitizeJsonObject({
          bundle_path: bundlePath,
          retry_attempt: result.attempt,
        }),
      });

      await writeIncidentBundle(BUNDLE_ROOT, {
        schema: "als-delamain-incident-bundle@1",
        created_at: new Date().toISOString(),
        dispatcher_name: config.delamainName,
        module_id: config.moduleId,
        tick_id: tickId,
        dispatch_id: result.dispatchId,
        merge_attempt_id: result.incidentContext.correlation_ids.merge_attempt_id,
        repo_attempt_id: result.incidentContext.correlation_ids.repo_attempt_id,
        item_id: result.itemId,
        item_file: result.itemFile,
        state: result.state,
        incident_kind: result.incidentKind,
        phase: result.incidentContext.phase,
        cause: result.incidentContext.cause,
        retryable: result.incidentContext.retryable,
        recommended_next_actor: result.incidentContext.recommended_next_actor,
        incident_context: result.incidentContext,
        events: await readDispatchTelemetrySlice(BUNDLE_ROOT, result.dispatchId),
      });
    }
  } catch (error) {
    console.warn(
      `[dispatcher] ${result.itemId} retry telemetry write failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function logCompletion(
  itemId: string,
  provider: DispatchEntry["provider"],
  result: { success: boolean; blocked: boolean },
) {
  console.log(
    `[dispatcher] ${itemId} finished provider=${provider} (success=${result.success}, blocked=${result.blocked}, active=${lastRuntimeHeartbeat.active_dispatches}, blocked_total=${lastRuntimeHeartbeat.blocked_dispatches}, anthropic=${lastRuntimeHeartbeat.active_by_provider.anthropic}, openai=${lastRuntimeHeartbeat.active_by_provider.openai})`,
  );
}

function logRetry(result: BlockedDirtyRetryResult) {
  console.log(
    `[dispatcher] mergeBack retry #${result.attempt} dispatch=${result.dispatchId} item=${result.itemId} incident=${result.previousIncidentKind} tree=${result.treeState} outcome=${result.action} next_incident=${result.incidentKind ?? "none"}`,
  );
}

function logSweep(prefix: string, summary: Awaited<ReturnType<typeof runtime.sweepOrphans>>) {
  if (
    summary.staleLocksReleased === 0
    && summary.pristineOrphansPruned === 0
    && summary.dirtyOrphansPreserved === 0
  ) {
    return;
  }

  console.log(
    `${prefix} stale_locks=${summary.staleLocksReleased} pristine_orphans=${summary.pristineOrphansPruned} dirty_orphans=${summary.dirtyOrphansPreserved}`,
  );
}

function buildOpenRecordItemIdSet(summary: RuntimeDispatchSummary): Set<string> {
  return new Set([
    ...summary.active,
    ...summary.blocked,
    ...summary.guarded,
    ...summary.orphaned,
  ].map((record) => record.item_id));
}

function buildTickId(): string {
  return `t-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function writeScanDecisionTelemetry(input: {
  tickId: string;
  decision: WorkItemScanDecision;
  rule: DispatchEntry | undefined;
  outcome: string;
  dispatchId?: string | null;
  openRecord: boolean;
  blockedBy?: "state" | "pool" | null;
  currentCount?: number | null;
  concurrencyLimit?: number | null;
}): Promise<void> {
  const { decision, rule } = input;
  try {
    await appendTelemetryEvent(BUNDLE_ROOT, {
      schema: DISPATCH_TELEMETRY_SCHEMA,
      event_id: crypto.randomUUID(),
      event_type: "scan_claim",
      timestamp: new Date().toISOString(),
      dispatcher_name: config.delamainName,
      module_id: config.moduleId,
      tick_id: input.tickId,
      dispatch_id: input.dispatchId ?? null,
      merge_attempt_id: null,
      repo_attempt_id: null,
      item_id: decision.item.id,
      item_file: decision.item.filePath,
      isolated_item_file: null,
      state: decision.item.status,
      agent_name: rule?.agentName ?? "unclaimed",
      sub_agent_name: rule?.subAgentName ?? null,
      provider: rule?.provider ?? "anthropic",
      resumable: rule?.resumable ?? false,
      resume_requested: false,
      session_field: rule?.sessionField ?? null,
      runtime_session_id: null,
      resume_session_id: null,
      worker_session_id: null,
      worktree_path: null,
      branch_name: null,
      mounted_submodules: [],
      worktree_commit: null,
      integrated_commit: null,
      merge_outcome: null,
      incident_kind: null,
      phase: "scan_claim",
      cause: input.blockedBy === "pool"
        ? "concurrency_pool_limit"
        : input.blockedBy === "state"
          ? "concurrency_state_limit"
          : decision.active_operator.outcome === "skipped_missing_assignment"
            ? "active_operator_assignment_missing"
            : decision.active_operator.outcome === "skipped_operator_mismatch"
              ? "active_operator_assignment_mismatch"
              : input.openRecord
                ? "open_dispatch_exists"
                : null,
      retryable: input.openRecord || input.blockedBy === "state" || input.blockedBy === "pool",
      recommended_next_actor: input.outcome === "claimed" ? "none" : input.blockedBy ? "automation" : "operator",
      command_label: null,
      command_result: null,
      relevant_shas: {
        base_commit: null,
        current_head: null,
        worktree_commit: null,
        integrated_commit: null,
        remote_head_before: null,
        remote_head_after: null,
        theirs_commit: null,
        pre_integration_head: null,
      },
      ...(input.blockedBy ? { blocked_by: input.blockedBy } : {}),
      current_count: input.currentCount ?? null,
      concurrency_limit: input.concurrencyLimit ?? null,
      transition_targets: rule?.transitions.map((transition) => transition.to) ?? [],
      duration_ms: null,
      num_turns: null,
      cost_usd: null,
      error: null,
      incident_context: null,
      attributes: sanitizeJsonObject({
        committed_status: decision.committed_status,
        scan_outcome: input.outcome,
        open_record: input.openRecord,
        active_operator: decision.active_operator,
      }),
    });
  } catch (error) {
    console.warn(
      `[dispatcher] ${decision.item.id} scan telemetry write failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function writeConcurrencySuppressionTelemetry(
  item: { id: string; filePath: string },
  rule: DispatchEntry,
  suppression: DispatchConcurrencySuppression,
  tickId: string | null,
  decision?: WorkItemScanDecision,
): Promise<void> {
  try {
    await appendTelemetryEvent(BUNDLE_ROOT, {
      schema: DISPATCH_TELEMETRY_SCHEMA,
      event_id: crypto.randomUUID(),
      event_type: "dispatch_suppressed_concurrency",
      timestamp: new Date().toISOString(),
      dispatcher_name: config.delamainName,
      module_id: config.moduleId,
      tick_id: tickId,
      dispatch_id: null,
      merge_attempt_id: null,
      repo_attempt_id: null,
      item_id: item.id,
      item_file: item.filePath,
      isolated_item_file: null,
      state: rule.state,
      agent_name: rule.agentName,
      sub_agent_name: rule.subAgentName ?? null,
      provider: rule.provider,
      resumable: rule.resumable,
      resume_requested: false,
      session_field: rule.sessionField ?? null,
      runtime_session_id: null,
      resume_session_id: null,
      worker_session_id: null,
      worktree_path: null,
      branch_name: null,
      mounted_submodules: [],
      worktree_commit: null,
      integrated_commit: null,
      merge_outcome: null,
      incident_kind: null,
      phase: "scan_claim",
      cause: suppression.blockedBy === "pool" ? "concurrency_pool_limit" : "concurrency_state_limit",
      retryable: true,
      recommended_next_actor: "automation",
      command_label: null,
      command_result: null,
      relevant_shas: {
        base_commit: null,
        current_head: null,
        worktree_commit: null,
        integrated_commit: null,
        remote_head_before: null,
        remote_head_after: null,
        theirs_commit: null,
        pre_integration_head: null,
      },
      blocked_by: suppression.blockedBy,
      current_count: suppression.currentCount,
      concurrency_limit: suppression.concurrencyLimit,
      ...(suppression.blockedBy === "pool"
        ? {
          pool_id: suppression.poolId,
          pool_states: suppression.poolStates,
          pool_holders: suppression.poolHolders,
        }
        : {}),
      transition_targets: rule.transitions.map((transition) => transition.to),
      duration_ms: null,
      num_turns: null,
      cost_usd: null,
      error: null,
      incident_context: null,
      attributes: sanitizeJsonObject({
        committed_status: decision?.committed_status ?? rule.state,
        active_operator: decision?.active_operator ?? null,
        scan_outcome: "suppressed_concurrency",
      }),
    });
  } catch (error) {
    console.warn(
      `[dispatcher] ${item.id} concurrency telemetry write failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

process.on("beforeExit", (code) => {
  console.log(
    `[dispatcher] beforeExit fired (code=${code}, active=${lastRuntimeHeartbeat.active_dispatches}, blocked=${lastRuntimeHeartbeat.blocked_dispatches})`,
  );
});

process.on("exit", (code) => {
  console.log(
    `[dispatcher] exit code=${code} active=${lastRuntimeHeartbeat.active_dispatches} blocked=${lastRuntimeHeartbeat.blocked_dispatches}`,
  );
});

process.on("uncaughtException", (err) => {
  console.error("[dispatcher] uncaughtException:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[dispatcher] unhandledRejection:", reason);
});

let tickCount = 0;

async function maybeExitForDrain(): Promise<boolean> {
  if (lifecycleMode !== "draining") {
    return false;
  }

  await updateHeartbeat();
  if (lastRuntimeHeartbeat.active_dispatches === 0) {
    console.log("[dispatcher] drain complete — exiting cleanly");
    clearDrainRequest();
    clearRuntimeAndExit(0);
  }
  return true;
}

async function tick() {
  tickCount += 1;
  const tickId = buildTickId();
  logCounts(`[dispatcher] tick #${tickCount}`);

  const sweep = await runtime.sweepOrphans();
  logSweep("[dispatcher] orphan sweep", sweep);
  if (await maybeExitForDrain()) {
    return;
  }

  const activeOperatorResolution = await resolveDispatchActiveOperator(
    SYSTEM_ROOT,
    config.delamainName,
    config.activeOperatorAssignment,
  );
  if (activeOperatorResolution.status === "refuse") {
    lastItemsScanned = 0;
    logActiveOperatorRefusal(activeOperatorResolution.messages);
    await appendTelemetryEvent(BUNDLE_ROOT, {
      schema: DISPATCH_TELEMETRY_SCHEMA,
      event_id: crypto.randomUUID(),
      event_type: "scan_claim",
      timestamp: new Date().toISOString(),
      dispatcher_name: config.delamainName,
      module_id: config.moduleId,
      tick_id: tickId,
      dispatch_id: null,
      merge_attempt_id: null,
      repo_attempt_id: null,
      item_id: "<active-operator-refusal>",
      item_file: "<active-operator-refusal>",
      isolated_item_file: null,
      state: "<refused>",
      agent_name: "dispatcher",
      sub_agent_name: null,
      provider: "anthropic",
      resumable: false,
      resume_requested: false,
      session_field: null,
      runtime_session_id: null,
      resume_session_id: null,
      worker_session_id: null,
      worktree_path: null,
      branch_name: null,
      mounted_submodules: [],
      worktree_commit: null,
      integrated_commit: null,
      merge_outcome: null,
      incident_kind: null,
      phase: "scan_claim",
      cause: "active_operator_missing",
      retryable: false,
      recommended_next_actor: "operator",
      command_label: null,
      command_result: null,
      relevant_shas: {
        base_commit: null,
        current_head: null,
        worktree_commit: null,
        integrated_commit: null,
        remote_head_before: null,
        remote_head_after: null,
        theirs_commit: null,
        pre_integration_head: null,
      },
      transition_targets: [],
      duration_ms: null,
      num_turns: null,
      cost_usd: null,
      error: activeOperatorResolution.messages.join(" | "),
      incident_context: null,
      attributes: sanitizeJsonObject({
        active_operator_resolution: activeOperatorResolution,
      }),
    }).catch((error) => {
      console.warn(
        `[dispatcher] active-operator refusal telemetry write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    const retries = await runtime.retryBlockedDirtyDispatches();
    for (const retry of retries) {
      logRetry(retry);
      await writeRetryTelemetry(retry, tickId);
    }

    if (await maybeExitForDrain()) {
      return;
    }

    await updateHeartbeat();
    return;
  }
  lastActiveOperatorRefusalSignature = null;

  const scanResult = await scanWithDiagnostics(
    config.moduleRoot,
    config.entityPath,
    config.statusField,
    config.discriminatorField,
    config.discriminatorValue,
    activeOperatorResolution.status === "ready" ? activeOperatorResolution.filter : undefined,
  );
  const items = scanResult.items;
  lastItemsScanned = items.length;

  const releases = await runtime.reconcileObservedItems(items);
  for (const release of releases) {
    console.log(
      `[dispatcher] release ${release.itemId} after status change ${release.previousStatus} -> ${release.nextStatus} (${release.previousRecordStatus})`,
    );
  }

  const retries = await runtime.retryBlockedDirtyDispatches();
  for (const retry of retries) {
    logRetry(retry);
    await writeRetryTelemetry(retry, tickId);
  }

  if (await maybeExitForDrain()) {
    return;
  }

  const openSummary = await runtime.openDispatchSummary();
  const openItemIds = buildOpenRecordItemIdSet(openSummary);
  const concurrencySnapshot = buildConcurrencySnapshot(openSummary, config.dispatchTable);

  const decisionsByItemId = new Map(scanResult.decisions.map((decision) => [decision.item.id, decision] as const));

  for (const decision of scanResult.decisions) {
    if (
      decision.active_operator.outcome === "skipped_missing_assignment"
      || decision.active_operator.outcome === "skipped_operator_mismatch"
    ) {
      await writeScanDecisionTelemetry({
        tickId,
        decision,
        rule: findRule(decision.item.status),
        outcome: "skipped_active_operator_filter",
        openRecord: false,
      });
    }
  }

  for (const item of items) {
    if (lifecycleMode === "draining") {
      break;
    }

    const rule = findRule(item.status);
    const decision = decisionsByItemId.get(item.id);
    if (!rule || !decision) {
      continue;
    }
    if (openItemIds.has(item.id)) {
      await writeScanDecisionTelemetry({
        tickId,
        decision,
        rule,
        outcome: "skipped_open_record",
        openRecord: true,
      });
      continue;
    }

    const suppression = evaluateDispatchConcurrency(rule, concurrencySnapshot);
    if (suppression) {
      await writeScanDecisionTelemetry({
        tickId,
        decision,
        rule,
        outcome: "suppressed_concurrency",
        openRecord: false,
        blockedBy: suppression.blockedBy,
        currentCount: suppression.currentCount,
        concurrencyLimit: suppression.concurrencyLimit,
      });
      await writeConcurrencySuppressionTelemetry(item, rule, suppression, tickId, decision);
      continue;
    }

    const prepared = await runtime.prepareDispatch(item.id, item.filePath, rule);
    if (!prepared) {
      console.log(`[dispatcher] ${item.id} skipped: runtime registry already owns this item`);
      await writeScanDecisionTelemetry({
        tickId,
        decision,
        rule,
        outcome: "skipped_runtime_registry",
        openRecord: true,
      });
      continue;
    }
    prepared.tickId = tickId;

    await writeScanDecisionTelemetry({
      tickId,
      decision,
      rule,
      outcome: "claimed",
      dispatchId: prepared.dispatchId,
      openRecord: false,
    });

    openItemIds.add(item.id);
    reserveDispatchConcurrency(rule, concurrencySnapshot, rule.pool
      ? {
        dispatch_id: prepared.dispatchId,
        item_id: item.id,
        state: rule.state,
        status: "active",
      }
      : undefined);

    console.log(`[dispatcher] dispatch ${item.id} -> ${item.status}`);
    void dispatch(
      item.id,
      item.filePath,
      rule,
      config.agents,
      config,
      BUNDLE_ROOT,
      runtime,
      prepared,
    )
      .then(async (result) => {
        await updateHeartbeat();
        logCompletion(item.id, rule.provider, result);
      })
      .catch(async (error) => {
        console.error(`[dispatcher] ${item.id} dispatch error:`, error);
        await updateHeartbeat();
      });
  }

  await updateHeartbeat();
}

drainControl = createDrainControlPlane({
  drainRequestFile: DRAIN_REQUEST_FILE,
  controlPollMs: CONTROL_POLL_MS,
  onDrainRequested: ({ source }) => enterDrainingMode(source),
  onStateChange: async () => {
    await updateHeartbeat();
  },
  log: (message) => {
    console.warn(message);
  },
});
await drainControl.start();
const bootSweep = await runtime.sweepOrphans();
logSweep("[dispatcher] startup orphan sweep", bootSweep);
await updateHeartbeat();
await tick();
const interval = setInterval(() => {
  void tick().catch((error) => {
    console.error("[dispatcher] tick failed:", error);
  });
}, POLL_MS);

const keepalive = Bun.serve({
  port: 0,
  fetch: () => new Response("dispatcher alive"),
});
console.log(`[dispatcher] keepalive on port ${keepalive.port}`);

let forceShutdownRequested = false;

function clearRuntimeAndExit(code: number) {
  clearInterval(interval);
  drainControl?.stop();
  keepalive.stop();
  clearDrainRequest();
  clearHeartbeat();
  process.exit(code);
}

const stop = (signal: string) => {
  if (lastRuntimeHeartbeat.active_dispatches > 0) {
    console.log(
      `[dispatcher] ${signal} ignored while ${lastRuntimeHeartbeat.active_dispatches} active dispatch(es) are running`,
    );
    return false;
  }

  console.log(
    `[dispatcher] ${signal} received, shutting down (active=${lastRuntimeHeartbeat.active_dispatches}, blocked=${lastRuntimeHeartbeat.blocked_dispatches}, anthropic=${lastRuntimeHeartbeat.active_by_provider.anthropic}, openai=${lastRuntimeHeartbeat.active_by_provider.openai})`,
  );
  clearRuntimeAndExit(0);
  return true;
};

process.on("SIGTERM", () => {
  console.log(
    `[dispatcher] SIGTERM ignored (active=${lastRuntimeHeartbeat.active_dispatches}, blocked=${lastRuntimeHeartbeat.blocked_dispatches}, ticks=${tickCount})`,
  );
});

process.on("SIGINT", () => {
  if (forceShutdownRequested) {
    console.log("[dispatcher] second SIGINT - force quit");
    clearRuntimeAndExit(1);
    return;
  }

  forceShutdownRequested = true;
  if (!stop("SIGINT")) return;
});
