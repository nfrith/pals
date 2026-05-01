import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runCli } from "../src/cli.ts";
import {
  acquireSyntheticDeprecationFixture,
  releaseSyntheticDeprecationFixture,
  SYNTHETIC_DEPRECATION_CONTRACT,
  SYNTHETIC_DEPRECATION_VALUES,
  syntheticDeprecationFixtureEnv,
} from "./helpers/deprecation-fixture.ts";
import { updateRecord, updateShapeYaml, withFixtureSandbox } from "./helpers/fixture.ts";

const backlogRecordIds = ["ITEM-0001", "ITEM-0002", "ITEM-0003"] as const;
const compilerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const alsRepoRoot = resolve(compilerRoot, "../..");
const postValidateHookPath = resolve(alsRepoRoot, "hooks/als-validate.sh");
const stopHookPath = resolve(alsRepoRoot, "hooks/als-stop-gate.sh");

beforeAll(() => {
  acquireSyntheticDeprecationFixture();
});

afterAll(() => {
  releaseSyntheticDeprecationFixture();
});

async function configureSyntheticDeprecationFixture(root: string): Promise<void> {
  await updateShapeYaml(root, "backlog", 1, (shape) => {
    const entities = shape.entities as Record<string, Record<string, unknown>>;
    const itemFields = entities.item.fields as Record<string, Record<string, unknown>>;
    itemFields.warning_status = {
      type: "enum",
      allow_null: true,
      allowed_values: [...SYNTHETIC_DEPRECATION_VALUES],
    };
  });

  for (const recordId of backlogRecordIds) {
    await updateRecord(root, `workspace/backlog/items/${recordId}.md`, (record) => {
      record.data.warning_status = recordId === "ITEM-0001" ? "synthetic-deprecated" : null;
    });
  }
}

function captureCli(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  let stdout = "";
  let stderr = "";
  const exitCode = runCli(args, {
    stdout(value) {
      stdout += value.endsWith("\n") ? value : `${value}\n`;
    },
    stderr(value) {
      stderr += value.endsWith("\n") ? value : `${value}\n`;
    },
  });

  return {
    exitCode,
    stdout,
    stderr,
  };
}

