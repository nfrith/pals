import { expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { codes } from "../src/diagnostics.ts";
import { validateBundledHookConfigs } from "../src/plugin-hook-config-validation.ts";
import { expectSystemDiagnostic, validateFixture, withFixtureSandbox, writePath } from "./helpers/fixture.ts";

const compilerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const alsRepoRoot = resolve(compilerRoot, "../..");

test("repo hook configs satisfy the platform-specific launcher contracts", () => {
  expect(validateBundledHookConfigs(alsRepoRoot)).toEqual([]);
});

test("alsc validate rejects bare CLAUDE_PLUGIN_ROOT in Claude hook args", async () => {
  await withFixtureSandbox("hook-contracts-claude-bare", async ({ root }) => {
    await writeMinimalPluginHookSurface(root, {
      claudeScriptArg: "$CLAUDE_PLUGIN_ROOT/hooks/als-stop-gate.ts",
      codexCommand: "bun ${PLUGIN_ROOT}/hooks/als-stop-gate.ts",
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_PLUGIN_HOOK_LAUNCHER_INVALID, "hooks/stop-validate.json");
    expect(diagnostic.message).toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(diagnostic.message).toContain("$CLAUDE_PLUGIN_ROOT");
  });
});

test("alsc validate rejects Claude placeholders in the Codex hook bundle", async () => {
  await withFixtureSandbox("hook-contracts-codex-placeholder", async ({ root }) => {
    await writeMinimalPluginHookSurface(root, {
      claudeScriptArg: "${CLAUDE_PLUGIN_ROOT}/hooks/als-stop-gate.ts",
      codexCommand: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/als-stop-gate.ts",
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_PLUGIN_HOOK_LAUNCHER_INVALID, "hooks/hooks.json");
    expect(diagnostic.message).toContain("${PLUGIN_ROOT}");
    expect(diagnostic.message).toContain("${CLAUDE_PLUGIN_ROOT}");
  });
});

async function writeMinimalPluginHookSurface(
  root: string,
  options: {
    claudeScriptArg: string;
    codexCommand: string;
  },
): Promise<void> {
  await writePath(
    root,
    ".claude-plugin/plugin.json",
    JSON.stringify({
      name: "als",
      version: "0.0.0-test",
      hooks: ["./hooks/stop-validate.json"],
    }, null, 2) + "\n",
  );
  await writePath(
    root,
    ".codex-plugin/plugin.json",
    JSON.stringify({
      name: "als",
      version: "0.0.0-test",
      hooks: "./hooks/hooks.json",
    }, null, 2) + "\n",
  );
  await writePath(
    root,
    "hooks/stop-validate.json",
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: "bun",
                args: [options.claudeScriptArg],
                timeout: 30,
              },
            ],
          },
        ],
      },
    }, null, 2) + "\n",
  );
  await writePath(
    root,
    "hooks/hooks.json",
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: options.codexCommand,
                timeout: 30,
              },
            ],
          },
        ],
      },
    }, null, 2) + "\n",
  );
  await writePath(root, "hooks/als-stop-gate.ts", "export {};\n");
}
