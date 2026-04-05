import { z } from "zod";
import { fieldNameSchema, kebabNameSchema as delamainNameSchema, nonEmptyStringSchema as nonEmptyString } from "./naming.ts";

const phasesSchema = z.array(delamainNameSchema).min(1).superRefine((value, ctx) => {
  const seen = new Set<string>();
  for (const [index, phaseName] of value.entries()) {
    if (seen.has(phaseName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate phase ${phaseName}`,
        path: [index],
      });
    }
    seen.add(phaseName);
  }
});

const transitionFromSchema = z.union([
  delamainNameSchema,
  z.array(delamainNameSchema).min(1).superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const [index, stateName] of value.entries()) {
      if (seen.has(stateName)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate state ${stateName} in from list`,
          path: [index],
        });
      }
      seen.add(stateName);
    }
  }),
]);

const delamainStateSchema = z.object({
  initial: z.boolean().optional(),
  terminal: z.boolean().optional(),
  phase: delamainNameSchema,
  actor: z.enum(["operator", "agent"]).optional(),
  path: nonEmptyString.optional(),
  resumable: z.boolean().optional(),
  "session-field": fieldNameSchema.optional(),
  "sub-agent": nonEmptyString.optional(),
}).strict().superRefine((value, ctx) => {
  const isTerminal = value.terminal === true;

  if (value.initial === true && isTerminal) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "state cannot be both initial and terminal",
      path: ["initial"],
    });
  }

  if (isTerminal) {
    for (const fieldName of ["actor", "path", "resumable", "session-field", "sub-agent"] as const) {
      if (value[fieldName] !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `terminal states must not declare ${fieldName}`,
          path: [fieldName],
        });
      }
    }
    return;
  }

  if (!value.actor) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "non-terminal states must declare actor",
      path: ["actor"],
    });
    return;
  }

  if (value.actor === "operator") {
    for (const fieldName of ["path", "resumable", "session-field", "sub-agent"] as const) {
      if (value[fieldName] !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `operator-owned states must not declare ${fieldName}`,
          path: [fieldName],
        });
      }
    }
    return;
  }

  if (!value.path) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "agent-owned states must declare path",
      path: ["path"],
    });
  }

  if (value.resumable === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "agent-owned states must declare resumable",
      path: ["resumable"],
    });
  } else if (value.resumable === true && !value["session-field"]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "resumable agent-owned states must declare session-field",
      path: ["session-field"],
    });
  } else if (value.resumable === false && value["session-field"] !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "non-resumable agent-owned states must not declare session-field",
      path: ["session-field"],
    });
  }
});

const delamainTransitionSchema = z.object({
  class: z.enum(["advance", "rework", "exit"]),
  from: transitionFromSchema,
  to: delamainNameSchema,
}).strict();

export const delamainShapeSchema = z.object({
  phases: phasesSchema,
  states: z.record(delamainNameSchema, delamainStateSchema),
  transitions: z.array(delamainTransitionSchema),
}).strict().superRefine((value, ctx) => {
  if (Object.keys(value.states).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Delamain must declare at least one state",
      path: ["states"],
    });
  }
});

export type DelamainShape = z.infer<typeof delamainShapeSchema>;
export type DelamainStateShape = z.infer<typeof delamainStateSchema>;
export type DelamainTransitionShape = z.infer<typeof delamainTransitionSchema>;
export type DelamainStateActor = NonNullable<DelamainStateShape["actor"]>;

export interface DelamainValidationIssue {
  path: Array<string | number>;
  message: string;
}

interface EffectiveEdge {
  from: string;
  to: string;
}

export function expandTransitionSources(transition: DelamainTransitionShape): string[] {
  return Array.isArray(transition.from) ? transition.from : [transition.from];
}

export function collectDelamainSessionFields(delamain: DelamainShape): string[] {
  const sessionFields: string[] = [];

  for (const state of Object.values(delamain.states)) {
    if (state["session-field"]) {
      sessionFields.push(state["session-field"]);
    }
  }

  return sessionFields;
}

