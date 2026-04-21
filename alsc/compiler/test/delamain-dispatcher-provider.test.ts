import { expect, test } from "bun:test";
import { estimateOpenAITurnCostUsd } from "../../../skills/new/references/dispatcher/src/agent-providers.ts";

test("OpenAI dispatcher cost accounting uses standard GPT-5.4 pricing", () => {
  const cost = estimateOpenAITurnCostUsd("gpt-5.4", {
    inputTokens: 1_000,
    cachedInputTokens: 500,
    outputTokens: 2_000,
  });

  expect(cost).not.toBeNull();
  expect(cost!).toBeCloseTo(0.032625, 8);
});

test("OpenAI dispatcher cost accounting switches to GPT-5.4 long-context pricing", () => {
  const cost = estimateOpenAITurnCostUsd("gpt-5.4", {
    inputTokens: 300_000,
    cachedInputTokens: 0,
    outputTokens: 1_000,
  });

  expect(cost).not.toBeNull();
  expect(cost!).toBeCloseTo(1.5225, 8);
});

test("OpenAI dispatcher cost accounting supports GPT-5.4 snapshot model ids", () => {
  const cost = estimateOpenAITurnCostUsd("gpt-5.4-2026-03-05", {
    inputTokens: 10_000,
    cachedInputTokens: 0,
    outputTokens: 1_000,
  });

  expect(cost).not.toBeNull();
  expect(cost!).toBeCloseTo(0.04, 8);
});

test("OpenAI dispatcher cost accounting returns null for unknown model ids", () => {
  expect(
    estimateOpenAITurnCostUsd("gpt-future-1", {
      inputTokens: 10_000,
      cachedInputTokens: 0,
      outputTokens: 1_000,
    }),
  ).toBeNull();
});
