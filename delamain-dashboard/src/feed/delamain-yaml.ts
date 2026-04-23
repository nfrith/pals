import type {
  DispatcherDefinition,
  DispatcherDefinitionState,
  DispatcherTransition,
  DispatcherTransitionClass,
} from "./types.ts";

export function parseDelamainYaml(raw: string): DispatcherDefinition {
  const phases: string[] = [];
  const states: Record<string, DispatcherDefinitionState> = {};
  const transitions: DispatcherTransition[] = [];

  let section: "idle" | "phases" | "states" | "transitions" = "idle";
  let currentState: string | null = null;
  let currentTransition: Partial<DispatcherTransition> | null = null;
  let readingTransitionSources = false;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (!line.startsWith(" ")) {
      finalizeTransition(currentTransition, transitions);
      currentState = null;
      currentTransition = null;
      readingTransitionSources = false;
      if (trimmed === "phases:") {
        section = "phases";
      } else if (trimmed === "states:") {
        section = "states";
      } else if (trimmed === "transitions:") {
        section = "transitions";
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

    if (section === "states") {
      const stateMatch = line.match(/^  ([^:\s][^:]*)\s*:\s*$/);
      if (stateMatch) {
        currentState = stateMatch[1]!.trim();
        states[currentState] = {
          actor: null,
          phase: null,
          initial: false,
          terminal: false,
          provider: null,
          resumable: null,
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
      } else if (key === "provider" && (value === "anthropic" || value === "openai")) {
        state.provider = value;
      } else if (key === "resumable") {
        state.resumable = value === "true";
      }
      continue;
    }

    if (section !== "transitions") continue;

    const transitionMatch = line.match(/^  -\s*(.*)$/);
    if (transitionMatch) {
      finalizeTransition(currentTransition, transitions);
      currentTransition = {};
      readingTransitionSources = false;
      const inlineField = transitionMatch[1]!.trim();
      if (inlineField) {
        assignTransitionField(currentTransition, inlineField);
      }
      continue;
    }

    if (!currentTransition) continue;

    const transitionFieldMatch = line.match(/^    ([a-z-]+):\s*(.*)$/);
    if (transitionFieldMatch) {
      const key = transitionFieldMatch[1]!;
      const value = transitionFieldMatch[2] ?? "";
      readingTransitionSources = key === "from" && value.trim() === "";
      if (readingTransitionSources) {
        currentTransition.from = [];
      } else {
        assignTransitionField(currentTransition, `${key}: ${value}`);
      }
      continue;
    }

    if (!readingTransitionSources || !Array.isArray(currentTransition.from)) continue;

    const sourceMatch = line.match(/^      - (.+)$/);
    if (sourceMatch) {
      currentTransition.from.push(unquote(sourceMatch[1]!));
    }
  }

  finalizeTransition(currentTransition, transitions);

  return { phases, states, transitions };
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

function assignTransitionField(
  transition: Partial<DispatcherTransition>,
  rawField: string,
): void {
  const fieldMatch = rawField.match(/^([a-z-]+):\s*(.*)$/);
  if (!fieldMatch) return;

  const key = fieldMatch[1]!;
  const value = unquote(fieldMatch[2] ?? "");

  if (
    key === "class"
    && (value === "advance" || value === "rework" || value === "exit")
  ) {
    transition.class = value as DispatcherTransitionClass;
  } else if (key === "from") {
    transition.from = value;
  } else if (key === "to") {
    transition.to = value;
  }
}

function finalizeTransition(
  transition: Partial<DispatcherTransition> | null,
  transitions: DispatcherTransition[],
): void {
  if (!transition?.class || !transition.from || !transition.to) {
    return;
  }

  const from = Array.isArray(transition.from)
    ? transition.from.filter((value): value is string => value.length > 0)
    : transition.from;

  if (Array.isArray(from) && from.length === 0) {
    return;
  }

  transitions.push({
    class: transition.class,
    from,
    to: transition.to,
  });
}
