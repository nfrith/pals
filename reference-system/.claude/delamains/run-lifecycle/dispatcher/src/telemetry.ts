import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { join } from "path";

export const DISPATCH_TELEMETRY_SCHEMA = "als-delamain-telemetry-event@1";
export const DEFAULT_TELEMETRY_RETENTION = 200;

export type DispatchTelemetryEventType =
  | "dispatch_start"
  | "dispatch_finish"
  | "dispatch_failure";

export interface DispatchTelemetryEvent {
  schema: typeof DISPATCH_TELEMETRY_SCHEMA;
  event_id: string;
  event_type: DispatchTelemetryEventType;
  timestamp: string;
  dispatcher_name: string;
  module_id: string;
  item_id: string;
  item_file: string;
  state: string;
  agent_name: string;
  sub_agent_name: string | null;
  delegated: boolean;
  resumable: boolean;
  resume_requested: boolean;
  session_field: string | null;
  runtime_session_id: string | null;
  resume_session_id: string | null;
  worker_session_id: string | null;
  transition_targets: string[];
  duration_ms: number | null;
  num_turns: number | null;
  cost_usd: number | null;
  error: string | null;
}

export interface TelemetryReadResult {
  available: boolean;
  events: DispatchTelemetryEvent[];
  parse_errors: number;
}

interface TelemetryPaths {
  directory: string;
  eventsFile: string;
}

const writeQueues = new Map<string, Promise<void>>();

export function resolveTelemetryPaths(bundleRoot: string): TelemetryPaths {
  const directory = join(bundleRoot, "telemetry");
  return {
    directory,
    eventsFile: join(directory, "events.jsonl"),
  };
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
      const parsed = JSON.parse(line) as Partial<DispatchTelemetryEvent>;
      if (parsed.schema !== DISPATCH_TELEMETRY_SCHEMA) {
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

function normalizeTelemetryEvent(
  event: Partial<DispatchTelemetryEvent>,
): DispatchTelemetryEvent {
  return {
    schema: DISPATCH_TELEMETRY_SCHEMA,
    event_id: event.event_id ?? crypto.randomUUID(),
    event_type: event.event_type ?? "dispatch_failure",
    timestamp: event.timestamp ?? new Date().toISOString(),
    dispatcher_name: event.dispatcher_name ?? "unknown",
    module_id: event.module_id ?? "unknown",
    item_id: event.item_id ?? "unknown",
    item_file: event.item_file ?? "unknown",
    state: event.state ?? "unknown",
    agent_name: event.agent_name ?? "unknown",
    sub_agent_name: event.sub_agent_name ?? null,
    delegated: event.delegated === true,
    resumable: event.resumable === true,
    resume_requested: event.resume_requested === true,
    session_field: event.session_field ?? null,
    runtime_session_id: event.runtime_session_id ?? null,
    resume_session_id: event.resume_session_id ?? null,
    worker_session_id: event.worker_session_id ?? null,
    transition_targets: Array.isArray(event.transition_targets)
      ? event.transition_targets.filter((value): value is string => typeof value === "string")
      : [],
    duration_ms: typeof event.duration_ms === "number" ? event.duration_ms : null,
    num_turns: typeof event.num_turns === "number" ? event.num_turns : null,
    cost_usd: typeof event.cost_usd === "number" ? event.cost_usd : null,
    error: typeof event.error === "string" && event.error.length > 0 ? event.error : null,
  };
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
