import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { parse as parseYaml } from "yaml";
import { query } from "@anthropic-ai/claude-agent-sdk";

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

interface SystemConfig {
  als_version: number;
  system_id: string;
  modules: Record<string, { path: string; version: number }>;
}

interface ShapeConfig {
  delamains: Record<string, { path: string }>;
  entities: Record<
    string,
    {
      path: string;
      fields: Record<string, { type: string; delamain?: string }>;
    }
  >;
}

interface Transition {
  id: string;
  class: string;
  from: string | string[];
  to: string;
  actor: string;
}

interface StateDef {
  phase: string;
  initial?: boolean;
  terminal?: boolean;
  actor?: string;
  agent?: string;
}

interface DelamainConfig {
  phases: string[];
  states: Record<string, StateDef>;
  agents?: Record<string, { path: string }>;
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
  transitions: Array<Pick<Transition, "id" | "class" | "to">>;
}

export interface ResolvedConfig {
  systemRoot: string;
  itemsDir: string;
  statusField: string;
  delamainName: string;
  agents: Record<string, AgentDef>;
  dispatchTable: DispatchEntry[];
}

// -------------------------------------------------------------------
// ALS crawl — derive everything from system.yaml
//
// Constraint: one delamain_state field per entity.
// When ALS supports variants, it will be one delamain per variant.
// The dispatcher finds THE entity with a delamain_state field and
// uses its delamain binding as the single dispatch target.
// -------------------------------------------------------------------

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

export async function resolve(systemRoot: string): Promise<ResolvedConfig> {
  // 1. system.yaml → module
  const system = parseYaml(
    await readFile(join(systemRoot, ".als", "system.yaml"), "utf-8"),
  ) as SystemConfig;

  const [moduleId, mod] = Object.entries(system.modules)[0]!;
  const moduleDir = join(
    systemRoot,
    ".als",
    "modules",
    moduleId,
    `v${mod.version}`,
  );

  // 2. shape.yaml → entity with delamain_state + delamain registry
  const shape = parseYaml(
    await readFile(join(moduleDir, "shape.yaml"), "utf-8"),
  ) as ShapeConfig;

  let statusField: string | undefined;
  let delamainName: string | undefined;
  let entityPath: string | undefined;

  for (const [, entity] of Object.entries(shape.entities)) {
    for (const [fieldId, field] of Object.entries(entity.fields)) {
      if (field.type === "delamain_state" && field.delamain) {
        statusField = fieldId;
        delamainName = field.delamain;
        entityPath = entity.path;
        break;
      }
    }
    if (delamainName) break;
  }

  if (!delamainName || !entityPath || !statusField) {
    throw new Error("No delamain_state field found in any entity");
  }

  // Items dir: module workspace path + entity path dirname
  // system.yaml path (workspace/factory) + entity path dirname (items/)
  const itemsDir = join(systemRoot, mod.path, dirname(entityPath));

  // 3. delivery.yaml → states, transitions, and agents registry
  const delamainPath = shape.delamains[delamainName]?.path;
  if (!delamainPath) {
    throw new Error(`Delamain "${delamainName}" not in shape registry`);
  }

  const delamain = parseYaml(
    await readFile(join(moduleDir, delamainPath), "utf-8"),
  ) as DelamainConfig;

  // 4. Load agent files from the agents registry
  const agents: Record<string, AgentDef> = {};
  for (const [agentKey, agentRef] of Object.entries(delamain.agents ?? {})) {
    try {
      const { meta, body } = parseMd(
        await readFile(join(moduleDir, agentRef.path), "utf-8"),
      );
      if (!body) continue;

      const def: AgentDef = {
        description: meta["description"] ?? "",
        prompt: body,
      };
      if (meta["tools"])
        def.tools = meta["tools"].split(",").map((t) => t.trim());
      if (
        meta["model"] &&
        ["sonnet", "opus", "haiku"].includes(meta["model"])
      ) {
        def.model = meta["model"] as AgentDef["model"];
      }

      // Use the agent registry key as the SDK agent name
      agents[agentKey] = def;
    } catch {
      // Skip unreadable agent files
    }
  }

  // 5. Build dispatch table from agent-owned states
  const dispatchTable: DispatchEntry[] = [];
  for (const [stateId, state] of Object.entries(delamain.states)) {
    if (state.actor !== "agent") continue;
    if (!state.agent) continue;
    if (!agents[state.agent]) continue;

    const transitions = delamain.transitions
      .filter((t) => {
        const sources = Array.isArray(t.from) ? t.from : [t.from];
        return sources.includes(stateId);
      })
      .map((t) => ({ id: t.id, class: t.class, to: t.to }));

    dispatchTable.push({
      state: stateId,
      agentName: state.agent,
      transitions,
    });
  }

  return {
    systemRoot,
    itemsDir,
    statusField,
    delamainName,
    agents,
    dispatchTable,
  };
}

// -------------------------------------------------------------------
// Dispatch — one sentence naming the agent, context as structured kv
// -------------------------------------------------------------------

const today = () => new Date().toISOString().slice(0, 10);

export async function dispatch(
  itemId: string,
  itemFile: string,
  entry: DispatchEntry,
  agents: Record<string, AgentDef>,
  systemRoot: string,
): Promise<{ success: boolean; sessionId?: string }> {
  const transitionLines = entry.transitions.map(
    (t) => `- ${t.id}: ${t.class} -> ${t.to}`,
  );
  const prompt = [
    `Use the ${entry.agentName} agent to handle ${itemId}.`,
    ``,
    `item_id: ${itemId}`,
    `item_file: ${itemFile}`,
    `current_state: ${entry.state}`,
    `date: ${today()}`,
    ``,
    `legal_transitions:`,
    ...transitionLines,
  ].join("\n");

  console.log(`[dispatcher] ${itemId} @ ${entry.state} → ${entry.agentName}`);

  let sessionId: string | undefined;

  try {
    for await (const message of query({
      prompt,
      options: {
        cwd: systemRoot,
        agents: { [entry.agentName]: agents[entry.agentName]! },
        allowedTools: ["Agent"],
        model: "haiku",
        permissionMode: "acceptEdits",
        maxTurns: 5,
        maxBudgetUsd: 0.25,
      },
    })) {
      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
      }
      if (message.type === "result") {
        const tag =
          message.subtype === "success"
            ? `$${message.total_cost_usd.toFixed(4)}`
            : message.subtype;
        console.log(`[dispatcher] ${itemId} done (${tag})`);
      }
    }
    return { success: true, sessionId };
  } catch (err) {
    console.error(
      `[dispatcher] ${itemId} failed:`,
      err instanceof Error ? err.message : err,
    );
    return { success: false };
  }
}