function runHook(
  scriptPath: string,
  payload: unknown,
  env: Record<string, string> = {},
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: ["bash", scriptPath],
    cwd: alsRepoRoot,
    env: {
      ...process.env,
      ...env,
      CLAUDE_PLUGIN_ROOT: alsRepoRoot,
    },
    stdin: new TextEncoder().encode(JSON.stringify(payload)),
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

test("alsc validate emits the validation output contract", async () => {
  await withFixtureSandbox("cli-validate", async ({ root }) => {
    const process = captureCli(["validate", root]);

    expect(process.exitCode).toBe(0);
    const output = JSON.parse(process.stdout) as {
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

test("alsc validate supports module-filtered runs", async () => {
  await withFixtureSandbox("cli-validate-filter", async ({ root }) => {
    const process = captureCli(["validate", root, "backlog"]);

    expect(process.exitCode).toBe(0);
    const output = JSON.parse(process.stdout) as {
      status: string;
      module_filter: string | null;
      modules: Array<{ module_id: string }>;
    };
    expect(output.status).toBe("pass");
    expect(output.module_filter).toBe("backlog");
    expect(output.modules.map((report) => report.module_id)).toEqual(["backlog"]);
  });
});

test("alsc construct inspect emits the public construct inspection output contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "als-cli-construct-"));
  try {
    await mkdir(join(root, "migrations"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "VERSION"), "12\n", "utf-8");
    await writeFile(join(root, "construct.json"), JSON.stringify({
      schema: "als-construct-manifest@1",
      name: "dispatcher",
      version: 12,
      migration_strategy: "sequential",
      lifecycle_strategy: "dispatcher-lifecycle",
      migrations_dir: "migrations",
      source_paths: [
        { path: "src", owner: "vendor" },
      ],
    }, null, 2) + "\n", "utf-8");

    const result = captureCli(["construct", "inspect", root]);
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as {
      status: string;
      manifest: { schema: string } | null;
    };
    expect(output.status).toBe("pass");
    expect(output.manifest?.schema).toBe("als-construct-manifest@1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("alsc validate exits zero and reports warn when only deprecations are present", async () => {
  await withFixtureSandbox("cli-validate-warn", async ({ root }) => {
    await configureSyntheticDeprecationFixture(root);

    const process = captureCli(["validate", root, "backlog"]);
    expect(process.exitCode).toBe(0);

    const output = JSON.parse(process.stdout) as {
      status: string;
      summary: { error_count: number; warning_count: number };
      modules: Array<{
        module_id: string;
        diagnostics: Array<{
          code: string;
          severity: string;
          deprecation: {
            contract: string;
            value: string;
            since: string;
            removed_in: string;
            replacement: string | null;
          } | null;
        }>;
      }>;
    };
    expect(output.status).toBe("warn");
    expect(output.summary.error_count).toBe(0);
    expect(output.summary.warning_count).toBe(1);
    expect(output.modules[0].module_id).toBe("backlog");
    const warning = output.modules[0].diagnostics.find((diagnostic) => diagnostic.code === "PAL-RV-FM-011");
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe("warning");
    expect(warning?.deprecation).toEqual({
      contract: SYNTHETIC_DEPRECATION_CONTRACT,
      value: "synthetic-deprecated",
      since: "v1.4",
      removed_in: "v1.6",
      replacement: "synthetic-supported",
    });
  });
});

test("als post-edit hook surfaces warn-only context without blocking", async () => {
  await withFixtureSandbox("cli-hook-post-warn", async ({ root }) => {
    await configureSyntheticDeprecationFixture(root);

    const process = runHook(postValidateHookPath, {
      tool_input: {
        file_path: `${root}/workspace/backlog/items/ITEM-0001.md`,
      },
    }, syntheticDeprecationFixtureEnv());

    expect(process.exitCode).toBe(0);
    expect(process.stderr).toBe("");
    const output = JSON.parse(process.stdout) as {
      decision?: string;
      hookSpecificOutput?: {
        additionalContext?: string;
      };
    };
    expect(output.decision).toBeUndefined();
    expect(output.hookSpecificOutput?.additionalContext).toContain("synthetic-deprecated");
    expect(output.hookSpecificOutput?.additionalContext).toContain("do not block");
  });
});

test("als stop hook surfaces a final warn-only reminder without blocking", async () => {
  await withFixtureSandbox("cli-hook-stop-warn", async ({ root }) => {
    await configureSyntheticDeprecationFixture(root);

    const sessionId = `als059-${randomUUID()}`;
    const breadcrumbPath = `/tmp/als-touched-${sessionId}`;

    try {
      await Bun.write(breadcrumbPath, `${root}:backlog\n`);
      const process = runHook(stopHookPath, {
        session_id: sessionId,
      }, syntheticDeprecationFixtureEnv());

      expect(process.exitCode).toBe(0);
      expect(process.stderr).toBe("");
      const output = JSON.parse(process.stdout) as {
        decision?: string;
        hookSpecificOutput?: {
          additionalContext?: string;
        };
      };
      expect(output.decision).toBeUndefined();
      expect(output.hookSpecificOutput?.additionalContext).toContain("non-blocking warnings");
      expect(output.hookSpecificOutput?.additionalContext).toContain("synthetic-deprecated");
      expect(existsSync(breadcrumbPath)).toBe(false);
    } finally {
      if (existsSync(breadcrumbPath)) {
        rmSync(breadcrumbPath, { force: true });
      }
    }
  });
});

test("alsc validate exits one when errors and deprecation warnings coexist", async () => {
  await withFixtureSandbox("cli-validate-fail-with-warning", async ({ root }) => {
    await configureSyntheticDeprecationFixture(root);
    await updateRecord(root, "workspace/backlog/items/ITEM-0001.md", (record) => {
      delete record.data.title;
    });

    const process = captureCli(["validate", root, "backlog"]);
    expect(process.exitCode).toBe(1);

    const output = JSON.parse(process.stdout) as {
      status: string;
      summary: { error_count: number; warning_count: number };
      modules: Array<{
        diagnostics: Array<{ code: string }>;
      }>;
    };
    expect(output.status).toBe("fail");
    expect(output.summary.error_count).toBeGreaterThan(0);
    expect(output.summary.warning_count).toBe(1);
    expect(output.modules[0].diagnostics.some((diagnostic) => diagnostic.code === "PAL-RV-FM-001")).toBe(true);
    expect(output.modules[0].diagnostics.some((diagnostic) => diagnostic.code === "PAL-RV-FM-011")).toBe(true);
  });
});

test("alsc deploy claude dry-run exposes the public deploy surface", async () => {
  await withFixtureSandbox("cli-deploy-dry-run", async ({ root }) => {
    const process = captureCli(["deploy", "claude", "--dry-run", root]);

    expect(process.exitCode).toBe(0);
    const output = JSON.parse(process.stdout) as {
      schema: string;
      status: string;
      dry_run: boolean;
      planned_system_file_count: number;
      written_system_file_count: number;
      planned_system_files: Array<{ kind: string; target_path: string }>;
      planned_skill_count: number;
      planned_delamain_count: number;
      warnings: Array<{ code: string; delamain_name: string; target_path: string }>;
    };
    expect(output.schema).toBe("als-claude-deploy-output@4");
    expect(output.status).toBe("pass");
    expect(output.dry_run).toBe(true);
    expect(output.planned_system_file_count).toBe(1);
    expect(output.written_system_file_count).toBe(0);
    expect(output.planned_system_files).toEqual([
      {
        kind: "generated_claude_guidance",
        target_path: ".als/CLAUDE.md",
      },
    ]);
    expect(output.planned_skill_count).toBe(24);
    expect(output.planned_delamain_count).toBe(5);
    expect(output.warnings).toEqual([]);
  });
});

test("alsc help surfaces the main usage text", async () => {
  const process = captureCli(["--help"]);

  expect(process.exitCode).toBe(0);
  const { stdout } = process;
  expect(stdout).toContain("alsc validate <system-root> [module-id]");
  expect(stdout).toContain("alsc deploy claude");
  expect(stdout).toContain("alsc changelog inspect [als-repo-or-changelog-path]");
  expect(stdout).toContain("alsc operator-config path [system-root-or-cwd]");
  expect(stdout).toContain("Project active ALS Claude assets into .als/ and .claude/.");
});

test("alsc validate help surfaces command usage", async () => {
  const process = captureCli(["validate", "--help"]);

  expect(process.exitCode).toBe(0);
  expect(process.stdout).toContain("Usage: alsc validate <system-root> [module-id]");
});

test("alsc changelog help surfaces command usage", async () => {
  const process = captureCli(["changelog", "--help"]);

  expect(process.exitCode).toBe(0);
  expect(process.stdout).toContain("Usage: alsc changelog inspect [als-repo-or-changelog-path]");
});

test("alsc rejects invalid command usage with a usage error", async () => {
  const process = captureCli(["deploy", "ghost"]);

  expect(process.exitCode).toBe(2);
  expect(process.stderr).toContain("Usage: alsc deploy claude");
});
