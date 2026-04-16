import type { DispatcherDefinition, DispatcherDefinitionState } from "./types.ts";

export function parseDelamainYaml(raw: string): DispatcherDefinition {
  const phases: string[] = [];
  const states: Record<string, DispatcherDefinitionState> = {};

  let section: "idle" | "phases" | "states" = "idle";
  let currentState: string | null = null;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (!line.startsWith(" ")) {
      currentState = null;
      if (trimmed === "phases:") {
        section = "phases";
      } else if (trimmed === "states:") {
        section = "states";
      } else {
        section = "idle";
      }
      continue;
    }

    if (section === "phases") {
      const match = line.match(/^  - (.+)$/);
      if (match) phases.push(unquote(match[1]!));
      continue;
    }

    if (section !== "states") continue;

    const stateMatch = line.match(/^  ([^:\s][^:]*)\s*:\s*$/);
    if (stateMatch) {
      currentState = stateMatch[1]!.trim();
      states[currentState] = {
        actor: null,
        phase: null,
        initial: false,
        terminal: false,
      };
      continue;
    }

    if (!currentState) continue;

    const fieldMatch = line.match(/^    ([a-z-]+):\s*(.*)$/);
    if (!fieldMatch) continue;

    const key = fieldMatch[1]!;
    const value = unquote(fieldMatch[2] ?? "");
    const state = states[currentState]!;

    if (key === "phase") {
      state.phase = value || null;
    } else if (key === "actor" && (value === "agent" || value === "operator")) {
      state.actor = value;
    } else if (key === "initial") {
      state.initial = value === "true";
    } else if (key === "terminal") {
      state.terminal = value === "true";
    }
  }

  return { phases, states };
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
