import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  appendTelemetryEvent,
  DISPATCH_TELEMETRY_SCHEMA,
  type DispatchTelemetryEvent,
} from "../../skills/new/references/dispatcher/src/telemetry.ts";
import {
  DELAMAIN_RUNTIME_STATE_SCHEMA,
  type RuntimeDispatchRecord,
  writeRuntimeState,
} from "../../skills/new/references/dispatcher/src/runtime-state.ts";
import { runGit } from "../../skills/new/references/dispatcher/src/git.ts";
import type { DashboardSnapshot, DispatcherSnapshot } from "./feed/types.ts";

export interface DashboardFixture {
  root: string;
  bundleRoot: string;
  statusFile: string;
  cleanup(): Promise<void>;
  writeHeartbeat(overrides?: Partial<FixtureHeartbeat>): Promise<void>;
  writeRuntimeRecords(records: RuntimeDispatchRecord[]): Promise<void>;
  appendSuccess(itemId?: string): Promise<void>;
  appendFailure(itemId?: string, error?: string): Promise<void>;
}

export interface DesignFixtureOptions {
  generatedAt?: string;
}

interface FixtureHeartbeat {
  name: string;
  pid: number;
  last_tick: string;
  poll_ms: number;
  active_dispatches: number;
  blocked_dispatches: number;
  orphaned_dispatches: number;
  guarded_dispatches: number;
  delegated_dispatches: number;
  items_scanned: number;
}

const DESIGN_GENERATED_AT = "2026-04-17T10:20:00.000Z";
const DESIGN_SYSTEM_ROOT = "/tmp/als/reference-system";
const DESIGN_ROOTS = [
  "/tmp/als/reference-system",
  "/tmp/als/customer-system",
];

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

  await runGit(root, ["init"]);
  await runGit(root, ["branch", "-M", "main"]);
  await runGit(root, ["add", "."]);
  await runGit(
    root,
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@local",
      "commit",
      "--no-gpg-sign",
      "-m",
      "fixture: initial commit",
    ],
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
        blocked_dispatches: 0,
        orphaned_dispatches: 0,
        guarded_dispatches: 0,
        delegated_dispatches: 0,
        items_scanned: 2,
        ...overrides,
      };

      await writeFile(statusFile, JSON.stringify(heartbeat, null, 2) + "\n", "utf-8");
    },
    writeRuntimeRecords: async (records) => {
      await writeRuntimeState(bundleRoot, {
        schema: DELAMAIN_RUNTIME_STATE_SCHEMA,
        updated_at: new Date().toISOString(),
        records,
      });
    },
    appendSuccess: async (itemId = "ALS-001") => {
      await appendTelemetryEvent(bundleRoot, buildTelemetryEvent(itemId, "dispatch_finish", null));
    },
    appendFailure: async (itemId = "ALS-002", error = "Agent execution failed") => {
      await appendTelemetryEvent(bundleRoot, buildTelemetryEvent(itemId, "dispatch_failure", error));
    },
  };

  await fixture.writeHeartbeat();
  await fixture.writeRuntimeRecords([
    runtimeRecord({
      itemId: "ALS-001",
      state: "in-dev",
      status: "active",
      branchName: "delamain/factory-jobs/ALS-001/d-test",
      worktreePath: "/tmp/.worktrees/delamain/factory-jobs/ALS-001/d-test",
    }),
  ]);
  return fixture;
}

