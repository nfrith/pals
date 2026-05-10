import { expect, test } from "bun:test";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { parseDelamainYaml } from "./delamain-yaml.ts";

const workspaceRoot = resolve(import.meta.dir, "../../../../../");

test.each([
  {
    name: "als-factory-jobs",
    transitions: 40,
    classCounts: { advance: 27, rework: 10, exit: 3 },
  },
  {
    name: "ghost-factory-jobs",
    transitions: 21,
    classCounts: { advance: 13, rework: 5, exit: 3 },
  },
  {
    name: "funnel-factory-jobs",
    transitions: 21,
    classCounts: { advance: 12, rework: 6, exit: 3 },
  },
])("parseDelamainYaml reads transitions and state metadata for $name", async ({
  classCounts,
  name,
  transitions,
}) => {
  const raw = await readFile(resolve(workspaceRoot, ".claude", "delamains", name, "delamain.yaml"), "utf-8");
  const parsed = parseDelamainYaml(raw);
  const counts = parsed.transitions.reduce<Record<string, number>>((accumulator, transition) => {
    accumulator[transition.class] = (accumulator[transition.class] ?? 0) + 1;
    return accumulator;
  }, {});

  expect(parsed.transitions).toHaveLength(transitions);
  expect(counts).toEqual(classCounts);
  expect(parsed.transitions.some((transition) => Array.isArray(transition.from))).toBe(true);

  const agentState = Object.values(parsed.states).find((state) => state.actor === "agent");
  expect(agentState?.provider).toBeDefined();
  expect(agentState?.resumable).toBeDefined();
});

test("parseDelamainYaml reads v4 label outcome and customer bucket fields", () => {
  const parsed = parseDelamainYaml([
    "phases:",
    "  - implementation",
    "  - closed",
    "states:",
    "  in-dev:",
    "    phase: implementation",
    "    actor: agent",
    "    label: AI is implementing",
    "    customer_bucket: active",
    "    provider: openai",
    "  completed:",
    "    phase: closed",
    "    terminal: true",
    "    label: Work shipped",
    "    outcome: success",
    "    customer_bucket: closed_success",
    "transitions:",
    "  - class: advance",
    "    from: in-dev",
    "    to: completed",
  ].join("\n"));

  expect(parsed.states["in-dev"]).toMatchObject({
    label: "AI is implementing",
    customerBucket: "active",
  });
  expect(parsed.states["completed"]).toMatchObject({
    label: "Work shipped",
    outcome: "success",
    customerBucket: "closed_success",
  });
});
