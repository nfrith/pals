import { expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withFixtureSandbox } from "./helpers/fixture.ts";

const compilerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test.concurrent("alsc validate emits the validation output contract", async () => {
  await withFixtureSandbox("cli-validate", async ({ root }) => {
    const process = Bun.spawnSync({
      cmd: ["bun", "src/cli.ts", "validate", root],
      cwd: compilerRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(process.exitCode).toBe(0);
    const output = JSON.parse(new TextDecoder().decode(process.stdout)) as {
      schema: string;
      status: string;
      system_path: string;
      module_filter: string | null;
    };
    expect(output.schema).toBe("als-validation-output@1");
    expect(output.status).toBe("pass");
    expect(output.system_path.length).toBeGreaterThan(0);
    expect(output.module_filter).toBeNull();
  });
});

test.concurrent("alsc validate supports module-filtered runs", async () => {
  await withFixtureSandbox("cli-validate-filter", async ({ root }) => {
    const process = Bun.spawnSync({
      cmd: ["bun", "src/cli.ts", "validate", root, "backlog"],
      cwd: compilerRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(process.exitCode).toBe(0);
    const output = JSON.parse(new TextDecoder().decode(process.stdout)) as {
      status: string;
      module_filter: string | null;
      modules: Array<{ module_id: string }>;
    };
    expect(output.status).toBe("pass");
    expect(output.module_filter).toBe("backlog");
    expect(output.modules.map((report) => report.module_id)).toEqual(["backlog"]);
  });
});

test.concurrent("alsc deploy claude dry-run exposes the public deploy surface", async () => {
  await withFixtureSandbox("cli-deploy-dry-run", async ({ root }) => {
    const process = Bun.spawnSync({
      cmd: ["bun", "src/cli.ts", "deploy", "claude", "--dry-run", root],
      cwd: compilerRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(process.exitCode).toBe(0);
    const output = JSON.parse(new TextDecoder().decode(process.stdout)) as {
      schema: string;
      status: string;
      dry_run: boolean;
      planned_skill_count: number;
      planned_delamain_count: number;
    };
    expect(output.schema).toBe("als-claude-deploy-output@2");
    expect(output.status).toBe("pass");
    expect(output.dry_run).toBe(true);
    expect(output.planned_skill_count).toBeGreaterThan(0);
    expect(output.planned_delamain_count).toBe(0);
  });
});

test.concurrent("alsc help surfaces the main usage text", async () => {
  const process = Bun.spawnSync({
    cmd: ["bun", "src/cli.ts", "--help"],
    cwd: compilerRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(process.exitCode).toBe(0);
  const stdout = new TextDecoder().decode(process.stdout);
  expect(stdout).toContain("alsc validate <system-root> [module-id]");
  expect(stdout).toContain("alsc deploy claude");
});

test.concurrent("alsc validate help surfaces command usage", async () => {
  const process = Bun.spawnSync({
    cmd: ["bun", "src/cli.ts", "validate", "--help"],
    cwd: compilerRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(process.exitCode).toBe(0);
  expect(new TextDecoder().decode(process.stdout)).toContain("Usage: alsc validate <system-root> [module-id]");
});

test.concurrent("alsc rejects invalid command usage with a usage error", async () => {
  const process = Bun.spawnSync({
    cmd: ["bun", "src/cli.ts", "deploy", "ghost"],
    cwd: compilerRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(process.exitCode).toBe(2);
  expect(new TextDecoder().decode(process.stderr)).toContain("Usage: alsc deploy claude");
});
