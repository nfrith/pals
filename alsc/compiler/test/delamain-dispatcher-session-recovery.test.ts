import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resetProviderSdkLoadersForTests,
  setAnthropicSdkLoaderForTests,
  setCodexSdkLoaderForTests,
  getAgentProvider,
} from "../../../skills/new/references/dispatcher/src/agent-providers.ts";
import { recoverFreshDispatchAfterMissingResumeSession } from "../../../skills/new/references/dispatcher/src/resume-recovery.ts";
import { buildSessionRuntimeState } from "../../../skills/new/references/dispatcher/src/session-runtime.ts";
import { setFrontmatterField } from "../../../skills/new/references/dispatcher/src/frontmatter.ts";

afterEach(() => {
  resetProviderSdkLoadersForTests();
});

test("resume recovery clears stale dispatcher session ids and rebuilds fresh state", async () => {
  const root = await mkdtemp(join(tmpdir(), "als-dispatcher-recovery-"));
  const itemFile = join(root, "ALS-030.md");
  await mkdir(root, { recursive: true });
  await writeFile(
    itemFile,
    [
      "---",
      "status: dev",
      "dev_session: stale-session-123",
      "---",
      "",
      "# ALS-030",
      "",
      "Body",
      "",
    ].join("\n"),
    "utf-8",
  );

  const logs: string[] = [];
  const recoveredState = await recoverFreshDispatchAfterMissingResumeSession({
    itemId: "ALS-030",
    isolatedItemFile: itemFile,
    entry: {
      provider: "anthropic",
      resumable: true,
      sessionField: "dev_session",
    },
    sessionState: buildSessionRuntimeState(
      {
        provider: "anthropic",
        resumable: true,
        sessionField: "dev_session",
      },
      "stale-session-123",
    ),
    resultSummary: {
      sessionId: "stale-session-123",
      subtype: "resume_session_missing",
      totalCostUsd: null,
      durationMs: 0,
      numTurns: 0,
      resumeRecovery: {
        reason: "session_missing",
        logMessage: "resume failed (session expired), spawning fresh",
      },
    },
    log(message: string) {
      logs.push(message);
    },
  });

  expect(recoveredState.resume).toBe("no");
  expect(recoveredState.resumeSessionId).toBeUndefined();
  expect(logs).toEqual([
    "[dispatcher] ALS-030 resume failed (session expired), spawning fresh",
    "[dispatcher] ALS-030 cleared stale session -> dev_session",
  ]);
  const updated = await readFile(itemFile, "utf-8");
  expect(updated).toContain("dev_session: null");
  expect(updated).not.toContain("dev_session: stale-session-123");
});

test("openai provider falls back fresh on resume turn.failed only", async () => {
  const events = [
    { type: "turn.failed" },
  ];
  setCodexSdkLoaderForTests(async () => ({
    Codex: class {
      resumeThread(threadId: string) {
        expect(threadId).toBe("stale-thread");
        return {
          async runStreamed() {
            return {
              events: (async function* () {
                for (const event of events) {
                  yield event;
                }
              })(),
            };
          },
        };
      }
      startThread() {
        throw new Error("unexpected fresh thread");
      }
    },
  }));

  const result = await getAgentProvider("openai").dispatch({
    itemId: "ALS-030",
    prompt: "Fix it",
    cwd: process.cwd(),
    agent: { description: "developer", prompt: "Fix it" },
    maxTurns: 4,
    maxBudgetUsd: 5,
    resumeSessionId: "stale-thread",
    env: {},
    onToolUse() {},
    onDebugLog() {},
  });

  expect(result.subtype).toBe("error");
  expect(result.resumeRecovery).toEqual({
    reason: "session_missing",
    logMessage: "codex resume turn.failed -> assuming session-gone, falling back fresh",
  });
});

test("anthropic provider falls back fresh when the SDK throws the real resume error", async () => {
  const debugLogs: string[] = [];
  setAnthropicSdkLoaderForTests(async () => ({
    async getSessionInfo() {
      return {
        sessionId: "stale-session-123",
        summary: "Existing session",
        cwd: "/tmp/previous-worktree",
        lastModified: 1_713_918_000_000,
      };
    },
    async *query() {
      yield {
        type: "result",
        subtype: "error_during_execution",
        errors: ["No conversation found with session ID: stale-session-123"],
        duration_ms: 123,
        num_turns: 0,
      };
      throw new Error(
        "Claude Code returned an error result: No conversation found with session ID: stale-session-123",
      );
    },
  }));

  const result = await getAgentProvider("anthropic").dispatch({
    itemId: "ALS-030",
    prompt: "Fix it",
    cwd: process.cwd(),
    agent: { description: "developer", prompt: "Fix it" },
    maxTurns: 4,
    maxBudgetUsd: 5,
    resumeSessionId: "stale-session-123",
    env: {},
    onToolUse() {},
    onDebugLog(detail) {
      debugLogs.push(detail);
    },
  });

  expect(result.subtype).toBe("error_during_execution");
  expect(result.resumeRecovery).toEqual({
    reason: "session_missing",
    logMessage: "resume failed (session expired), spawning fresh",
  });
  expect(debugLogs).toEqual([
    '[resume-recovery] anthropic pre-flight getSessionInfo(stale-se...) -> found summary="Existing session" cwd="/tmp/previous-worktree" lastModified=1713918000000',
    "[resume-recovery] anthropic post-error matcher saw errors=1: No conversation found with session ID: stale-session-123",
    "[resume-recovery] anthropic query threw: Claude Code returned an error result: No conversation found with session ID: stale-session-123",
  ]);
});

test("anthropic provider preserves non-session resume failures", async () => {
  setAnthropicSdkLoaderForTests(async () => ({
    async getSessionInfo() {
      return {
        sessionId: "stale-session-123",
        summary: "Existing session",
        lastModified: 1_713_918_000_000,
      };
    },
    async *query() {
      throw new Error("Claude Code returned an error result: Authentication failed");
    },
  }));

  await expect(
    getAgentProvider("anthropic").dispatch({
      itemId: "ALS-030",
      prompt: "Fix it",
      cwd: process.cwd(),
      agent: { description: "developer", prompt: "Fix it" },
      maxTurns: 4,
      maxBudgetUsd: 5,
      resumeSessionId: "stale-session-123",
      env: {},
      onToolUse() {},
      onDebugLog() {},
    }),
  ).rejects.toThrow("Authentication failed");
});

test("frontmatter setter can clear persisted dispatcher session ids", async () => {
  const root = await mkdtemp(join(tmpdir(), "als-frontmatter-"));
  const file = join(root, "item.md");
  await writeFile(
    file,
    ["---", "dev_session: stale-session-123", "---", "", "body", ""].join("\n"),
    "utf-8",
  );

  const persisted = await setFrontmatterField(file, "dev_session", null);

  expect(persisted).toBe(true);
  expect(await readFile(file, "utf-8")).toContain("dev_session: null");
});