export function validateDelamainDefinition(delamain: DelamainShape): DelamainValidationIssue[] {
  const issues: DelamainValidationIssue[] = [];
  const stateEntries = Object.entries(delamain.states);
  const stateNames = new Set(stateEntries.map(([stateName]) => stateName));
  const phaseIndex = new Map(delamain.phases.map((phaseName, index) => [phaseName, index]));
  const initialStates = stateEntries.filter(([, state]) => state.initial === true).map(([stateName]) => stateName);
  const lastPhaseName = delamain.phases[delamain.phases.length - 1] ?? null;

  if (initialStates.length !== 1) {
    issues.push({
      path: ["states"],
      message: "Delamain must declare exactly one initial state",
    });
  }

  const phaseOccupancy = new Map(delamain.phases.map((phaseName) => [phaseName, 0]));
  for (const [stateName, state] of stateEntries) {
    if (!phaseIndex.has(state.phase)) {
      issues.push({
        path: ["states", stateName, "phase"],
        message: `state ${stateName} references unknown phase ${state.phase}`,
      });
      continue;
    }

    phaseOccupancy.set(state.phase, (phaseOccupancy.get(state.phase) ?? 0) + 1);

    if (state.terminal === true && lastPhaseName && state.phase !== lastPhaseName) {
      issues.push({
        path: ["states", stateName, "phase"],
        message: `terminal state ${stateName} must be in the last phase ${lastPhaseName}`,
      });
    }
  }

  for (const [phaseName, count] of phaseOccupancy.entries()) {
    if (count === 0) {
      issues.push({
        path: ["phases"],
        message: `phase ${phaseName} must contain at least one state`,
      });
    }
  }

  if (initialStates.length === 1) {
    const initialStateName = initialStates[0];
    const initialState = delamain.states[initialStateName];
    const firstPhaseName = delamain.phases[0];
    if (initialState.phase !== firstPhaseName) {
      issues.push({
        path: ["states", initialStateName, "phase"],
        message: `initial state ${initialStateName} must be in the first phase ${firstPhaseName}`,
      });
    }
  }

  const sessionFieldOwners = new Map<string, string>();
  for (const [stateName, state] of stateEntries) {
    const sessionFieldName = state["session-field"];
    if (!sessionFieldName) continue;
    const existingOwner = sessionFieldOwners.get(sessionFieldName);
    if (existingOwner) {
      issues.push({
        path: ["states", stateName, "session-field"],
        message: `session-field ${sessionFieldName} duplicates state ${existingOwner}`,
      });
      continue;
    }
    sessionFieldOwners.set(sessionFieldName, stateName);
  }

  const edges: EffectiveEdge[] = [];
  const effectiveEdgeKeys = new Set<string>();

  for (const [transitionIndex, transition] of delamain.transitions.entries()) {
    const sources = expandTransitionSources(transition);

    if ((transition.class === "advance" || transition.class === "rework") && Array.isArray(transition.from)) {
      issues.push({
        path: ["transitions", transitionIndex, "from"],
        message: `${transition.class} transitions must declare exactly one source state`,
      });
    }

    if (!stateNames.has(transition.to)) {
      issues.push({
        path: ["transitions", transitionIndex, "to"],
        message: `transition target ${transition.to} is not a declared state`,
      });
    }

    for (const [sourceIndex, fromStateName] of sources.entries()) {
      if (!stateNames.has(fromStateName)) {
        issues.push({
          path: Array.isArray(transition.from)
            ? ["transitions", transitionIndex, "from", sourceIndex]
            : ["transitions", transitionIndex, "from"],
          message: `transition source ${fromStateName} is not a declared state`,
        });
        continue;
      }

      if (fromStateName === transition.to) {
        issues.push({
          path: Array.isArray(transition.from)
            ? ["transitions", transitionIndex, "from", sourceIndex]
            : ["transitions", transitionIndex, "from"],
          message: "self-loop transitions are not allowed",
        });
      }

      const edgeKey = `${fromStateName}->${transition.to}`;
      if (effectiveEdgeKeys.has(edgeKey)) {
        issues.push({
          path: ["transitions", transitionIndex],
          message: `duplicate effective transition ${edgeKey}`,
        });
        continue;
      }

      effectiveEdgeKeys.add(edgeKey);
      edges.push({
        from: fromStateName,
        to: transition.to,
      });

      const fromState = delamain.states[fromStateName];
      const toState = delamain.states[transition.to];
      if (!fromState || !toState) continue;

      const fromPhaseIndex = phaseIndex.get(fromState.phase);
      const toPhaseIndex = phaseIndex.get(toState.phase);
      if (fromPhaseIndex === undefined || toPhaseIndex === undefined) continue;

      if (transition.class === "advance") {
        if (toState.terminal === true) {
          issues.push({
            path: ["transitions", transitionIndex, "to"],
            message: "advance transitions must target non-terminal states",
          });
        }
        if (toPhaseIndex < fromPhaseIndex || toPhaseIndex > fromPhaseIndex + 1) {
          issues.push({
            path: ["transitions", transitionIndex],
            message: "advance transitions must move to the same phase or the next phase",
          });
        }
      }

      if (transition.class === "rework") {
        if (toState.terminal === true) {
          issues.push({
            path: ["transitions", transitionIndex, "to"],
            message: "rework transitions must target non-terminal states",
          });
        }
        if (toPhaseIndex > fromPhaseIndex) {
          issues.push({
            path: ["transitions", transitionIndex],
            message: "rework transitions must move to the same phase or an earlier phase",
          });
        }
      }

      if (transition.class === "exit") {
        if (fromState.terminal === true) {
          issues.push({
            path: Array.isArray(transition.from)
              ? ["transitions", transitionIndex, "from", sourceIndex]
              : ["transitions", transitionIndex, "from"],
            message: "exit transitions must originate from non-terminal states",
          });
        }
        if (toState.terminal !== true) {
          issues.push({
            path: ["transitions", transitionIndex, "to"],
            message: "exit transitions must target terminal states",
          });
        }
      }
    }
  }

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();
  for (const stateName of stateNames) {
    outgoing.set(stateName, []);
    incoming.set(stateName, []);
    reverse.set(stateName, []);
  }

  for (const edge of edges) {
    outgoing.get(edge.from)?.push(edge.to);
    incoming.get(edge.to)?.push(edge.from);
    reverse.get(edge.to)?.push(edge.from);
  }

  for (const [stateName, state] of stateEntries) {
    const outgoingCount = outgoing.get(stateName)?.length ?? 0;
    if (state.terminal === true && outgoingCount > 0) {
      issues.push({
        path: ["states", stateName],
        message: `terminal state ${stateName} must not have outgoing transitions`,
      });
    }

    if (state.terminal !== true && outgoingCount === 0) {
      issues.push({
        path: ["states", stateName],
        message: `non-terminal state ${stateName} must declare at least one outgoing transition`,
      });
    }
  }

  if (initialStates.length === 1) {
    const reachable = new Set<string>();
    const queue = [initialStates[0]];
    reachable.add(initialStates[0]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of outgoing.get(current) ?? []) {
        if (reachable.has(next)) continue;
        reachable.add(next);
        queue.push(next);
      }
    }

    for (const stateName of stateNames) {
      if (!reachable.has(stateName)) {
        issues.push({
          path: ["states", stateName],
          message: `state ${stateName} is unreachable from the initial state`,
        });
      }
    }
  }

  const terminalStates = stateEntries.filter(([, state]) => state.terminal === true).map(([stateName]) => stateName);
  if (terminalStates.length === 0) {
    issues.push({
      path: ["states"],
      message: "Delamain must declare at least one terminal state",
    });
    return issues;
  }

  const statesWithTerminalPath = new Set<string>(terminalStates);
  const queue = [...terminalStates];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const previous of reverse.get(current) ?? []) {
      if (statesWithTerminalPath.has(previous)) continue;
      statesWithTerminalPath.add(previous);
      queue.push(previous);
    }
  }

  for (const [stateName, state] of stateEntries) {
    if (state.terminal === true) continue;
    if (!statesWithTerminalPath.has(stateName)) {
      issues.push({
        path: ["states", stateName],
        message: `non-terminal state ${stateName} must have a path to at least one terminal state`,
      });
    }
  }

  return issues;
}
