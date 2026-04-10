import { readFile, writeFile } from "fs/promises";
import { basename, join } from "path";
import { parse as parseYaml } from "yaml";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildSessionRuntimeState, shouldPersistDispatcherSession } from "./session-runtime.js";

interface RuntimeManifest {
  schema: string;
  delamain_name: string;
  module_id: string;
  module_version: number;
  module_mount_path: string;
  entity_name: string;
  entity_path: string;
  status_field: string;
  discriminator_field: string | null;
  discriminator_value: string | null;
}

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
  discriminatorField?: string;
  discriminatorValue?: string;
  agents: Record<string, AgentDef>;
  allStates: string[];
  dispatchTable: DispatchEntry[];
}

const DELAMAIN_RUNTIME_MANIFEST_SCHEMA = "als-delamain-runtime-manifest@1";

function parseMd(raw: string): { meta: Record<string, string>; body: string } {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") return { meta: {}, body: raw };

  const meta: Record<string, string> = {};
  let end = 1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") {
      end = i + 1;
      break;
    }
    const c = lines[i]!.indexOf(":");
    if (c === -1) continue;
    meta[lines[i]!.slice(0, c).trim()] = lines[i]!.slice(c + 1).trim();
  }
  return { meta, body: lines.slice(end).join("\n").trim() };
}

async function readFrontmatterField(
  filePath: string,
  field: string,
): Promise<string | null> {
  const lines = (await readFile(filePath, "utf-8")).split("\n");
  if (lines[0]?.trim() !== "---") return null;

  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") break;
    const c = lines[i]!.indexOf(":");
    if (c === -1) continue;
    if (lines[i]!.slice(0, c).trim() !== field) continue;
    let val = lines[i]!.slice(c + 1).trim();
    if (val === "null" || val === "") return null;
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    return val;
  }
  return null;
}

async function setFrontmatterField(
  filePath: string,
  field: string,
  value: string,
): Promise<boolean> {
  const raw = await readFile(filePath, "utf-8");
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") {
    console.warn(
      `[dispatcher] could not persist ${field}: ${filePath} is missing YAML frontmatter fence`,
    );
    return false;
  }

  let closingFence = -1;
  let existingLine = -1;

  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") {
      closingFence = i;
      break;
    }
    const c = lines[i]!.indexOf(":");
    if (c !== -1 && lines[i]!.slice(0, c).trim() === field) {
      existingLine = i;
    }
  }

  if (closingFence === -1) {
    console.warn(
      `[dispatcher] could not persist ${field}: ${filePath} has malformed YAML frontmatter fence`,
    );
    return false;
  }

  if (existingLine !== -1) {
    lines[existingLine] = `${field}: ${value}`;
  } else {
    lines.splice(closingFence, 0, `${field}: ${value}`);
  }

  await writeFile(filePath, lines.join("\n"), "utf-8");
  return true;
}

