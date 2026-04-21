import { readFile } from "fs/promises";
import { basename, join } from "path";
import { parse as parseYaml } from "yaml";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { resolveDispatchLimits } from "./dispatch-limits.js";
import { DispatcherRuntime } from "./dispatcher-runtime.js";
import { parseMd, readFrontmatterField, setFrontmatterField } from "./frontmatter.js";
import { buildSessionRuntimeState, shouldPersistDispatcherSession } from "./session-runtime.js";
import { loadRuntimeManifest } from "./runtime-manifest.js";
import {
  appendTelemetryEvent,
  DISPATCH_TELEMETRY_SCHEMA,
  type DispatchTelemetryEvent,
} from "./telemetry.js";

interface Transition {
  class: string;
  from: string | string[];
  to: string;
}

interface StateDef {
  phase: string;
  initial?: boolean;
  terminal?: boolean;
  actor?: string;
  path?: string;
  resumable?: boolean;
  delegated?: boolean;
  "session-field"?: string;
  "sub-agent"?: string;
}

interface DelamainConfig {
  phases: string[];
  states: Record<string, StateDef>;
  transitions: Transition[];
}

interface AgentDef {
  description: string;
  prompt: string;
  tools?: string[];
  model?: "sonnet" | "opus" | "haiku";
}

export interface DispatchEntry {
  state: string;
  agentName: string;
  subAgentName?: string;
  resumable: boolean;
  delegated: boolean;
  sessionField?: string;
  transitions: Array<Pick<Transition, "class" | "to">>;
}

export interface ResolvedConfig {
  systemRoot: string;
  moduleId: string;
  moduleRoot: string;
  entityName: string;
  entityPath: string;
  statusField: string;
  delamainName: string;
  submodules: string[];
  maxTurns: number;
  maxBudgetUsd: number;
  discriminatorField?: string;
  discriminatorValue?: string;
  agents: Record<string, AgentDef>;
  allStates: string[];
  dispatchTable: DispatchEntry[];
}