export function createDesignDashboardSnapshot(
  options: DesignFixtureOptions = {},
): DashboardSnapshot {
  const generatedAt = options.generatedAt ?? DESIGN_GENERATED_AT;

  const dispatchers: DispatcherSnapshot[] = [
    {
      name: "als-factory-jobs",
      systemRoot: DESIGN_SYSTEM_ROOT,
      bundleRoot: "/tmp/als/reference-system/.claude/delamains/als-factory-jobs",
      state: "live",
      detail: "1 active dispatch",
      heartbeat: {
        name: "als-factory-jobs",
        pid: 4242,
        lastTick: "2026-04-17T10:19:56.000Z",
        pollMs: 2000,
        activeDispatches: 1,
        blockedDispatches: 0,
        orphanedDispatches: 0,
        guardedDispatches: 0,
        delegatedDispatches: 0,
        itemsScanned: 15,
      },
      pidLive: true,
      lastTickAgeMs: 4_000,
      pollMs: 2_000,
      activeDispatches: 1,
      itemsScanned: 15,
      moduleId: "als-factory",
      moduleVersion: 4,
      moduleMountPath: "workspace/factory",
      entityName: "job",
      entityPath: "jobs/{id}.md",
      statusField: "status",
      phaseOrder: ["draft", "research", "planning", "dev", "review", "uat", "done"],
      states: {
        drafted: { actor: "agent", phase: "draft", initial: true, terminal: false },
        research: { actor: "agent", phase: "research", initial: false, terminal: false },
        planning: { actor: "agent", phase: "planning", initial: false, terminal: false },
        "in-dev": { actor: "agent", phase: "dev", initial: false, terminal: false },
        "in-review": { actor: "agent", phase: "review", initial: false, terminal: false },
        uat: { actor: "operator", phase: "uat", initial: false, terminal: false },
        completed: { actor: null, phase: "done", initial: false, terminal: true },
      },
      items: [
        createItem("ALS-001", "drafted"),
        createItem("ALS-004", "drafted"),
        createItem("ALS-005", "drafted"),
        createItem("ALS-006", "research"),
        createItem("ALS-007", "in-dev"),
        createItem("ALS-008", "uat"),
        createItem("ALS-009", "uat"),
        createItem("ALS-010", "completed"),
        createItem("ALS-011", "completed"),
        createItem("ALS-012", "completed"),
        createItem("ALS-013", "completed"),
        createItem("ALS-014", "completed"),
        createItem("ALS-015", "completed"),
        createItem("ALS-016", "completed"),
        createItem("ALS-017", "completed"),
      ],
      itemSummary: {
        totalItems: 15,
        byState: {
          drafted: 3,
          research: 1,
          "in-dev": 1,
          uat: 2,
          completed: 8,
        },
        byActor: {
          agent: 5,
          operator: 2,
          terminal: 8,
          unknown: 0,
        },
      },
      recentEvents: [
        telemetryEvent({
          eventType: "dispatch_finish",
          timestamp: "2026-04-17T10:06:12.000Z",
          itemId: "ALS-002",
          state: "research",
          transitionTargets: ["planning"],
          durationMs: 63_000,
          numTurns: 6,
          costUsd: 0.21,
        }),
        telemetryEvent({
          eventType: "dispatch_finish",
          timestamp: "2026-04-17T10:14:18.000Z",
          itemId: "ALS-003",
          state: "planning",
          transitionTargets: ["in-dev"],
          durationMs: 94_000,
          numTurns: 7,
          costUsd: 0.34,
        }),
        telemetryEvent({
          eventType: "dispatch_start",
          timestamp: "2026-04-17T10:19:15.000Z",
          itemId: "ALS-006",
          state: "research",
          transitionTargets: ["planning"],
          numTurns: 8,
          workerSessionId: "sess-als-006",
        }),
      ],
      recentRun: {
        outcome: "success",
        timestamp: "2026-04-17T10:14:18.000Z",
        itemId: "ALS-003",
        state: "planning",
        durationMs: 94_000,
        numTurns: 7,
        costUsd: 0.34,
        error: null,
        sessionId: "sess-als-003",
      },
      recentError: null,
      runtime: {
        available: true,
        path: "/tmp/als/reference-system/.claude/delamains/als-factory-jobs/runtime/worktree-state.json",
        active: [
          runtimeRecord({
            itemId: "ALS-006",
            state: "research",
            status: "active",
            branchName: "delamain/als-factory-jobs/ALS-006/d-abc123def456",
            worktreePath: "/tmp/.worktrees/delamain/als-factory-jobs/ALS-006/d-abc123def456",
            startedAt: "2026-04-17T10:19:15.000Z",
          }),
        ],
        blocked: [],
        orphaned: [],
        guarded: [],
        delegated: [],
      },
      telemetry: {
        available: true,
        legacyMode: false,
        path: "/tmp/als/reference-system/.claude/delamains/als-factory-jobs/telemetry/events.jsonl",
        parseErrors: 0,
      },
    },
    {
      name: "ghost-factory-jobs",
      systemRoot: DESIGN_SYSTEM_ROOT,
      bundleRoot: "/tmp/als/reference-system/.claude/delamains/ghost-factory-jobs",
      state: "idle",
      detail: "Dispatcher is idle",
      heartbeat: {
        name: "ghost-factory-jobs",
        pid: 4343,
        lastTick: "2026-04-17T10:19:49.000Z",
        pollMs: 3000,
        activeDispatches: 0,
        blockedDispatches: 1,
        orphanedDispatches: 0,
        guardedDispatches: 0,
        delegatedDispatches: 0,
        itemsScanned: 9,
      },
      pidLive: true,
      lastTickAgeMs: 11_000,
      pollMs: 3_000,
      activeDispatches: 0,
      itemsScanned: 9,
      moduleId: "ghost-factory",
      moduleVersion: 2,
      moduleMountPath: "workspace/ghost",
      entityName: "task",
      entityPath: "items/{id}.md",
      statusField: "status",
      phaseOrder: ["draft", "dev", "review", "done"],
      states: {
        drafted: { actor: "agent", phase: "draft", initial: true, terminal: false },
        "in-dev": { actor: "agent", phase: "dev", initial: false, terminal: false },
        "in-review": { actor: "operator", phase: "review", initial: false, terminal: false },
        completed: { actor: null, phase: "done", initial: false, terminal: true },
      },
      items: [
        createGhostItem("GHOST-141", "drafted"),
        createGhostItem("GHOST-142", "in-dev"),
        createGhostItem("GHOST-143", "in-review"),
        createGhostItem("GHOST-144", "completed"),
      ],
      itemSummary: {
        totalItems: 4,
        byState: {
          drafted: 1,
          "in-dev": 1,
          "in-review": 1,
          completed: 1,
        },
        byActor: {
          agent: 2,
          operator: 1,
          terminal: 1,
          unknown: 0,
        },
      },
      recentEvents: [
        telemetryEvent({
          dispatcherName: "ghost-factory-jobs",
          moduleId: "ghost-factory",
          eventType: "dispatch_finish",
          timestamp: "2026-04-17T10:11:01.000Z",
          itemId: "GHOST-143",
          state: "in-dev",
          transitionTargets: ["in-review"],
          durationMs: 52_000,
          numTurns: 5,
          costUsd: 0.16,
        }),
      ],
      recentRun: {
        outcome: "success",
        timestamp: "2026-04-17T10:11:01.000Z",
        itemId: "GHOST-143",
        state: "in-dev",
        durationMs: 52_000,
        numTurns: 5,
        costUsd: 0.16,
        error: null,
        sessionId: "sess-ghost-143",
      },
      recentError: null,
      runtime: {
        available: true,
        path: "/tmp/als/reference-system/.claude/delamains/ghost-factory-jobs/runtime/worktree-state.json",
        active: [],
        blocked: [
          runtimeRecord({
            itemId: "GHOST-142",
            state: "in-dev",
            status: "blocked",
            branchName: "delamain/ghost-factory-jobs/GHOST-142/d-merge1",
            worktreePath: "/tmp/.worktrees/delamain/ghost-factory-jobs/GHOST-142/d-merge1",
            incident: {
              kind: "merge_conflict",
              message: "Operator changed the same file during integration",
              detected_at: "2026-04-17T10:18:00.000Z",
            },
          }),
        ],
        orphaned: [],
        guarded: [],
        delegated: [],
      },
      telemetry: {
        available: true,
        legacyMode: false,
        path: "/tmp/als/reference-system/.claude/delamains/ghost-factory-jobs/telemetry/events.jsonl",
        parseErrors: 0,
      },
    },
    {
      name: "research-pipeline",
      systemRoot: DESIGN_SYSTEM_ROOT,
      bundleRoot: "/tmp/als/reference-system/.claude/delamains/research-pipeline",
      state: "stale",
      detail: "Heartbeat is older than 60000ms",
      heartbeat: {
        name: "research-pipeline",
        pid: 4545,
        lastTick: "2026-04-17T10:17:55.000Z",
        pollMs: 5000,
        activeDispatches: 0,
        blockedDispatches: 0,
        orphanedDispatches: 1,
        guardedDispatches: 0,
        delegatedDispatches: 0,
        itemsScanned: 7,
      },
      pidLive: true,
      lastTickAgeMs: 125_000,
      pollMs: 5_000,
      activeDispatches: 0,
      itemsScanned: 7,
      moduleId: "research",
      moduleVersion: 3,
      moduleMountPath: "workspace/research",
      entityName: "study",
      entityPath: "studies/{id}.md",
      statusField: "status",
      phaseOrder: ["draft", "research", "review", "done"],
      states: {
        drafted: { actor: "agent", phase: "draft", initial: true, terminal: false },
        researching: { actor: "agent", phase: "research", initial: false, terminal: false },
        review: { actor: "operator", phase: "review", initial: false, terminal: false },
        completed: { actor: null, phase: "done", initial: false, terminal: true },
      },
      items: [
        createResearchItem("RSH-011", "researching"),
        createResearchItem("RSH-012", "researching"),
        createResearchItem("RSH-013", "review"),
        createResearchItem("RSH-014", "completed"),
      ],
      itemSummary: {
        totalItems: 4,
        byState: {
          researching: 2,
          review: 1,
          completed: 1,
        },
        byActor: {
          agent: 2,
          operator: 1,
          terminal: 1,
          unknown: 0,
        },
      },
      recentEvents: [],
      recentRun: null,
      recentError: null,
      runtime: {
        available: true,
        path: "/tmp/als/reference-system/.claude/delamains/research-pipeline/runtime/worktree-state.json",
        active: [],
        blocked: [],
        orphaned: [
          runtimeRecord({
            itemId: "RSH-012",
            state: "researching",
            status: "orphaned",
            branchName: "delamain/research-pipeline/RSH-012/d-lost1",
            worktreePath: "/tmp/.worktrees/delamain/research-pipeline/RSH-012/d-lost1",
            incident: {
              kind: "stale_dispatch",
              message: "Dispatcher died while the worktree still had preserved work",
              detected_at: "2026-04-17T10:18:12.000Z",
            },
          }),
        ],
        guarded: [],
        delegated: [],
      },
      telemetry: {
        available: false,
        legacyMode: true,
        path: "/tmp/als/reference-system/.claude/delamains/research-pipeline/telemetry/events.jsonl",
        parseErrors: 0,
      },
    },
    {
      name: "ops-incident-feed",
      systemRoot: DESIGN_SYSTEM_ROOT,
      bundleRoot: "/tmp/als/reference-system/.claude/delamains/ops-incident-feed",
      state: "error",
      detail: "Last run failed on OPS-221",
      heartbeat: {
        name: "ops-incident-feed",
        pid: 4646,
        lastTick: "2026-04-17T10:19:44.000Z",
        pollMs: 4000,
        activeDispatches: 0,
        blockedDispatches: 0,
        orphanedDispatches: 0,
        guardedDispatches: 0,
        delegatedDispatches: 0,
        itemsScanned: 5,
      },
      pidLive: true,
      lastTickAgeMs: 16_000,
      pollMs: 4_000,
      activeDispatches: 0,
      itemsScanned: 5,
      moduleId: "ops",
      moduleVersion: 5,
      moduleMountPath: "workspace/ops",
      entityName: "incident",
      entityPath: "incidents/{id}.md",
      statusField: "status",
      phaseOrder: ["triage", "investigate", "review", "done"],
      states: {
        triage: { actor: "agent", phase: "triage", initial: true, terminal: false },
        investigating: { actor: "agent", phase: "investigate", initial: false, terminal: false },
        review: { actor: "operator", phase: "review", initial: false, terminal: false },
        resolved: { actor: null, phase: "done", initial: false, terminal: true },
      },
      items: [
        createOpsItem("OPS-221", "review"),
        createOpsItem("OPS-222", "investigating"),
        createOpsItem("OPS-223", "resolved"),
      ],
      itemSummary: {
        totalItems: 3,
        byState: {
          review: 1,
          investigating: 1,
          resolved: 1,
        },
        byActor: {
          agent: 1,
          operator: 1,
          terminal: 1,
          unknown: 0,
        },
      },
      recentEvents: [
        telemetryEvent({
          dispatcherName: "ops-incident-feed",
          moduleId: "ops",
          eventType: "dispatch_failure",
          timestamp: "2026-04-17T10:17:09.000Z",
          itemId: "OPS-221",
          state: "review",
          transitionTargets: ["resolved"],
          durationMs: 81_000,
          numTurns: 9,
          costUsd: 0.49,
          error: "Human review blocked merge window",
        }),
      ],
      recentRun: {
        outcome: "failure",
        timestamp: "2026-04-17T10:17:09.000Z",
        itemId: "OPS-221",
        state: "review",
        durationMs: 81_000,
        numTurns: 9,
        costUsd: 0.49,
        error: "Human review blocked merge window",
        sessionId: "sess-ops-221",
      },
      recentError: {
        timestamp: "2026-04-17T10:17:09.000Z",
        itemId: "OPS-221",
        state: "review",
        error: "Human review blocked merge window",
      },
      runtime: {
        available: false,
        path: "/tmp/als/reference-system/.claude/delamains/ops-incident-feed/runtime/worktree-state.json",
        active: [],
        blocked: [],
        orphaned: [],
        guarded: [],
        delegated: [],
      },
      telemetry: {
        available: true,
        legacyMode: false,
        path: "/tmp/als/reference-system/.claude/delamains/ops-incident-feed/telemetry/events.jsonl",
        parseErrors: 1,
      },
    },
  ];

  return {
    schema: "als-delamain-dashboard-snapshot@1",
    generatedAt,
    systemRoot: DESIGN_SYSTEM_ROOT,
    roots: DESIGN_ROOTS,
    dispatcherCount: dispatchers.length,
    dispatchers,
  };
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
    dispatch_id: `d-${itemId.toLowerCase()}`,
    item_id: itemId,
    item_file: `/tmp/${itemId}.md`,
    isolated_item_file: `/tmp/.worktrees/${itemId}.md`,
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
    worktree_path: `/tmp/.worktrees/${itemId}`,
    branch_name: `delamain/factory-jobs/${itemId}/d-${itemId.toLowerCase()}`,
    worktree_commit: null,
    integrated_commit: null,
    merge_outcome: eventType === "dispatch_failure" ? "blocked" : "merged",
    incident_kind: eventType === "dispatch_failure" ? "merge_conflict" : null,
    transition_targets: ["in-review"],
    duration_ms: 1500,
    num_turns: 7,
    cost_usd: 0.31,
    error,
  };
}

