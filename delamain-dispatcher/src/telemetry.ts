import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { join } from "path";
import {
  buildIncidentContext,
  normalizeCommandResult,
  normalizeCorrelationIds,
  normalizeIncidentContext,
  normalizeRelevantShas,
  sanitizeJsonObject,
  type DispatchCommandResult,
  type DispatchCorrelationIds,
  type DispatchIncidentContext,
  type DispatchRelevantShas,
  type JsonObject,
} from "./forensics.js";
import type {
  RuntimeConcurrencyHolderRecord,
  RuntimeMountedSubmoduleRecord,
} from "./runtime-state.js";
import type { AgentProvider } from "./provider.js";

const LEGACY_DISPATCH_TELEMETRY_SCHEMA = "als-delamain-telemetry-event@1";
export const DISPATCH_TELEMETRY_SCHEMA = "als-delamain-telemetry-event@2";
export const DISPATCH_INCIDENT_BUNDLE_SCHEMA = "als-delamain-incident-bundle@1";
export const DEFAULT_TELEMETRY_RETENTION = 10_000;

type KnownDispatchTelemetryEventType =
  | "dispatch_start"
  | "dispatch_prepare"
  | "dispatch_finish"
  | "dispatch_failure"
  | "dispatch_suppressed_concurrency"
  | "dispatch_merge_success"
  | "dispatch_merge_blocked"
  | "dispatch_cleanup"
  | "dispatch_orphaned"
  | "scan_claim"
  | "provider_run"
  | "worktree_result"
  | "merge_attempt_start"
  | "dirty_check"
  | "refresh_decision"
  | "integration_attempt"
  | "publish_attempt"
  | "publish_replay"
  | "rollback"
  | "incident_preserved"
  | "primary_convergence"
  | "orphan_cleanup";

export type DispatchTelemetryEventType = KnownDispatchTelemetryEventType | (string & {});

export interface DispatchTelemetryEvent {
  schema: typeof DISPATCH_TELEMETRY_SCHEMA;
  event_id: string;
  event_type: DispatchTelemetryEventType;
  timestamp: string;
  dispatcher_name: string;
  module_id: string;
  tick_id: string | null;
  dispatch_id: string | null;
  merge_attempt_id: string | null;
  repo_attempt_id: string | null;
  item_id: string;
  item_file: string;
  isolated_item_file: string | null;
  state: string;
  agent_name: string;
  sub_agent_name: string | null;
  provider: AgentProvider;
  resumable: boolean;
  resume_requested: boolean;
  session_field: string | null;
  runtime_session_id: string | null;
  resume_session_id: string | null;
  worker_session_id: string | null;
  worktree_path: string | null;
  branch_name: string | null;
  mounted_submodules: RuntimeMountedSubmoduleRecord[];
  worktree_commit: string | null;
  integrated_commit: string | null;
  merge_outcome: string | null;
  incident_kind: string | null;
  phase: string | null;
  cause: string | null;
  retryable: boolean | null;
  recommended_next_actor: "operator" | "automation" | "none" | null;
  command_label: string | null;
  command_result: DispatchCommandResult | null;
  relevant_shas: DispatchRelevantShas;
  blocked_by?: "state" | "pool";
  current_count?: number | null;
  concurrency_limit?: number | null;
  pool_id?: string;
  pool_states?: string[];
  pool_holders?: RuntimeConcurrencyHolderRecord[];
  transition_targets: string[];
  duration_ms: number | null;
  num_turns: number | null;
  cost_usd: number | null;
  error: string | null;
  incident_context: DispatchIncidentContext | null;
  attributes: JsonObject | null;
}