export async function resolve(
  bundleRoot: string,
  systemRoot: string,
): Promise<ResolvedConfig> {
  const manifest = await loadRuntimeManifest(bundleRoot);
  const effectiveLimits = resolveDispatchLimits(manifest.limits);
  const moduleRoot = join(systemRoot, manifest.module_mount_path);
  const delamain = parseYaml(
    await readFile(join(bundleRoot, "delamain.yaml"), "utf-8"),
  ) as DelamainConfig;

  const agents: Record<string, AgentDef> = {};

  async function loadAgent(agentKey: string, agentPath: string) {
    try {
      const { meta, body } = parseMd(
        await readFile(join(bundleRoot, agentPath), "utf-8"),
      );
      if (!body) return;

      const def: AgentDef = {
        description: meta["description"] ?? "",
        prompt: body,
      };
      if (meta["tools"]) {
        def.tools = meta["tools"].split(",").map((tool) => tool.trim());
      }
      if (
        meta["model"]
        && ["sonnet", "opus", "haiku"].includes(meta["model"])
      ) {
        def.model = meta["model"] as AgentDef["model"];
      }

      agents[agentKey] = def;
    } catch (error) {
      console.warn(
        `[dispatcher] skipping agent '${agentKey}' at '${agentPath}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const [stateId, state] of Object.entries(delamain.states)) {
    if (state.actor !== "agent" || !state.path) continue;
    await loadAgent(stateId, state.path);

    const subAgentPath = state["sub-agent"];
    if (subAgentPath) {
      const subAgentName = basename(subAgentPath, ".md");
      if (!agents[subAgentName]) {
        await loadAgent(subAgentName, subAgentPath);
      }
    }
  }

  const dispatchTable: DispatchEntry[] = [];
  for (const [stateId, state] of Object.entries(delamain.states)) {
    if (state.actor !== "agent" || !state.path || !agents[stateId]) continue;

    const transitions = delamain.transitions
      .filter((transition) => {
        const sources = Array.isArray(transition.from) ? transition.from : [transition.from];
        return sources.includes(stateId);
      })
      .map((transition) => ({ class: transition.class, to: transition.to }));

    const subAgentPath = state["sub-agent"];

    dispatchTable.push({
      state: stateId,
      agentName: stateId,
      subAgentName: subAgentPath ? basename(subAgentPath, ".md") : undefined,
      resumable: state.resumable === true,
      delegated: state.delegated === true,
      sessionField: state.resumable ? state["session-field"] : undefined,
      transitions,
    });
  }

  return {
    systemRoot,
    moduleId: manifest.module_id,
    moduleRoot,
    entityName: manifest.entity_name,
    entityPath: manifest.entity_path,
    statusField: manifest.status_field,
    delamainName: manifest.delamain_name,
    submodules: manifest.submodules,
    maxTurns: effectiveLimits.maxTurns,
    maxBudgetUsd: effectiveLimits.maxBudgetUsd,
    discriminatorField: manifest.discriminator_field ?? undefined,
    discriminatorValue: manifest.discriminator_value ?? undefined,
    agents,
    allStates: Object.keys(delamain.states),
    dispatchTable,
  };
}

const sdkEnv: Record<string, string | undefined> = { ...process.env };
delete sdkEnv["ANTHROPIC_API_KEY"];
sdkEnv["DELAMAIN_SESSION"] = "1";

const today = () => new Date().toISOString().slice(0, 10);

function formatToolUse(name: string, input: Record<string, unknown>): string {
  const path = input["file_path"] as string | undefined;
  if (path) return `${name} ${path}`;
  const cmd = input["command"] as string | undefined;
  if (cmd) return `${name} ${cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd}`;
  const pattern = input["pattern"] as string | undefined;
  if (pattern) return `${name} ${pattern}`;
  const desc = input["description"] as string | undefined;
  if (desc) return `${name}: ${desc}`;
  return name;
}

export async function dispatch(
  itemId: string,
  itemFile: string,
  entry: DispatchEntry,
  agents: Record<string, AgentDef>,
  config: Pick<ResolvedConfig, "moduleId" | "delamainName" | "maxTurns" | "maxBudgetUsd">,
  bundleRoot: string,
  runtime: DispatcherRuntime,
): Promise<{ success: boolean; blocked: boolean; sessionId?: string; dispatchId?: string }> {
  const agent = agents[entry.agentName]!;
  const prepared = await runtime.prepareDispatch(itemId, itemFile, entry);
  if (!prepared) {
    console.log(`[dispatcher] ${itemId} skipped: runtime registry already owns this item`);
    return { success: false, blocked: true };
  }
  const isolatedItemFile = prepared.isolatedItemFile;

  let storedSessionId: string | null = null;
  if (entry.sessionField) {
    try {
      storedSessionId = await readFrontmatterField(isolatedItemFile, entry.sessionField);
    } catch (error) {
      await runtime.finalizeDispatch({
        prepared,
        entry,
        sessionId: null,
        durationMs: 0,
        numTurns: null,
        costUsd: null,
        success: false,
      });
      console.error(
        `[dispatcher] ${itemId} failed reading session metadata from ${entry.sessionField}:`,
        error instanceof Error ? error.message : error,
      );
      return { success: false, blocked: false, dispatchId: prepared.dispatchId };
    }
  }

  const sessionState = buildSessionRuntimeState(entry, storedSessionId);
  if (sessionState.ignoredInvalidSessionId) {
    console.log(
      `[dispatcher] ${itemId} ignoring invalid session ID: ${sessionState.ignoredInvalidSessionId}`,
    );
  }

  const transitionLines = entry.transitions.map(
    (transition) => `- ${transition.class} → ${transition.to}`,
  );
  const sessionContext: string[] = [];
  if (sessionState.includeRuntimeKeys) {
    sessionContext.push(`session_field: ${sessionState.runtimeSessionField ?? "null"}`);
    sessionContext.push(`session_id: ${sessionState.runtimeSessionId ?? "null"}`);
  }

  const prompt = [
    agent.prompt,
    "",
    "---",
    "",
    "## Runtime Context",
    "",
    `item_id: ${itemId}`,
    `item_file: ${isolatedItemFile}`,
    `current_state: ${entry.state}`,
    `date: ${today()}`,
    `resume: ${sessionState.resume}`,
    `worktree_path: ${prepared.worktreePath}`,
    `worktree_branch: ${prepared.branchName}`,
    ...sessionContext,
    "",
    "legal_transitions:",
    ...transitionLines,
  ].join("\n");

  const tools = [...(agent.tools ?? ["Read", "Edit"])];
  let subAgents: Record<string, AgentDef> | undefined;
  if (entry.subAgentName && agents[entry.subAgentName]) {
    if (!tools.includes("Agent")) tools.push("Agent");
    subAgents = { [entry.subAgentName]: agents[entry.subAgentName]! };
  }

  console.log(
    `[dispatcher] ${itemId} @ current state: ${entry.state}`
      + (entry.delegated ? " (delegated)" : "")
      + (sessionState.resumeSessionId
        ? ` (resume: ${sessionState.resumeSessionId.slice(0, 8)}...)`
        : "")
      + ` (worktree: ${prepared.branchName})`
      + (entry.subAgentName ? ` (+ sub-agent: ${entry.subAgentName})` : ""),
  );

  let sessionId: string | undefined;
  let resultSummary:
    | {
      subtype: string;
      totalCostUsd: number | null;
      durationMs: number;
      numTurns: number;
    }
    | null = null;
  const startedAt = Date.now();
  const baseEvent = {
    schema: DISPATCH_TELEMETRY_SCHEMA,
    dispatcher_name: config.delamainName,
    module_id: config.moduleId,
    dispatch_id: prepared.dispatchId,
    item_id: itemId,
    item_file: itemFile,
    isolated_item_file: isolatedItemFile,
    state: entry.state,
    agent_name: entry.agentName,
    sub_agent_name: entry.subAgentName ?? null,
    delegated: entry.delegated,
    resumable: entry.resumable,
    resume_requested: sessionState.resume === "yes",
    session_field: entry.sessionField ?? null,
    runtime_session_id: sessionState.runtimeSessionId ?? null,
    resume_session_id: sessionState.resumeSessionId ?? null,
    worktree_path: prepared.worktreePath,
    branch_name: prepared.branchName,
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
    merge_outcome: null,
    incident_kind: null,
    transition_targets: entry.transitions.map((transition) => transition.to),
  } satisfies Omit<
    DispatchTelemetryEvent,
    "event_id"
      | "event_type"
      | "timestamp"
      | "worker_session_id"
      | "duration_ms"
      | "num_turns"
      | "cost_usd"
      | "error"
  >;
  const heartbeat = setInterval(() => {
    void runtime.touchDispatch(prepared.dispatchId).catch((error) => {
      console.warn(
        `[dispatcher] ${itemId} heartbeat update failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }, 10_000);

  try {
    await writeTelemetry({
      ...baseEvent,
      event_id: crypto.randomUUID(),
      event_type: "dispatch_start",
      timestamp: new Date(startedAt).toISOString(),
      worker_session_id: null,
      duration_ms: null,
      num_turns: null,
      cost_usd: null,
      error: null,
    });
    await writeTelemetry({
      ...baseEvent,
      event_id: crypto.randomUUID(),
      event_type: "dispatch_prepare",
      timestamp: new Date(startedAt).toISOString(),
      worker_session_id: null,
      duration_ms: null,
      num_turns: null,
      cost_usd: null,
      error: null,
    });

    for await (const message of query({
      prompt,
      options: {
        cwd: prepared.worktreePath,
        model: agent.model ?? "sonnet",
        allowedTools: tools,
        ...(subAgents ? { agents: subAgents } : {}),
        ...(sessionState.resumeSessionId ? { resume: sessionState.resumeSessionId } : {}),
        env: sdkEnv,
        permissionMode: "acceptEdits",
        maxTurns: config.maxTurns,
        maxBudgetUsd: config.maxBudgetUsd,
      },
    })) {
      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
      }
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "tool_use") {
            const detail = formatToolUse(block.name, block.input as Record<string, unknown>);
            console.log(`[dispatcher]   ${itemId} | ${detail}`);
          }
        }
      }
      if (message.type === "result") {
        resultSummary = {
          subtype: message.subtype,
          totalCostUsd:
            typeof message.total_cost_usd === "number" ? message.total_cost_usd : null,
          durationMs: message.duration_ms,
          numTurns: message.num_turns,
        };
        const cost =
          message.subtype === "success"
            ? `$${message.total_cost_usd.toFixed(4)}`
            : message.subtype;
        const secs = Math.round(message.duration_ms / 1000);
        console.log(`[dispatcher] ${itemId} done (${cost}, ${secs}s, ${message.num_turns} turns)`);
      }
    }

    const dispatchSucceeded = resultSummary
      ? resultSummary.subtype === "success"
      : true;

    if (
      !entry.delegated
      && entry.resumable
      && entry.sessionField
      && sessionState.resume === "no"
      && !sessionId
    ) {
      console.warn(
        `[dispatcher] ${itemId} completed without SDK session id; skipping persistence for ${entry.sessionField}`,
      );
    }

    if (shouldPersistDispatcherSession(entry, sessionId, sessionState)) {
      const persisted = await setFrontmatterField(
        isolatedItemFile,
        entry.sessionField!,
        sessionId!,
      );
      if (persisted) {
        console.log(
          `[dispatcher] ${itemId} session persisted → ${entry.sessionField}`,
        );
      }
    }

    const finalized = await runtime.finalizeDispatch({
      prepared,
      entry,
      sessionId: sessionId ?? null,
      durationMs: resultSummary?.durationMs ?? Date.now() - startedAt,
      numTurns: resultSummary?.numTurns ?? null,
      costUsd: resultSummary?.totalCostUsd ?? null,
      success: dispatchSucceeded,
    });

    if (finalized.mergeOutcome === "merged") {
      await writeTelemetry({
        ...baseEvent,
        event_id: crypto.randomUUID(),
        event_type: "dispatch_merge_success",
        timestamp: new Date().toISOString(),
        worker_session_id: sessionId ?? null,
        mounted_submodules: finalized.mountedSubmodules,
        worktree_commit: finalized.worktreeCommit,
        integrated_commit: finalized.integratedCommit,
        merge_outcome: finalized.mergeOutcome,
        incident_kind: null,
        duration_ms: resultSummary?.durationMs ?? Date.now() - startedAt,
        num_turns: resultSummary?.numTurns ?? null,
        cost_usd: resultSummary?.totalCostUsd ?? null,
        error: null,
      });
    } else if (finalized.blocked) {
      await writeTelemetry({
        ...baseEvent,
        event_id: crypto.randomUUID(),
        event_type: "dispatch_merge_blocked",
        timestamp: new Date().toISOString(),
        worker_session_id: sessionId ?? null,
        mounted_submodules: finalized.mountedSubmodules,
        worktree_commit: finalized.worktreeCommit,
        integrated_commit: finalized.integratedCommit,
        merge_outcome: finalized.mergeOutcome,
        incident_kind: finalized.incidentKind,
        duration_ms: resultSummary?.durationMs ?? Date.now() - startedAt,
        num_turns: resultSummary?.numTurns ?? null,
        cost_usd: resultSummary?.totalCostUsd ?? null,
        error: finalized.incidentMessage,
      });
    }

    if (!finalized.blocked) {
      await writeTelemetry({
        ...baseEvent,
        event_id: crypto.randomUUID(),
        event_type: "dispatch_cleanup",
        timestamp: new Date().toISOString(),
        worker_session_id: sessionId ?? null,
        mounted_submodules: finalized.mountedSubmodules,
        worktree_commit: finalized.worktreeCommit,
        integrated_commit: finalized.integratedCommit,
        merge_outcome: finalized.mergeOutcome,
        incident_kind: null,
        duration_ms: resultSummary?.durationMs ?? Date.now() - startedAt,
        num_turns: resultSummary?.numTurns ?? null,
        cost_usd: resultSummary?.totalCostUsd ?? null,
        error: null,
      });
    }

    const overallSuccess = dispatchSucceeded && !finalized.blocked;
    await writeTelemetry({
      ...baseEvent,
      event_id: crypto.randomUUID(),
      event_type: overallSuccess ? "dispatch_finish" : "dispatch_failure",
      timestamp: new Date().toISOString(),
      worker_session_id: sessionId ?? null,
      mounted_submodules: finalized.mountedSubmodules,
      worktree_commit: finalized.worktreeCommit,
      integrated_commit: finalized.integratedCommit,
      merge_outcome: finalized.mergeOutcome,
      incident_kind: finalized.incidentKind,
      duration_ms: resultSummary?.durationMs ?? Date.now() - startedAt,
      num_turns: resultSummary?.numTurns ?? null,
      cost_usd: resultSummary?.totalCostUsd ?? null,
      error:
        finalized.incidentMessage
        ?? (dispatchSucceeded ? null : `result:${resultSummary?.subtype ?? "unknown"}`),
    });

    return {
      success: overallSuccess,
      blocked: finalized.blocked,
      sessionId,
      dispatchId: prepared.dispatchId,
    };
  } catch (error) {
    const finalized = await runtime.finalizeDispatch({
      prepared,
      entry,
      sessionId: sessionId ?? null,
      durationMs: Date.now() - startedAt,
      numTurns: resultSummary?.numTurns ?? null,
      costUsd: resultSummary?.totalCostUsd ?? null,
      success: false,
    });

    await writeTelemetry({
      ...baseEvent,
      event_id: crypto.randomUUID(),
      event_type: "dispatch_failure",
      timestamp: new Date().toISOString(),
      worker_session_id: sessionId ?? null,
      mounted_submodules: finalized.mountedSubmodules,
      worktree_commit: finalized.worktreeCommit,
      integrated_commit: finalized.integratedCommit,
      merge_outcome: finalized.mergeOutcome,
      incident_kind: finalized.incidentKind,
      duration_ms: Date.now() - startedAt,
      num_turns: resultSummary?.numTurns ?? null,
      cost_usd: resultSummary?.totalCostUsd ?? null,
      error: finalized.incidentMessage ?? (error instanceof Error ? error.message : String(error)),
    });
    console.error(
      `[dispatcher] ${itemId} failed:`,
      error instanceof Error ? error.message : error,
    );
    return {
      success: false,
      blocked: finalized.blocked,
      dispatchId: prepared.dispatchId,
    };
  } finally {
    clearInterval(heartbeat);
  }

  async function writeTelemetry(event: DispatchTelemetryEvent): Promise<void> {
    try {
      await appendTelemetryEvent(bundleRoot, event);
    } catch (error) {
      console.warn(
        `[dispatcher] ${itemId} telemetry write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
