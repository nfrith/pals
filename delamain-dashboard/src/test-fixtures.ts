import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  appendTelemetryEvent,
  DISPATCH_TELEMETRY_SCHEMA,
  type DispatchTelemetryEvent,
} from "../../skills/new/references/dispatcher/src/telemetry.ts";

export interface DashboardFixture {
  root: string;
  bundleRoot: string;
  statusFile: string;
  cleanup(): Promise<void>;
  writeHeartbeat(overrides?: Partial<FixtureHeartbeat>): Promise<void>;
  appendSuccess(itemId?: string): Promise<void>;
  appendFailure(itemId?: string, error?: string): Promise<void>;
}

interface FixtureHeartbeat {
  name: string;
  pid: number;
  last_tick: string;
  poll_ms: number;
  active_dispatches: number;
  items_scanned: number;
}

export async function createDashboardFixture(label: string): Promise<DashboardFixture> {
  const root = await mkdtemp(join(tmpdir(), `als-delamain-dashboard-${label}-`));
  const bundleRoot = join(root, ".claude", "delamains", "factory-jobs");
  const statusFile = join(bundleRoot, "status.json");
  const itemsDir = join(root, "workspace", "factory", "items");

  await mkdir(bundleRoot, { recursive: true });
  await mkdir(itemsDir, { recursive: true });
  await mkdir(join(root, ".als"), { recursive: true });
  await writeFile(join(root, ".als", "system.ts"), "export const system = {};\n", "utf-8");

  await writeFile(
    join(bundleRoot, "runtime-manifest.json"),
    JSON.stringify(
      {
        schema: "als-delamain-runtime-manifest@1",
        delamain_name: "factory-jobs",
        module_id: "factory",
        module_version: 1,
        module_mount_path: "workspace/factory",
        entity_name: "work-item",
        entity_path: "items/{id}.md",
        status_field: "status",
        discriminator_field: null,
        discriminator_value: null,
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );

  await writeFile(
    join(bundleRoot, "delamain.yaml"),
    [
      "phases:",
      "  - implementation",
      "  - closed",
      "states:",
      "  queued:",
      "    initial: true",
      "    phase: implementation",
      "    actor: agent",
      "  in-dev:",
      "    phase: implementation",
      "    actor: agent",
      "  in-review:",
      "    phase: implementation",
      "    actor: agent",
      "  completed:",
      "    phase: closed",
      "    terminal: true",
      "transitions:",
      "  - class: advance",
      "    from: queued",
      "    to: in-dev",
    ].join("\n") + "\n",
    "utf-8",
  );

  await writeFile(
    join(itemsDir, "ALS-001.md"),
    [
      "---",
      "id: ALS-001",
      "type: work-item",
      "status: in-dev",
      "title: Build canonical feed",
      "---",
      "",
      "Dashboard fixture item one.",
    ].join("\n") + "\n",
    "utf-8",
  );

  await writeFile(
    join(itemsDir, "ALS-002.md"),
    [
      "---",
      "id: ALS-002",
      "type: work-item",
      "status: in-review",
      "title: Validate dashboard parity",
      "---",
      "",
      "Dashboard fixture item two.",
    ].join("\n") + "\n",
    "utf-8",
  );

  const fixture: DashboardFixture = {
    root,
    bundleRoot,
    statusFile,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
    writeHeartbeat: async (overrides = {}) => {
      const heartbeat: FixtureHeartbeat = {
        name: "factory-jobs",
        pid: process.pid,
        last_tick: new Date().toISOString(),
        poll_ms: 1000,
        active_dispatches: 1,
        items_scanned: 2,
        ...overrides,
      };

      await writeFile(statusFile, JSON.stringify(heartbeat, null, 2) + "\n", "utf-8");
    },
    appendSuccess: async (itemId = "ALS-001") => {
      await appendTelemetryEvent(bundleRoot, buildTelemetryEvent(itemId, "dispatch_finish", null));
    },
    appendFailure: async (itemId = "ALS-002", error = "Agent execution failed") => {
      await appendTelemetryEvent(bundleRoot, buildTelemetryEvent(itemId, "dispatch_failure", error));
    },
  };

  await fixture.writeHeartbeat();
  return fixture;
}

function buildTelemetryEvent(
  itemId: string,
  eventType: DispatchTelemetryEvent["event_type"],
  error: string | null,
): DispatchTelemetryEvent {
  return {
    schema: DISPATCH_TELEMETRY_SCHEMA,
    event_id: `${itemId}-${eventType}`,
    event_type: eventType,
    timestamp: new Date().toISOString(),
    dispatcher_name: "factory-jobs",
    module_id: "factory",
    item_id: itemId,
    item_file: `/tmp/${itemId}.md`,
    state: eventType === "dispatch_failure" ? "in-review" : "in-dev",
    agent_name: "in-dev",
    sub_agent_name: null,
    delegated: false,
    resumable: false,
    resume_requested: false,
    session_field: null,
    runtime_session_id: null,
    resume_session_id: null,
    worker_session_id: null,
    transition_targets: ["in-review"],
    duration_ms: 1500,
    num_turns: 7,
    cost_usd: 0.31,
    error,
  };
}