async function loadRuntimeManifest(bundleRoot: string): Promise<RuntimeManifest> {
  const manifestPath = join(bundleRoot, "runtime-manifest.json");
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf-8");
  } catch (error) {
    throw new Error(
      `Missing runtime-manifest.json in '${bundleRoot}'. Redeploy this Delamain bundle with 'alsc deploy claude'.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid runtime-manifest.json in '${bundleRoot}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid runtime-manifest.json in '${bundleRoot}': expected an object`);
  }

  const manifest = parsed as Partial<RuntimeManifest>;
  const requiredStringFields: Array<keyof Pick<
    RuntimeManifest,
    "schema"
      | "delamain_name"
      | "module_id"
      | "module_mount_path"
      | "entity_name"
      | "entity_path"
      | "status_field"
  >> = [
    "schema",
    "delamain_name",
    "module_id",
    "module_mount_path",
    "entity_name",
    "entity_path",
    "status_field",
  ];

  for (const field of requiredStringFields) {
    if (typeof manifest[field] !== "string" || manifest[field]!.length === 0) {
      throw new Error(
        `Invalid runtime-manifest.json in '${bundleRoot}': '${field}' must be a non-empty string`,
      );
    }
  }

  if (manifest.schema !== DELAMAIN_RUNTIME_MANIFEST_SCHEMA) {
    throw new Error(
      `Invalid runtime-manifest.json in '${bundleRoot}': unsupported schema '${manifest.schema}'`,
    );
  }

  if (typeof manifest.module_version !== "number" || !Number.isInteger(manifest.module_version)) {
    throw new Error(
      `Invalid runtime-manifest.json in '${bundleRoot}': 'module_version' must be an integer`,
    );
  }

  for (const field of ["discriminator_field", "discriminator_value"] as const) {
    if (manifest[field] !== null && manifest[field] !== undefined && typeof manifest[field] !== "string") {
      throw new Error(
        `Invalid runtime-manifest.json in '${bundleRoot}': '${field}' must be string or null`,
      );
    }
  }

  return {
    schema: manifest.schema,
    delamain_name: manifest.delamain_name,
    module_id: manifest.module_id,
    module_version: manifest.module_version,
    module_mount_path: manifest.module_mount_path,
    entity_name: manifest.entity_name,
    entity_path: manifest.entity_path,
    status_field: manifest.status_field,
    discriminator_field: manifest.discriminator_field ?? null,
    discriminator_value: manifest.discriminator_value ?? null,
  };
}

export async function resolve(
  bundleRoot: string,
  systemRoot: string,
): Promise<ResolvedConfig> {
  const manifest = await loadRuntimeManifest(bundleRoot);
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
    discriminatorField: manifest.discriminator_field ?? undefined,
    discriminatorValue: manifest.discriminator_value ?? undefined,
    agents,
    allStates: Object.keys(delamain.states),
    dispatchTable,
  };
}

const sdkEnv: Record<string, string | undefined> = { ...process.env };
delete sdkEnv["ANTHROPIC_API_KEY"];

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
  systemRoot: string,
): Promise<{ success: boolean; sessionId?: string }> {
  const agent = agents[entry.agentName]!;

  let storedSessionId: string | null = null;
  if (entry.sessionField) {
    try {
      storedSessionId = await readFrontmatterField(itemFile, entry.sessionField);
    } catch (error) {
      console.error(
        `[dispatcher] ${itemId} failed reading session metadata from ${entry.sessionField}:`,
        error instanceof Error ? error.message : error,
      );
      return { success: false };
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
    `item_file: ${itemFile}`,
    `current_state: ${entry.state}`,
    `date: ${today()}`,
    `resume: ${sessionState.resume}`,
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
      + (entry.subAgentName ? ` (+ sub-agent: ${entry.subAgentName})` : ""),
  );

  let sessionId: string | undefined;

  try {
    for await (const message of query({
      prompt,
      options: {
        cwd: systemRoot,
        model: agent.model ?? "sonnet",
        allowedTools: tools,
        ...(subAgents ? { agents: subAgents } : {}),
        ...(sessionState.resumeSessionId ? { resume: sessionState.resumeSessionId } : {}),
        env: sdkEnv,
        permissionMode: "acceptEdits",
        maxTurns: 50,
        maxBudgetUsd: 10.0,
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
        const cost =
          message.subtype === "success"
            ? `$${message.total_cost_usd.toFixed(4)}`
            : message.subtype;
        const secs = Math.round(message.duration_ms / 1000);
        console.log(`[dispatcher] ${itemId} done (${cost}, ${secs}s, ${message.num_turns} turns)`);
      }
    }

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
      const persisted = await setFrontmatterField(itemFile, entry.sessionField!, sessionId!);
      if (persisted) {
        console.log(
          `[dispatcher] ${itemId} session persisted → ${entry.sessionField}`,
        );
      }
    }

    return { success: true, sessionId };
  } catch (error) {
    console.error(
      `[dispatcher] ${itemId} failed:`,
      error instanceof Error ? error.message : error,
    );
    return { success: false };
  }
}