export interface DispatchIncidentBundle {
  schema: typeof DISPATCH_INCIDENT_BUNDLE_SCHEMA;
  created_at: string;
  dispatcher_name: string;
  module_id: string;
  tick_id: string | null;
  dispatch_id: string;
  merge_attempt_id: string | null;
  repo_attempt_id: string | null;
  item_id: string;
  item_file: string;
  state: string;
  incident_kind: string;
  phase: string;
  cause: string;
  retryable: boolean;
  recommended_next_actor: "operator" | "automation" | "none";
  incident_context: DispatchIncidentContext;
  events: DispatchTelemetryEvent[];
}

export interface TelemetryReadResult {
  available: boolean;
  events: DispatchTelemetryEvent[];
  parse_errors: number;
}

interface TelemetryPaths {
  directory: string;
  eventsFile: string;
  incidentsDirectory: string;
}

const writeQueues = new Map<string, Promise<void>>();

export function resolveTelemetryPaths(bundleRoot: string): TelemetryPaths {
  const directory = join(bundleRoot, "telemetry");
  return {
    directory,
    eventsFile: join(directory, "events.jsonl"),
    incidentsDirectory: join(bundleRoot, "runtime", "incidents"),
  };
}

export function resolveIncidentBundlePath(bundleRoot: string, dispatchId: string): string {
  return join(resolveTelemetryPaths(bundleRoot).incidentsDirectory, `${dispatchId}.json`);
}

export async function readTelemetryEvents(
  bundleRoot: string,
  limit = DEFAULT_TELEMETRY_RETENTION,
): Promise<TelemetryReadResult> {
  const { eventsFile } = resolveTelemetryPaths(bundleRoot);

  let raw: string;
  try {
    raw = await readFile(eventsFile, "utf-8");
  } catch (error) {
    if (isMissing(error)) {
      return {
        available: false,
        events: [],
        parse_errors: 0,
      };
    }
    throw error;
  }

  const events: DispatchTelemetryEvent[] = [];
  let parseErrors = 0;

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;

    try {
      const parsed = JSON.parse(line) as Partial<DispatchTelemetryEvent> & { schema?: string };
      if (
        parsed.schema !== DISPATCH_TELEMETRY_SCHEMA
        && parsed.schema !== LEGACY_DISPATCH_TELEMETRY_SCHEMA
      ) {
        parseErrors += 1;
        continue;
      }

      events.push(normalizeTelemetryEvent(parsed));
    } catch {
      parseErrors += 1;
    }
  }

  return {
    available: true,
    events: events.slice(-limit),
    parse_errors: parseErrors,
  };
}

export async function readDispatchTelemetrySlice(
  bundleRoot: string,
  dispatchId: string,
): Promise<DispatchTelemetryEvent[]> {
  const result = await readTelemetryEvents(bundleRoot, DEFAULT_TELEMETRY_RETENTION);
  return result.events.filter((event) => event.dispatch_id === dispatchId);
}

export async function appendTelemetryEvent(
  bundleRoot: string,
  event: DispatchTelemetryEvent,
  retention = DEFAULT_TELEMETRY_RETENTION,
): Promise<void> {
  const { directory, eventsFile } = resolveTelemetryPaths(bundleRoot);

  const previous = writeQueues.get(eventsFile) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    await mkdir(directory, { recursive: true });
    const existing = await readTelemetryEvents(bundleRoot, retention);
    const events = [...existing.events, normalizeTelemetryEvent(event)].slice(-retention);
    const contents = events.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
    const tempFile = `${eventsFile}.tmp`;
    await writeFile(tempFile, contents, "utf-8");
    await rename(tempFile, eventsFile);
  });

  writeQueues.set(eventsFile, next);
  try {
    await next;
  } finally {
    if (writeQueues.get(eventsFile) === next) {
      writeQueues.delete(eventsFile);
    }
  }
}