function createGhostItem(id: string, status: string) {
  return createItem(id, status, "task", "/tmp/als/reference-system/workspace/ghost/items");
}

function createItem(
  id: string,
  status: string,
  type = "job",
  root = "/tmp/als/reference-system/workspace/factory/jobs",
) {
  return {
    id,
    status,
    type,
    filePath: `${root}/${id}.md`,
  };
}

function createOpsItem(id: string, status: string) {
  return createItem(id, status, "incident", "/tmp/als/reference-system/workspace/ops/incidents");
}

function createResearchItem(id: string, status: string) {
  return createItem(id, status, "study", "/tmp/als/reference-system/workspace/research/studies");
}

function telemetryEvent(input: {
  costUsd?: number | null;
  dispatcherName?: string;
  durationMs?: number | null;
  error?: string | null;
  eventType: DispatchTelemetryEvent["event_type"];
  itemId: string;
  moduleId?: string;
  numTurns?: number | null;
  state: string;
  timestamp: string;
  transitionTargets?: string[];
  workerSessionId?: string | null;
}): DispatchTelemetryEvent {
  return {
    schema: DISPATCH_TELEMETRY_SCHEMA,
    event_id: `${input.itemId}-${input.eventType}-${input.timestamp}`,
    event_type: input.eventType,
    timestamp: input.timestamp,
    dispatcher_name: input.dispatcherName ?? "als-factory-jobs",
    module_id: input.moduleId ?? "als-factory",
    dispatch_id: `d-${input.itemId.toLowerCase()}`,
    item_id: input.itemId,
    item_file: `/tmp/${input.itemId}.md`,
    isolated_item_file: `/tmp/.worktrees/${input.itemId}.md`,
    state: input.state,
    agent_name: input.state,
    sub_agent_name: null,
    delegated: false,
    resumable: false,
    resume_requested: false,
    session_field: null,
    runtime_session_id: null,
    resume_session_id: null,
    worker_session_id: input.workerSessionId ?? null,
    worktree_path: `/tmp/.worktrees/${input.itemId}`,
    branch_name: `delamain/${input.dispatcherName ?? "als-factory-jobs"}/${input.itemId}/d-${input.itemId.toLowerCase()}`,
    worktree_commit: null,
    integrated_commit: null,
    merge_outcome: input.eventType === "dispatch_failure" ? "blocked" : "merged",
    incident_kind: input.eventType === "dispatch_failure" ? "merge_conflict" : null,
    transition_targets: input.transitionTargets ?? [],
    duration_ms: input.durationMs ?? null,
    num_turns: input.numTurns ?? null,
    cost_usd: input.costUsd ?? null,
    error: input.error ?? null,
  };
}

