import { afterEach, expect, test } from "bun:test";
import {
  getAgentProvider,
  resetProviderSdkLoadersForTests,
  setCodexSdkLoaderForTests,
} from "../../../delamain-dispatcher/src/agent-providers.ts";

afterEach(() => {
  resetProviderSdkLoadersForTests();
});

test("openai provider injects approvals_reviewer config for the auto_review path only", async () => {
  const constructorOptions: Array<Record<string, unknown>> = [];
  let observedThreadOptions: Record<string, unknown> | undefined;

  setCodexSdkLoaderForTests(async () => ({
    Codex: class {
      constructor(options: Record<string, unknown>) {
        constructorOptions.push(options);
      }

      startThread(options: Record<string, unknown>) {
        observedThreadOptions = options;
        return {
          async runStreamed() {
            return {
              events: (async function* () {
                yield { type: "thread.started", thread_id: "fresh-thread-123" };
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
    itemId: "ALS-042",
    prompt: "Implement the approvals reviewer wiring",
    cwd: process.cwd(),
    agent: {
      description: "developer",
      prompt: "Implement the approvals reviewer wiring",
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
    },
    maxTurns: 4,
    maxBudgetUsd: 5,
    env: {},
    onToolUse() {},
    onDebugLog() {},
  });

  expect(result.sessionId).toBe("fresh-thread-123");
  expect(constructorOptions).toHaveLength(1);
  expect(constructorOptions[0]).toMatchObject({
    config: {
      approvals_reviewer: "auto_review",
    },
  });
  expect(observedThreadOptions?.approvalPolicy).toBe("on-request");
});

test("openai provider omits approvals_reviewer config for disabled and absent paths", async () => {
  const constructorOptions: Array<Record<string, unknown>> = [];

  setCodexSdkLoaderForTests(async () => ({
    Codex: class {
      constructor(options: Record<string, unknown>) {
        constructorOptions.push(options);
      }

      startThread() {
        const threadId = `fresh-thread-${constructorOptions.length}`;
        return {
          async runStreamed() {
            return {
              events: (async function* () {
                yield { type: "thread.started", thread_id: threadId };
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

  await getAgentProvider("openai").dispatch({
    itemId: "ALS-042-off",
    prompt: "Disabled reviewer path",
    cwd: process.cwd(),
    agent: {
      description: "developer",
      prompt: "Disabled reviewer path",
      approvalPolicy: "never",
      approvalsReviewer: "off",
    },
    maxTurns: 4,
    maxBudgetUsd: 5,
    env: {},
    onToolUse() {},
    onDebugLog() {},
  });

  await getAgentProvider("openai").dispatch({
    itemId: "ALS-042-absent",
    prompt: "Absent reviewer path",
    cwd: process.cwd(),
    agent: {
      description: "developer",
      prompt: "Absent reviewer path",
      approvalPolicy: "never",
    },
    maxTurns: 4,
    maxBudgetUsd: 5,
    env: {},
    onToolUse() {},
    onDebugLog() {},
  });

  expect(constructorOptions).toHaveLength(2);
  expect(constructorOptions[0]).not.toHaveProperty("config");
  expect(constructorOptions[1]).not.toHaveProperty("config");
});