export async function writeIncidentBundle(
  bundleRoot: string,
  bundle: DispatchIncidentBundle,
): Promise<void> {
  const normalized = normalizeIncidentBundle(bundle);
  const bundlePath = resolveIncidentBundlePath(bundleRoot, normalized.dispatch_id);
  await mkdir(resolveTelemetryPaths(bundleRoot).incidentsDirectory, { recursive: true });
  const tempFile = `${bundlePath}.tmp`;
  await writeFile(tempFile, JSON.stringify(normalized, null, 2) + "\n", "utf-8");
  await rename(tempFile, bundlePath);
}

function normalizeTelemetryEvent(
  event: Partial<DispatchTelemetryEvent> & { schema?: string },
): DispatchTelemetryEvent {
  return {
    schema: DISPATCH_TELEMETRY_SCHEMA,
    event_id: event.event_id ?? crypto.randomUUID(),
    event_type: normalizeEventType(event.event_type),
    timestamp: event.timestamp ?? new Date().toISOString(),
    dispatcher_name: event.dispatcher_name ?? "unknown",
    module_id: event.module_id ?? "unknown",
    tick_id: asString(event.tick_id),
    dispatch_id: asString(event.dispatch_id),
    merge_attempt_id: asString(event.merge_attempt_id),
    repo_attempt_id: asString(event.repo_attempt_id),
    item_id: event.item_id ?? "unknown",
    item_file: event.item_file ?? "unknown",
    isolated_item_file: asString(event.isolated_item_file),
    state: event.state ?? "unknown",
    agent_name: event.agent_name ?? "unknown",
    sub_agent_name: asString(event.sub_agent_name),
    provider: event.provider === "openai" ? "openai" : "anthropic",
    resumable: event.resumable === true,
    resume_requested: event.resume_requested === true,
    session_field: asString(event.session_field),
    runtime_session_id: asString(event.runtime_session_id),
    resume_session_id: asString(event.resume_session_id),
    worker_session_id: asString(event.worker_session_id),
    worktree_path: asString(event.worktree_path),
    branch_name: asString(event.branch_name),
    mounted_submodules: Array.isArray(event.mounted_submodules)
      ? event.mounted_submodules.map((entry) => normalizeMountedSubmodule(entry))
      : [],
    worktree_commit: asString(event.worktree_commit),
    integrated_commit: asString(event.integrated_commit),
    merge_outcome: asString(event.merge_outcome),
    incident_kind: asString(event.incident_kind),
    phase: asString(event.phase),
    cause: asString(event.cause),
    retryable: typeof event.retryable === "boolean" ? event.retryable : null,
    recommended_next_actor: normalizeRecommendedNextActor(event.recommended_next_actor),
    command_label: asString(event.command_label),
    command_result: normalizeCommandResult(event.command_result),
    relevant_shas: normalizeRelevantShas(event.relevant_shas),
    ...(event.blocked_by === "state" || event.blocked_by === "pool"
      ? { blocked_by: event.blocked_by }
      : {}),
    current_count: typeof event.current_count === "number" ? event.current_count : null,
    concurrency_limit: typeof event.concurrency_limit === "number" ? event.concurrency_limit : null,
    ...(typeof event.pool_id === "string" && event.pool_id.length > 0
      ? { pool_id: event.pool_id }
      : {}),
    ...(Array.isArray(event.pool_states)
      ? {
        pool_states: event.pool_states.filter(
          (value): value is string => typeof value === "string",
        ),
      }
      : {}),
    ...(Array.isArray(event.pool_holders)
      ? {
        pool_holders: event.pool_holders.map((entry) => normalizeConcurrencyHolder(entry)),
      }
      : {}),
    transition_targets: Array.isArray(event.transition_targets)
      ? event.transition_targets.filter((value): value is string => typeof value === "string")
      : [],
    duration_ms: typeof event.duration_ms === "number" ? event.duration_ms : null,
    num_turns: typeof event.num_turns === "number" ? event.num_turns : null,
    cost_usd: typeof event.cost_usd === "number" ? event.cost_usd : null,
    error: asString(event.error),
    incident_context: normalizeIncidentContext(event.incident_context),
    attributes: sanitizeJsonObject(event.attributes),
  };
}

