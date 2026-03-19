import { expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withFixtureSandbox } from "./helpers/fixture.ts";

const compilerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test.concurrent("centralized metadata fixture validates clean", async () => {
  await withFixtureSandbox("fixture-smoke", async ({ root }) => {
    const process = Bun.spawnSync({
      cmd: ["bun", "src/index.ts", root],
      cwd: compilerRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new TextDecoder().decode(process.stdout);
    const stderr = new TextDecoder().decode(process.stderr);

    if (process.exitCode !== 0) {
      throw new Error(
        `Smoke validation subprocess failed with exit ${process.exitCode}\nstdout:\n${stdout || "<empty>"}\nstderr:\n${stderr || "<empty>"}`,
      );
    }

    let result: { status: string; summary: { error_count: number; modules_checked: number } };
    try {
      result = JSON.parse(stdout) as {
        status: string;
        summary: { error_count: number; modules_checked: number };
      };
    } catch (error) {
      throw new Error(
        `Smoke validation subprocess returned invalid JSON: ${error instanceof Error ? error.message : String(error)}\nstdout:\n${stdout || "<empty>"}\nstderr:\n${stderr || "<empty>"}`,
      );
    }

    expect(result.status).toBe("pass");
    expect(result.summary.error_count).toBe(0);
    expect(result.summary.modules_checked).toBe(5);
  });
});
