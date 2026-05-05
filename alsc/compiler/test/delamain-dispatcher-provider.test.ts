import { afterEach, expect, test } from "bun:test";
import {
  estimateOpenAITurnCostUsd,
  getAgentProvider,
  resetProviderSdkLoadersForTests,
  setCodexSdkLoaderForTests,
} from "../../../delamain-dispatcher/src/agent-providers.ts";

afterEach(() => {
  resetProviderSdkLoadersForTests();
});

test("OpenAI dispatcher cost accounting uses standard GPT-5.4 pricing", () => {
  const cost = estimateOpenAITurnCostUsd("gpt-5.4", {
    inputTokens: 1_000,
    cachedInputTokens: 500,
    outputTokens: 2_000,
  });

  expect(cost).not.toBeNull();
  expect(cost!).toBeCloseTo(0.032625, 8);
});

test("OpenAI dispatcher cost accounting uses standard GPT-5.5 pricing", () => {
  const cost = estimateOpenAITurnCostUsd("gpt-5.5", {
    inputTokens: 1_000,
    cachedInputTokens: 500,
    outputTokens: 2_000,
  });

  expect(cost).not.toBeNull();
  expect(cost!).toBeCloseTo(0.06525, 8);
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

test("OpenAI dispatcher cost accounting switches to GPT-5.5 long-context pricing", () => {
  const cost = estimateOpenAITurnCostUsd("gpt-5.5", {
    inputTokens: 300_000,
    cachedInputTokens: 0,
    outputTokens: 1_000,
  });

  expect(cost).not.toBeNull();
  expect(cost!).toBeCloseTo(3.045, 8);
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

test("OpenAI dispatcher cost accounting supports GPT-5.5 snapshot model ids", () => {
  const cost = estimateOpenAITurnCostUsd("gpt-5.5-2026-05-02", {
    inputTokens: 10_000,
    cachedInputTokens: 0,
    outputTokens: 1_000,
  });

  expect(cost).not.toBeNull();
  expect(cost!).toBeCloseTo(0.08, 8);
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

test("OpenAI provider streams codex action lines once per started or completed action", async () => {
  const toolUses = await dispatchOpenAIEvents([
    {
      type: "item.started",
      item: {
        type: "command_execution",
        command: "bun test dispatcher-provider",
        status: "in_progress",
      },
    },
    {
      type: "item.updated",
      item: {
        type: "command_execution",
        command: "bun test dispatcher-provider",
        aggregated_output: "still running",
        status: "in_progress",
      },
    },
    {
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "bun test dispatcher-provider",
        exit_code: 0,
        status: "completed",
      },
    },
    {
      type: "item.started",
      item: {
        type: "web_search",
        query: "codex sdk thread item taxonomy",
      },
    },
    {
      type: "item.updated",
      item: {
        type: "web_search",
        query: "codex sdk thread item taxonomy",
      },
    },
    {
      type: "item.started",
      item: {
        type: "mcp_tool_call",
        server: "docs",
        tool: "search",
        status: "in_progress",
      },
    },
    {
      type: "item.completed",
      item: {
        type: "file_change",
        changes: [
          { path: "delamain-dispatcher/src/agent-providers.ts", kind: "update" },
          { path: "alsc/compiler/test/delamain-dispatcher-provider.test.ts", kind: "add" },
          { path: "tmp/stale-tail.log", kind: "delete" },
        ],
        status: "completed",
      },
    },
    {
      type: "item.updated",
      item: {
        type: "todo_list",
        items: [{ text: "ignored", completed: false }],
      },
    },
    {
      type: "item.completed",
      item: {
        type: "agent_message",
        text: "ignored",
      },
    },
  ]);

  expect(toolUses).toEqual([
    "Bash bun test dispatcher-provider",
    "WebSearch codex sdk thread item taxonomy",
    "MCP docs.search",
    "Edit delamain-dispatcher/src/agent-providers.ts",
    "Write alsc/compiler/test/delamain-dispatcher-provider.test.ts",
    "Delete tmp/stale-tail.log",
  ]);
});

test("OpenAI provider surfaces item-level codex errors on completion only", async () => {
  const toolUses = await dispatchOpenAIEvents([
    {
      type: "item.started",
      item: {
        type: "error",
        message: "not yet final",
      },
    },
    {
      type: "item.completed",
      item: {
        type: "error",
        message: "codex apply_patch rejected malformed hunk",
      },
    },
  ]);

  expect(toolUses).toEqual([
    "Error: codex apply_patch rejected malformed hunk",
  ]);
});

async function dispatchOpenAIEvents(events: unknown[]): Promise<string[]> {
  const toolUses: string[] = [];

  setCodexSdkLoaderForTests(async () => ({
    Codex: class {
      startThread() {
        return {
          async runStreamed() {
            return {
              events: (async function* () {
                yield { type: "thread.started", thread_id: "codex-thread-123" };
                for (const event of events) {
                  yield event;
                }
                yield {
                  type: "turn.completed",
                  usage: {
                    input_tokens: 0,
                    cached_input_tokens: 0,
                    output_tokens: 0,
                  },
                };
              })(),
            };
          },
        };
      }

      resumeThread() {
        throw new Error("unexpected resume");
      }
    },
  }));

  const result = await getAgentProvider("openai").dispatch({
    itemId: "ALS-029",
    prompt: "Restore codex dispatcher observability",
    cwd: process.cwd(),
    agent: {
      description: "developer",
      prompt: "Restore codex dispatcher observability",
      model: "gpt-5.4",
    },
    maxTurns: 4,
    maxBudgetUsd: 5,
    env: {},
    onToolUse(detail) {
      toolUses.push(detail);
    },
    onDebugLog() {},
  });

  expect(result.sessionId).toBe("codex-thread-123");
  expect(result.subtype).toBe("success");
  expect(result.numTurns).toBe(1);

  return toolUses;
}