function normalizeIncidentBundle(bundle: DispatchIncidentBundle): DispatchIncidentBundle {
  const incidentContext = normalizeIncidentContext(bundle.incident_context)
    ?? buildIncidentContext({
      phase: bundle.phase,
      cause: bundle.cause,
      retryable: bundle.retryable,
      recommended_next_actor: bundle.recommended_next_actor,
      correlation_ids: {
        tick_id: bundle.tick_id,
        dispatch_id: bundle.dispatch_id,
        merge_attempt_id: bundle.merge_attempt_id,
        repo_attempt_id: bundle.repo_attempt_id,
      },
    });

  return {
    schema: DISPATCH_INCIDENT_BUNDLE_SCHEMA,
    created_at: bundle.created_at ?? new Date().toISOString(),
    dispatcher_name: bundle.dispatcher_name ?? "unknown",
    module_id: bundle.module_id ?? "unknown",
    tick_id: asString(bundle.tick_id),
    dispatch_id: bundle.dispatch_id,
    merge_attempt_id: asString(bundle.merge_attempt_id),
    repo_attempt_id: asString(bundle.repo_attempt_id),
    item_id: bundle.item_id,
    item_file: bundle.item_file,
    state: bundle.state,
    incident_kind: bundle.incident_kind,
    phase: bundle.phase,
    cause: bundle.cause,
    retryable: bundle.retryable,
    recommended_next_actor: bundle.recommended_next_actor,
    incident_context: incidentContext,
    events: Array.isArray(bundle.events)
      ? bundle.events.map((event) => normalizeTelemetryEvent(event))
      : [],
  };
}

function normalizeConcurrencyHolder(value: unknown): RuntimeConcurrencyHolderRecord {
  const holder = value && typeof value === "object"
    ? value as Partial<RuntimeConcurrencyHolderRecord>
    : {};

  return {
    dispatch_id: typeof holder.dispatch_id === "string" && holder.dispatch_id.length > 0
      ? holder.dispatch_id
      : "unknown",
    item_id: typeof holder.item_id === "string" && holder.item_id.length > 0
      ? holder.item_id
      : "unknown",
    state: typeof holder.state === "string" && holder.state.length > 0
      ? holder.state
      : "unknown",
    status: holder.status === "blocked" ? "blocked" : "active",
  };
}

function normalizeMountedSubmodule(value: unknown): RuntimeMountedSubmoduleRecord {
  const record = value && typeof value === "object"
    ? value as Partial<RuntimeMountedSubmoduleRecord>
    : {};

  return {
    repo_path: typeof record.repo_path === "string" && record.repo_path.length > 0
      ? record.repo_path
      : "unknown",
    primary_repo_path: typeof record.primary_repo_path === "string" && record.primary_repo_path.length > 0
      ? record.primary_repo_path
      : null,
    worktree_path: typeof record.worktree_path === "string" && record.worktree_path.length > 0
      ? record.worktree_path
      : null,
    branch_name: typeof record.branch_name === "string" && record.branch_name.length > 0
      ? record.branch_name
      : null,
    base_commit: typeof record.base_commit === "string" && record.base_commit.length > 0
      ? record.base_commit
      : null,
    worktree_commit: typeof record.worktree_commit === "string" && record.worktree_commit.length > 0
      ? record.worktree_commit
      : null,
    integrated_commit: typeof record.integrated_commit === "string" && record.integrated_commit.length > 0
      ? record.integrated_commit
      : null,
  };
}

function normalizeEventType(value: unknown): DispatchTelemetryEventType {
  return typeof value === "string" && value.length > 0 ? value as DispatchTelemetryEventType : "dispatch_failure";
}

function normalizeRecommendedNextActor(
  value: unknown,
): DispatchTelemetryEvent["recommended_next_actor"] {
  return value === "operator" || value === "automation" || value === "none" ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
