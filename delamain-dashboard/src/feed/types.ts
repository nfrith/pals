import type { DispatchTelemetryEvent } from "../../../skills/new/references/dispatcher/src/telemetry.ts";
import type { RuntimeDispatchRecord } from "../../../skills/new/references/dispatcher/src/runtime-state.ts";

export type DispatcherLivenessState = "live" | "idle" | "offline" | "stale" | "error";

export interface DispatcherHeartbeat {
  name: string;
  pid: number | null;
  lastTick: string | null;
  pollMs: number | null;
  activeDispatches: number;
  activeByProvider: {
    anthropic: number;
    openai: number;
  };
  blockedDispatches: number;
  orphanedDispatches: number;
  guardedDispatches: number;
  itemsScanned: number;
}

export interface DispatcherDefinitionState {
  actor: "agent" | "operator" | null;
  phase: string | null;
  initial: boolean;
  terminal: boolean;
}

export interface DispatcherDefinition {
  phases: string[];
  states: Record<string, DispatcherDefinitionState>;
}

export interface DispatcherItemRecord {
  id: string;
  status: string;
  type: string;
  filePath: string;
}

export interface DispatcherItemSummary {
  totalItems: number;
  byState: Record<string, number>;
  byActor: {
    agent: number;
    operator: number;
    terminal: number;
    unknown: number;
  };
}

export interface DispatcherRecentRun {
  outcome: "success" | "failure";
  timestamp: string;
  itemId: string;
  state: string;
  durationMs: number | null;
  numTurns: number | null;
  costUsd: number | null;
  error: string | null;
  sessionId: string | null;
}

export interface DispatcherRecentError {
  timestamp: string;
  itemId: string;
  state: string;
  error: string;
}

export interface DispatcherRuntimeState {
  available: boolean;
  path: string;
  active: RuntimeDispatchRecord[];
  blocked: RuntimeDispatchRecord[];
  orphaned: RuntimeDispatchRecord[];
  guarded: RuntimeDispatchRecord[];
}

export interface DispatcherSnapshot {
  name: string;
  systemRoot: string;
  bundleRoot: string;
  state: DispatcherLivenessState;
  detail: string;
  heartbeat: DispatcherHeartbeat | null;
  pidLive: boolean;
  lastTickAgeMs: number | null;
  pollMs: number | null;
  activeDispatches: number;
  itemsScanned: number;
  moduleId: string | null;
  moduleVersion: number | null;
  moduleMountPath: string | null;
  entityName: string | null;
  entityPath: string | null;
  statusField: string | null;
  phaseOrder: string[];
  states: Record<string, DispatcherDefinitionState>;
  items: DispatcherItemRecord[];
  itemSummary: DispatcherItemSummary;
  recentEvents: DispatchTelemetryEvent[];
  recentRun: DispatcherRecentRun | null;
  recentError: DispatcherRecentError | null;
  runtime: DispatcherRuntimeState;
  telemetry: {
    available: boolean;
    legacyMode: boolean;
    path: string;
    parseErrors: number;
  };
}

export interface DashboardSnapshot {
  schema: "als-delamain-dashboard-snapshot@1";
  generatedAt: string;
  systemRoot: string;
  roots: string[];
  dispatcherCount: number;
  dispatchers: DispatcherSnapshot[];
}
