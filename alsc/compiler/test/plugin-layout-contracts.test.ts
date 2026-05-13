import { expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { codes } from "../src/diagnostics.ts";
import { expectSystemDiagnostic, removePath, validateFixture, withFixtureSandbox, writePath } from "./helpers/fixture.ts";
import { assertBundledPluginLayout } from "./helpers/plugin-layout-contract.ts";

const compilerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const alsRepoRoot = resolve(compilerRoot, "../..");

test("repo plugin layout satisfies the harness-specific hook contract", () => {
  expect(() => assertBundledPluginLayout(alsRepoRoot)).not.toThrow();
});

test("plugin layout contracts reject a poisoned root hooks.json path", async () => {
  await withFixtureSandbox("plugin-layout-poisoned-path", async ({ root }) => {
    await writeMinimalPluginHookSurface(root);
    await writePath(root, "hooks/hooks.json", "{\n  \"hooks\": {}\n}\n");

    expect(() => assertBundledPluginLayout(root)).toThrow("Poisoned path 'hooks/hooks.json' must be absent.");
  });
});

test("plugin layout contracts reject the wrong placeholder family in Claude launchers", async () => {
  await withFixtureSandbox("plugin-layout-wrong-placeholder", async ({ root }) => {
    await writeMinimalPluginHookSurface(root, {
      claudeValidateArg: "${PLUGIN_ROOT}/hooks/als-validate.ts",
    });

    expect(() => assertBundledPluginLayout(root)).toThrow("${PLUGIN_ROOT}");
  });
});

test("alsc validate rejects plugin surfaces that do not contain .als/system.ts", async () => {
  await withFixtureSandbox("plugin-layout-non-system-root", async ({ root }) => {
    await removePath(root, ".als/system.ts");
    await writeMinimalPluginHookSurface(root);

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_INVALID, ".als/system.ts");
    expect(diagnostic.message).toContain("Could not read TypeScript entrypoint");
    expect(result.system_diagnostics.map((item) => item.code)).not.toContain("PAL-CV-SYS-012");
    expect(result.system_diagnostics.map((item) => item.code)).not.toContain("PAL-CV-SYS-013");
    expect(result.system_diagnostics.map((item) => item.code)).not.toContain("PAL-CV-SYS-014");
  });
});

async function writeMinimalPluginHookSurface(
  root: string,
  options: {
    claudeValidateArg?: string;
  } = {},
): Promise<void> {
  await writePath(
    root,
    ".claude-plugin/plugin.json",
    JSON.stringify({
      name: "als",
      version: "0.0.0-test",
      hooks: [
        "./hooks/claude/session-start-operator.json",
        "./hooks/claude/post-edit-validate.json",
        "./hooks/claude/post-edit-breadcrumb.json",
        "./hooks/claude/stop-validate.json",
        "./hooks/claude/session-end-delamain.json",
      ],
    }, null, 2) + "\n",
  );
  await writePath(
    root,
    ".codex-plugin/plugin.json",
    JSON.stringify({
      name: "als",
      version: "0.0.0-test",
      hooks: "./hooks/codex/hooks.json",
    }, null, 2) + "\n",
  );
  await writePath(
    root,
    "hooks/claude/session-start-operator.json",
    JSON.stringify(commandHookConfig("SessionStart", "bun", ["${CLAUDE_PLUGIN_ROOT}/hooks/operator-config-session-start.ts"]), null, 2) + "\n",
  );
  await writePath(
    root,
    "hooks/claude/post-edit-validate.json",
    JSON.stringify(commandHookConfig("PostToolUse", "bun", [options.claudeValidateArg ?? "${CLAUDE_PLUGIN_ROOT}/hooks/als-validate.ts"], "Write|Edit"), null, 2) + "\n",
  );
  await writePath(
    root,
    "hooks/claude/post-edit-breadcrumb.json",
    JSON.stringify(commandHookConfig("PostToolUse", "bun", ["${CLAUDE_PLUGIN_ROOT}/hooks/als-breadcrumb.ts"], "Write|Edit"), null, 2) + "\n",
  );
  await writePath(
    root,
    "hooks/claude/stop-validate.json",
    JSON.stringify(commandHookConfig("Stop", "bun", ["${CLAUDE_PLUGIN_ROOT}/hooks/als-stop-gate.ts"]), null, 2) + "\n",
  );
  await writePath(
    root,
    "hooks/claude/session-end-delamain.json",
    JSON.stringify(commandHookConfig("SessionEnd", "bash", ["${CLAUDE_PLUGIN_ROOT}/hooks/delamain-stop.sh"]), null, 2) + "\n",
  );
  await writePath(
    root,
    "hooks/codex/hooks.json",
    JSON.stringify({
      hooks: {
        SessionStart: [
          {
            matcher: "startup|resume|clear",
            hooks: [
              {
                type: "command",
                command: "bun ${PLUGIN_ROOT}/hooks/operator-config-session-start.ts",
              },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: "apply_patch|Edit|Write",
            hooks: [
              {
                type: "command",
                command: "bun ${PLUGIN_ROOT}/hooks/als-breadcrumb.ts",
              },
              {
                type: "command",
                command: "bun ${PLUGIN_ROOT}/hooks/als-validate.ts",
              },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: "bun ${PLUGIN_ROOT}/hooks/als-stop-gate.ts",
              },
            ],
          },
        ],
      },
    }, null, 2) + "\n",
  );

  for (const relativePath of [
    "hooks/operator-config-session-start.ts",
    "hooks/als-validate.ts",
    "hooks/als-breadcrumb.ts",
    "hooks/als-stop-gate.ts",
  ]) {
    await writePath(root, relativePath, "export {};\n");
  }
  await writePath(root, "hooks/delamain-stop.sh", "#!/usr/bin/env bash\n");
}

function commandHookConfig(
  eventName: string,
  command: string,
  args: string[],
  matcher?: string,
): Record<string, unknown> {
  const eventEntry: Record<string, unknown> = {
    hooks: [
      {
        type: "command",
        command,
        args,
      },
    ],
  };
  if (matcher) {
    eventEntry.matcher = matcher;
  }

  return {
    hooks: {
      [eventName]: [eventEntry],
    },
  };
}
