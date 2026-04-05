import { expect, test } from "bun:test";
import { delamainShapeSchema, validateDelamainDefinition, type DelamainShape } from "../src/delamain.ts";

function makeValidDelamain(): DelamainShape {
  return {
    phases: ["intake", "planning", "closed"],
    states: {
      draft: {
        initial: true,
        phase: "intake",
        actor: "operator",
      },
      planning: {
        phase: "planning",
        actor: "agent",
        resumable: true,
        "session-field": "planner_session",
        path: "agents/planning.md",
      },
      completed: {
        phase: "closed",
        terminal: true,
      },
    },
    transitions: [
      {
        class: "advance",
        from: "draft",
        to: "planning",
      },
      {
        class: "exit",
        from: "planning",
        to: "completed",
      },
    ],
  };
}

test("delamain shape schema accepts a valid agent-owned state shape", () => {
  const result = delamainShapeSchema.safeParse(makeValidDelamain());
  expect(result.success).toBe(true);
});

test("delamain shape schema rejects operator-owned states with agent-only fields", () => {
  const result = delamainShapeSchema.safeParse({
    phases: ["intake", "closed"],
    states: {
      draft: {
        initial: true,
        phase: "intake",
        actor: "operator",
        path: "agents/draft.md",
      },
      completed: {
        phase: "closed",
        terminal: true,
      },
    },
    transitions: [
      {
        class: "exit",
        from: "draft",
        to: "completed",
      },
    ],
  });

  expect(result.success).toBe(false);
});

test("graph validation requires at least one terminal state", () => {
  const delamain = makeValidDelamain();
  delete delamain.states.completed.terminal;
  delamain.states.completed.actor = "operator";

  const issues = validateDelamainDefinition(delamain);
  expect(issues.some((issue) => issue.message.includes("at least one terminal state"))).toBe(true);
});

test("graph validation rejects unreachable states", () => {
  const delamain = makeValidDelamain();
  delamain.states.review = {
    phase: "planning",
    actor: "operator",
  };
  delamain.transitions.push({
    class: "exit",
    from: "review",
    to: "completed",
  });

  const issues = validateDelamainDefinition(delamain);
  expect(issues.some((issue) => issue.message.includes("review is unreachable"))).toBe(true);
});

test("graph validation rejects duplicate effective edges after exit list expansion", () => {
  const delamain = makeValidDelamain();
  delamain.transitions.push({
    class: "exit",
    from: ["planning"],
    to: "completed",
  });

  const issues = validateDelamainDefinition(delamain);
  expect(issues.some((issue) => issue.message.includes("duplicate effective transition planning->completed"))).toBe(true);
});

test("graph validation rejects self-loop transitions", () => {
  const delamain = makeValidDelamain();
  delamain.transitions.push({
    class: "rework",
    from: "planning",
    to: "planning",
  });

  const issues = validateDelamainDefinition(delamain);
  expect(issues.some((issue) => issue.message.includes("self-loop"))).toBe(true);
});
