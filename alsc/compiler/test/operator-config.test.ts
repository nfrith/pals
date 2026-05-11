import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { LegacyOperatorConfig, OperatorConfig } from "../src/operator-config.ts";
import {
  buildOperatorConfigSessionStartOutput,
  inspectLegacyOperatorConfigSource,
  inspectOperatorConfig,
  resolveOperatorConfigPath,
  serializeActiveOperatorSelection,
  serializeLegacyOperatorConfigDocument,
  serializeOperatorConfigSource,
  serializeOperatorRosterSource,
  selectSingletonActiveOperator,
} from "../src/operator-config.ts";
import { runCli } from "../src/cli.ts";

const VALID_OPERATOR: OperatorConfig = {
  id: "nick-frith",
  first_name: "Nick",
  last_name: "Frith",
  display_name: "0xnfrith",
  primary_email: "nick@example.com",
  role: "Founder",
  profiles: ["edgerunner"],
  owns_company: true,
  company_name: "Example Co",
  company_type: "llc",
  company_type_other: null,
  revenue_band: "100k-1M",
};

const VALID_LEGACY_OPERATOR: LegacyOperatorConfig = {
  config_version: 1,
  created: "2026-04-25",
  updated: "2026-04-25",
  first_name: "Nick",
  last_name: "Frith",
  display_name: "0xnfrith",
  primary_email: "nick@example.com",
  role: "Founder",
  profiles: ["edgerunner"],
  owns_company: true,
  company_name: "Example Co",
  company_type: "llc",
  company_type_other: null,
  revenue_band: "100k-1M",
};

test("resolveOperatorConfigPath resolves the system-scoped operator roster path", async () => {
  await withTempDir("operator-config-path-resolution", async (root) => {
    const systemRoot = join(root, "system");
    await createAlsSystem(systemRoot);

    expect(resolveOperatorConfigPath(systemRoot)).toBe(join(systemRoot, ".als", "operator-roster.ts"));
    expect(resolveOperatorConfigPath(join(systemRoot, "nested", "path"))).toBe(join(systemRoot, ".als", "operator-roster.ts"));
  });
});

test("legacy operator config round-trips through markdown serialization and inspection", () => {
  const source = serializeLegacyOperatorConfigDocument({
    config: VALID_LEGACY_OPERATOR,
    body: "## Notes\n\nStable operator context.\n",
  });
  const inspection = inspectLegacyOperatorConfigSource(source, "/tmp/operator.md");

  expect(inspection.status).toBe("pass");
  expect(inspection.errors).toEqual([]);
  expect(inspection.warnings).toEqual([]);
  expect(inspection.config).toEqual(VALID_LEGACY_OPERATOR);
  expect(inspection.body).toContain("Stable operator context.");
});

test("session-start output injects the operator reminder when roster and selector are valid", async () => {
  await withTempDir("operator-config-session-start", async (root) => {
    const systemRoot = join(root, "system");
    const projectDir = join(systemRoot, "nested", "project");

    await createAlsSystem(systemRoot);
    await mkdir(projectDir, { recursive: true });
    await writeOperatorSurface(systemRoot, [VALID_OPERATOR], VALID_OPERATOR.id);

    const output = buildOperatorConfigSessionStartOutput(projectDir);
    expect(output).toContain("<system-reminder>");
    expect(output).toContain("Stable operator context loaded");
    expect(output).toContain("Operator ID: nick-frith");
  });
});

test("session-start output remediates when no roster surface exists", async () => {
  await withTempDir("operator-config-missing-roster", async (root) => {
    const systemRoot = join(root, "system");
    await createAlsSystem(systemRoot);

    const output = buildOperatorConfigSessionStartOutput(systemRoot);
    expect(output).toContain("Operator config is not usable");
    expect(output).toContain("No operator roster found");
  });
});

test("session-start output remediates when selector points at an unknown operator id", async () => {
  await withTempDir("operator-config-unknown-selector", async (root) => {
    const systemRoot = join(root, "system");
    await createAlsSystem(systemRoot);
    await writeOperatorSurface(systemRoot, [VALID_OPERATOR], "other-operator");

    const output = buildOperatorConfigSessionStartOutput(systemRoot);
    expect(output).toContain("does not exist in the roster");
    expect(output).toContain("other-operator");
  });
});

test("session-start output is suppressed when the current ALS system opts out", async () => {
  await withTempDir("operator-config-session-start-skip", async (root) => {
    const systemRoot = join(root, "system");

    await createAlsSystem(systemRoot);
    await writeFile(join(systemRoot, ".als", "skip-operator-config"), "skip\n");
    await writeOperatorSurface(systemRoot, [VALID_OPERATOR], VALID_OPERATOR.id);

    const output = buildOperatorConfigSessionStartOutput(systemRoot);
    expect(output).toBe("");
  });
});

test("inspectOperatorConfig reports missing for untouched systems", async () => {
  await withTempDir("operator-config-inspect-missing", async (root) => {
    const systemRoot = join(root, "system");
    await createAlsSystem(systemRoot);

    const inspection = inspectOperatorConfig(systemRoot);
    expect(inspection?.status).toBe("missing");
    expect(inspection?.exists).toBe(false);
    expect(inspection?.file_path).toBe(join(systemRoot, ".als", "operator-roster.ts"));
  });
});