function runtimeRecord(input: {
  itemId: string;
  state: string;
  status: RuntimeDispatchRecord["status"];
  branchName: string;
  worktreePath: string;
  startedAt?: string;
  incident?: RuntimeDispatchRecord["incident"];
}): RuntimeDispatchRecord {
  return {
    dispatch_id: `d-${input.itemId.toLowerCase()}`,
    item_id: input.itemId,
    item_file: `/tmp/${input.itemId}.md`,
    isolated_item_file: `/tmp/worktrees/${input.itemId}.md`,
    state: input.state,
    agent_name: input.state,
    dispatcher_name: "fixture-dispatcher",
    delegated: false,
    resumable: false,
    session_field: null,
    status: input.status,
    worktree_path: input.worktreePath,
    branch_name: input.branchName,
    base_commit: "1111111111111111111111111111111111111111",
    mounted_submodules: [],
    worktree_commit: null,
    integrated_commit: null,
    started_at: input.startedAt ?? "2026-04-17T10:19:15.000Z",
    updated_at: "2026-04-17T10:19:30.000Z",
    heartbeat_at: input.status === "active" ? "2026-04-17T10:19:30.000Z" : null,
    owner_pid: process.pid,
    transition_targets: ["in-review"],
    merge_outcome: "pending",
    merge_attempted_at: null,
    merge_message: null,
    latest_error: input.incident?.message ?? null,
    latest_session_id: null,
    latest_duration_ms: null,
    latest_num_turns: null,
    latest_cost_usd: null,
    incident: input.incident ?? null,
  };
}
