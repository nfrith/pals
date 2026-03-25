import { expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { VALIDATION_OUTPUT_SCHEMA_LITERAL } from "../src/contracts.ts";
import { updateRecord, updateShapeYaml, validateFixture, withExampleSystemSandbox, withFixtureSandbox } from "./helpers/fixture.ts";

const compilerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test.concurrent("centralized metadata fixture validates clean", async () => {
  await withFixtureSandbox("fixture-smoke", async ({ root }) => {
    const baseline = validateFixture(root);
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

    let result: {
      schema: string;
      als_version: number | null;
      compiler_contract: { supported_als_versions: number[] };
      status: string;
      summary: { error_count: number; files_ignored: number; modules_checked: number };
    };
    try {
      result = JSON.parse(stdout) as {
        schema: string;
        als_version: number | null;
        compiler_contract: { supported_als_versions: number[] };
        status: string;
        summary: { error_count: number; files_ignored: number; modules_checked: number };
      };
    } catch (error) {
      throw new Error(
        `Smoke validation subprocess returned invalid JSON: ${error instanceof Error ? error.message : String(error)}\nstdout:\n${stdout || "<empty>"}\nstderr:\n${stderr || "<empty>"}`,
      );
    }

    expect(result.schema).toBe(VALIDATION_OUTPUT_SCHEMA_LITERAL);
    expect(result.als_version).toBe(1);
    expect(result.compiler_contract.supported_als_versions).toContain(1);
    expect(result.status).toBe("pass");
    expect(result.summary.error_count).toBe(0);
    expect(result.summary.files_ignored).toBe(baseline.summary.files_ignored);
    expect(result.summary.modules_checked).toBe(5);
  });
});

test.concurrent("enum list fields validate clean", async () => {
  await withFixtureSandbox("fixture-enum-list", async ({ root }) => {
    await updateShapeYaml(root, "people", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const personFields = entities.person.fields as Record<string, Record<string, unknown>>;
      personFields.tags = {
        type: "list",
        allow_null: true,
        items: {
          type: "enum",
          allowed_values: ["product", "orchestration", "validation", "linting"],
        },
      };
    });

    const result = validateFixture(root);
    expect(result.status).toBe("pass");
    expect(result.summary.error_count).toBe(0);
  });
});

test.concurrent("empty enum list fields remain valid", async () => {
  await withFixtureSandbox("fixture-enum-list-empty", async ({ root }) => {
    await updateShapeYaml(root, "people", 1, (shape) => {
      const entities = shape.entities as Record<string, Record<string, unknown>>;
      const personFields = entities.person.fields as Record<string, Record<string, unknown>>;
      personFields.tags = {
        type: "list",
        allow_null: false,
        items: {
          type: "enum",
          allowed_values: ["product", "orchestration", "validation", "linting"],
        },
      };
    });
    await updateRecord(root, "workspace/people/persons/PPL-000101.md", (record) => {
      record.data.tags = [];
    });

    const result = validateFixture(root);
    expect(result.status).toBe("pass");
    expect(result.summary.error_count).toBe(0);
  });
});

test.concurrent("rich body design reference validates clean", async () => {
  await withExampleSystemSandbox("rich-body-design-reference", "rich-body-smoke", async ({ root }) => {
    const baseline = validateFixture(root);
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

    let result: {
      schema: string;
      als_version: number | null;
      compiler_contract: { supported_als_versions: number[] };
      status: string;
      summary: { error_count: number; files_ignored: number; modules_checked: number };
    };
    try {
      result = JSON.parse(stdout) as {
        schema: string;
        als_version: number | null;
        compiler_contract: { supported_als_versions: number[] };
        status: string;
        summary: { error_count: number; files_ignored: number; modules_checked: number };
      };
    } catch (error) {
      throw new Error(
        `Smoke validation subprocess returned invalid JSON: ${error instanceof Error ? error.message : String(error)}\nstdout:\n${stdout || "<empty>"}\nstderr:\n${stderr || "<empty>"}`,
      );
    }

    expect(result.schema).toBe(VALIDATION_OUTPUT_SCHEMA_LITERAL);
    expect(result.als_version).toBe(1);
    expect(result.compiler_contract.supported_als_versions).toContain(1);
    expect(result.status).toBe("pass");
    expect(result.summary.error_count).toBe(0);
    expect(result.summary.files_ignored).toBe(baseline.summary.files_ignored);
    expect(result.summary.modules_checked).toBe(6);
  });
});

test.concurrent("rich body content fixture validates clean", async () => {
  await withExampleSystemSandbox("rich-body-content", "rich-body-content-smoke", async ({ root }) => {
    const baseline = validateFixture(root);
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

    let result: {
      schema: string;
      als_version: number | null;
      compiler_contract: { supported_als_versions: number[] };
      status: string;
      summary: { error_count: number; files_ignored: number; modules_checked: number };
    };
    try {
      result = JSON.parse(stdout) as {
        schema: string;
        als_version: number | null;
        compiler_contract: { supported_als_versions: number[] };
        status: string;
        summary: { error_count: number; files_ignored: number; modules_checked: number };
      };
    } catch (error) {
      throw new Error(
        `Smoke validation subprocess returned invalid JSON: ${error instanceof Error ? error.message : String(error)}\nstdout:\n${stdout || "<empty>"}\nstderr:\n${stderr || "<empty>"}`,
      );
    }

    expect(result.schema).toBe(VALIDATION_OUTPUT_SCHEMA_LITERAL);
    expect(result.als_version).toBe(1);
    expect(result.compiler_contract.supported_als_versions).toContain(1);
    expect(result.status).toBe("pass");
    expect(result.summary.error_count).toBe(0);
    expect(result.summary.files_ignored).toBe(baseline.summary.files_ignored);
    expect(result.summary.modules_checked).toBe(6);
  });
});