test("inspectOperatorConfig fails on basename and id mismatches", async () => {
  await withTempDir("operator-config-basename-mismatch", async (root) => {
    const systemRoot = join(root, "system");
    await createAlsSystem(systemRoot);

    await mkdir(join(systemRoot, ".als", "operators"), { recursive: true });
    await writeFile(
      join(systemRoot, ".als", "operator-roster.ts"),
      serializeOperatorRosterSource({
        operator_paths: ["./operators/not-nick.ts"],
      }),
      "utf-8",
    );
    await writeFile(
      join(systemRoot, ".als", "operators", "not-nick.ts"),
      serializeOperatorConfigSource(VALID_OPERATOR),
      "utf-8",
    );

    const inspection = inspectOperatorConfig(systemRoot);
    expect(inspection?.status).toBe("fail");
    expect(inspection?.errors.some((issue) => issue.code === "operator.basename_mismatch")).toBe(true);
  });
});

test("inspectOperatorConfig fails on duplicate operator ids", async () => {
  await withTempDir("operator-config-duplicate-ids", async (root) => {
    const systemRoot = join(root, "system");
    await createAlsSystem(systemRoot);

    await writeOperatorSurface(systemRoot, [
      VALID_OPERATOR,
      {
        ...VALID_OPERATOR,
        id: VALID_OPERATOR.id,
        first_name: "Alice",
        last_name: "Operator",
        display_name: "alice",
      },
    ], VALID_OPERATOR.id, [
      "./operators/nick-frith.ts",
      "./operators/alice-operator.ts",
    ]);

    const inspection = inspectOperatorConfig(systemRoot);
    expect(inspection?.status).toBe("fail");
    expect(inspection?.errors.some((issue) => issue.code === "operator.id_duplicate")).toBe(true);
  });
});

test("selectSingletonActiveOperator writes the local selector for one-entry rosters", async () => {
  await withTempDir("operator-config-select-singleton", async (root) => {
    const systemRoot = join(root, "system");
    await createAlsSystem(systemRoot);
    await writeOperatorSurface(systemRoot, [VALID_OPERATOR], null);

    const result = selectSingletonActiveOperator(systemRoot);
    expect(result.status).toBe("pass");
    expect(result.operator_id).toBe(VALID_OPERATOR.id);

    const inspection = inspectOperatorConfig(systemRoot);
    expect(inspection?.status).toBe("pass");
    expect(inspection?.config?.id).toBe(VALID_OPERATOR.id);
  });
});

test("cli operator-config inspect reports missing systems without failing", async () => {
  await withTempDir("operator-config-cli-missing", async (root) => {
    const systemRoot = join(root, "system");
    await createAlsSystem(systemRoot);

    const result = captureCli(["operator-config", "inspect", systemRoot]);
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as { status: string; exists: boolean; file_path: string };
    expect(output.status).toBe("missing");
    expect(output.exists).toBe(false);
    expect(output.file_path).toBe(join(systemRoot, ".als", "operator-roster.ts"));
  });
});

test("cli operator-config path resolves the current ALS system", async () => {
  await withTempDir("operator-config-cli-path", async (root) => {
    const systemRoot = join(root, "system");
    const nestedDir = join(systemRoot, "nested", "cwd");
    await createAlsSystem(systemRoot);
    await mkdir(nestedDir, { recursive: true });

    const result = captureCli(["operator-config", "path", nestedDir]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(join(systemRoot, ".als", "operator-roster.ts"));
  });
});

test("cli operator-config select-singleton writes the local selector", async () => {
  await withTempDir("operator-config-cli-select-singleton", async (root) => {
    const systemRoot = join(root, "system");
    await createAlsSystem(systemRoot);
    await writeOperatorSurface(systemRoot, [VALID_OPERATOR], null);

    const result = captureCli(["operator-config", "select-singleton", systemRoot]);
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as { status: string; operator_id: string | null };
    expect(output.status).toBe("pass");
    expect(output.operator_id).toBe(VALID_OPERATOR.id);
  });
});

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

  return { exitCode, stdout, stderr };
}

async function createAlsSystem(systemRoot: string): Promise<void> {
  await mkdir(join(systemRoot, ".als"), { recursive: true });
  await writeFile(join(systemRoot, ".als", "system.ts"), "export const system = {};\n", "utf-8");
}

async function writeOperatorSurface(
  systemRoot: string,
  operators: OperatorConfig[],
  activeOperatorId: string | null,
  operatorPaths = operators.map((operator) => `./operators/${operator.id}.ts`),
): Promise<void> {
  await mkdir(join(systemRoot, ".als", "operators"), { recursive: true });
  await writeFile(
    join(systemRoot, ".als", "operator-roster.ts"),
    serializeOperatorRosterSource({
      operator_paths: operatorPaths,
    }),
    "utf-8",
  );

  for (const [index, operator] of operators.entries()) {
    const operatorPath = operatorPaths[index]!;
    await writeFile(
      join(systemRoot, ".als", operatorPath.replace(/^\.\//, "")),
      serializeOperatorConfigSource(operator),
      "utf-8",
    );
  }

  if (activeOperatorId) {
    await mkdir(join(systemRoot, ".als", "local"), { recursive: true });
    await writeFile(
      join(systemRoot, ".als", "local", "active-operator.json"),
      serializeActiveOperatorSelection({
        schema: "als-active-operator-selection@1",
        operator_id: activeOperatorId,
      }),
      "utf-8",
    );
  }
}

async function withTempDir(label: string, run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `${label}-`));
  let runError: unknown = null;

  try {
    await run(root);
  } catch (error) {
    runError = error;
  }

  await rm(root, { recursive: true, force: true });

  if (runError) {
    throw runError;
  }
}
