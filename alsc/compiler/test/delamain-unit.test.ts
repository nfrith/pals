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
        provider: "anthropic",
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

test("delamain shape schema accepts explicit provider declarations on agent-owned states", () => {
  const result = delamainShapeSchema.safeParse({
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
        provider: "openai",
        resumable: true,
        "session-field": "planner_session",
        path: "agents/planning.md",
      },
      review: {
        phase: "planning",
        actor: "agent",
        provider: "anthropic",
        resumable: false,
        path: "agents/review.md",
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
        class: "advance",
        from: "planning",
        to: "review",
      },
      {
        class: "exit",
        from: "review",
        to: "completed",
      },
    ],
  });

  expect(result.success).toBe(true);
});

test("delamain shape schema accepts top-level concurrency pools", () => {
  const result = delamainShapeSchema.safeParse({
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
        provider: "openai",
        resumable: true,
        "session-field": "planner_session",
        path: "agents/planning.md",
        concurrency: 1,
      },
      review: {
        phase: "planning",
        actor: "agent",
        provider: "anthropic",
        resumable: false,
        path: "agents/review.md",
      },
      completed: {
        phase: "closed",
        terminal: true,
      },
    },
    concurrency_pools: {
      shared: {
        states: ["planning", "review"],
        capacity: 1,
      },
    },
    transitions: [
      {
        class: "advance",
        from: "draft",
        to: "planning",
      },
      {
        class: "advance",
        from: "planning",
        to: "review",
      },
      {
        class: "exit",
        from: "review",
        to: "completed",
      },
    ],
  });

  expect(result.success).toBe(true);
});

test("delamain shape schema rejects duplicate states inside one concurrency pool", () => {
  const result = delamainShapeSchema.safeParse({
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
        provider: "openai",
        resumable: true,
        "session-field": "planner_session",
        path: "agents/planning.md",
      },
      completed: {
        phase: "closed",
        terminal: true,
      },
    },
    concurrency_pools: {
      shared: {
        states: ["planning", "planning"],
        capacity: 1,
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
  });

  expect(result.success).toBe(false);
});

test("delamain shape schema rejects provider on operator-owned states", () => {
  const result = delamainShapeSchema.safeParse({
    phases: ["intake", "closed"],
    states: {
      draft: {
        initial: true,
        phase: "intake",
        actor: "operator",
        provider: "anthropic",
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

test("delamain shape schema rejects provider on terminal states", () => {
  const result = delamainShapeSchema.safeParse({
    phases: ["intake", "closed"],
    states: {
      draft: {
        initial: true,
        phase: "intake",
        actor: "operator",
      },
      completed: {
        phase: "closed",
        terminal: true,
        provider: "anthropic",
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

test("delamain shape schema rejects missing provider on agent-owned states", () => {
  const result = delamainShapeSchema.safeParse({
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
        resumable: false,
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
  });

  expect(result.success).toBe(false);
});

test("delamain shape schema rejects sub-agent on openai states", () => {
  const result = delamainShapeSchema.safeParse({
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
        provider: "openai",
        resumable: false,
        path: "agents/planning.md",
        "sub-agent": "sub-agents/planner.md",
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

test("graph validation rejects concurrency pools with unknown member states", () => {
  const delamain = makeValidDelamain();
  delamain.states.review = {
    phase: "planning",
    actor: "agent",
    provider: "anthropic",
    resumable: false,
    path: "agents/review.md",
  };
  delamain.transitions.push({
    class: "advance",
    from: "planning",
    to: "review",
  });
  delamain.transitions.push({
    class: "exit",
    from: "review",
    to: "completed",
  });
  delamain.concurrency_pools = {
    shared: {
      states: ["planning", "missing"],
      capacity: 1,
    },
  };

  const issues = validateDelamainDefinition(delamain);
  expect(issues.some((issue) => issue.message.includes("references unknown state missing"))).toBe(true);
});

test("graph validation rejects concurrency pools with single distinct members", () => {
  const delamain = makeValidDelamain();
  delamain.concurrency_pools = {
    shared: {
      states: ["planning"],
      capacity: 1,
    },
  };

  const issues = validateDelamainDefinition(delamain);
  expect(issues.some((issue) => issue.message.includes("at least two distinct states"))).toBe(true);
});

test("graph validation rejects duplicate membership across concurrency pools", () => {
  const delamain = makeValidDelamain();
  delamain.states.review = {
    phase: "planning",
    actor: "agent",
    provider: "anthropic",
    resumable: false,
    path: "agents/review.md",
  };
  delamain.states.qa = {
    phase: "planning",
    actor: "agent",
    provider: "anthropic",
    resumable: false,
    path: "agents/qa.md",
  };
  delamain.transitions.push({
    class: "advance",
    from: "planning",
    to: "review",
  });
  delamain.transitions.push({
    class: "advance",
    from: "review",
    to: "qa",
  });
  delamain.transitions.push({
    class: "exit",
    from: "qa",
    to: "completed",
  });
  delamain.concurrency_pools = {
    alpha: {
      states: ["planning", "review"],
      capacity: 1,
    },
    beta: {
      states: ["review", "qa"],
      capacity: 1,
    },
  };

  const issues = validateDelamainDefinition(delamain);
  expect(issues.some((issue) => issue.message.includes("already belongs to concurrency pool alpha"))).toBe(true);
});

test("graph validation rejects operator-owned and terminal concurrency-pool members", () => {
  const delamain = makeValidDelamain();
  delamain.concurrency_pools = {
    invalid: {
      states: ["draft", "completed"],
      capacity: 1,
    },
  };

  const issues = validateDelamainDefinition(delamain);
  expect(issues.some((issue) => issue.message.includes("draft must be agent-owned"))).toBe(true);
  expect(issues.some((issue) => issue.message.includes("completed must be non-terminal"))).toBe(true);
});

test("graph validation allows pooled states to keep state-local concurrency", () => {
  const delamain = makeValidDelamain();
  delamain.states.planning.concurrency = 1;
  delamain.states.review = {
    phase: "planning",
    actor: "agent",
    provider: "anthropic",
    resumable: false,
    path: "agents/review.md",
    concurrency: 1,
  };
  delamain.transitions.push({
    class: "advance",
    from: "planning",
    to: "review",
  });
  delamain.transitions.push({
    class: "exit",
    from: "review",
    to: "completed",
  });
  delamain.concurrency_pools = {
    shared: {
      states: ["planning", "review"],
      capacity: 1,
    },
  };

  expect(validateDelamainDefinition(delamain)).toEqual([]);
});
