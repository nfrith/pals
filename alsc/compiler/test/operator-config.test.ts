import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { OperatorConfig } from "../src/operator-config.ts";
import {
  buildOperatorConfigSessionStartOutput,
  inspectOperatorConfigSource,
  resolveOperatorConfigPath,
  serializeOperatorConfigDocument,
} from "../src/operator-config.ts";
import { runCli } from "../src/cli.ts";

const VALID_OPERATOR_CONFIG: OperatorConfig = {
  config_version: 1,
  created: "2026-04-25",
  updated: "2026-04-25",
  first_name: "Nick",
  last_name: "Frith",
  display_name: null,
  primary_email: "nick@example.com",
  role: "Founder",
  profiles: ["edgerunner"],
  owns_company: true,
  company_name: "Example Co",
  company_type: "llc",
  company_type_other: null,
  revenue_band: "100k-1M",
};

test("resolveOperatorConfigPath resolves the system-scoped operator config path", async () => {
  await withTempDir("operator-config-path-resolution", async (root) => {
    const systemRoot = join(root, "system");
    await createAlsSystem(systemRoot);

    expect(resolveOperatorConfigPath(systemRoot)).toBe(join(systemRoot, ".als", "operator.md"));
    expect(resolveOperatorConfigPath(join(systemRoot, "nested", "path"))).toBe(join(systemRoot, ".als", "operator.md"));
    expect(resolveOperatorConfigPath(join(systemRoot, ".als", "operator.md"))).toBe(join(systemRoot, ".als", "operator.md"));
  });
});

test("operator config round-trips through markdown serialization and inspection", () => {
  const source = serializeOperatorConfigDocument({
    config: VALID_OPERATOR_CONFIG,
    body: "## Notes\n\nStable operator context.\n",
  });
  const inspection = inspectOperatorConfigSource(source, "/tmp/operator.md");

  expect(inspection.status).toBe("pass");
  expect(inspection.errors).toEqual([]);
  expect(inspection.warnings).toEqual([]);
  expect(inspection.config).toEqual(VALID_OPERATOR_CONFIG);
  expect(inspection.body).toContain("Stable operator context.");
});

test("operator config inspection rejects the legacy profile literal", () => {
  const legacyProfile = ["op", "erator"].join("");
  const inspection = inspectOperatorConfigSource(
    serializeOperatorConfigDocument({
      config: VALID_OPERATOR_CONFIG,
      body: "",
    }).replace("edgerunner", legacyProfile),
    "/tmp/operator.md",
  );

  expect(inspection.status).toBe("fail");
  expect(inspection.errors).toEqual(expect.arrayContaining([expect.objectContaining({ path: "profiles.0" })]));
});

test("operator config inspection blocks credential-like values", () => {
  const source = serializeOperatorConfigDocument({
    config: {
      ...VALID_OPERATOR_CONFIG,
      company_name: "sk-abcdefghijklmnopqrstuvwx123456",
    },
    body: "",
  });
  const inspection = inspectOperatorConfigSource(source, "/tmp/operator.md");

  expect(inspection.status).toBe("fail");
  expect(inspection.errors).toEqual([]);
  expect(inspection.warnings).toHaveLength(1);
  expect(inspection.warnings[0]?.path).toBe("company_name");
});

test("session-start output injects the operator reminder when the config is valid", async () => {
  await withTempDir("operator-config-session-start", async (root) => {
    const systemRoot = join(root, "system");
    const projectDir = join(systemRoot, "nested", "project");
    const operatorConfigPath = join(systemRoot, ".als", "operator.md");

    await createAlsSystem(systemRoot);
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      operatorConfigPath,
      serializeOperatorConfigDocument({
        config: VALID_OPERATOR_CONFIG,
        body: "",
      }),
    );

    const output = buildOperatorConfigSessionStartOutput(projectDir);
    expect(output).toContain("<system-reminder>");
    expect(output).toContain("Stable operator context loaded");
    expect(output).toContain("Revenue band: 100k-1M");
  });
});

test("session-start output is a no-op outside ALS systems", () => {
  const output = buildOperatorConfigSessionStartOutput("/tmp/not-an-als-system");
  expect(output).toBe("");
});

test("session-start output is suppressed when the current ALS system opts out", async () => {
  await withTempDir("operator-config-session-start-skip", async (root) => {
    const systemRoot = join(root, "system");
    const operatorConfigPath = join(systemRoot, ".als", "operator.md");

    await createAlsSystem(systemRoot);
    await writeFile(join(systemRoot, ".als", "skip-operator-config"), "skip\n");
    await writeFile(
      operatorConfigPath,
      serializeOperatorConfigDocument({
        config: VALID_OPERATOR_CONFIG,
        body: "",
      }),
    );

    const output = buildOperatorConfigSessionStartOutput(systemRoot);
    expect(output).toBe("");
  });
});

test("different ALS systems keep independent operator configs", async () => {
  await withTempDir("operator-config-multi-system", async (root) => {
    const systemA = join(root, "system-a");
    const systemB = join(root, "system-b");
    await createAlsSystem(systemA);
    await createAlsSystem(systemB);

    await writeFile(
      join(systemA, ".als", "operator.md"),
      serializeOperatorConfigDocument({
        config: {
          ...VALID_OPERATOR_CONFIG,
          first_name: "Alice",
          last_name: "Operator",
          company_name: "Alpha Co",
        },
        body: "",
      }),
    );
    await writeFile(
      join(systemB, ".als", "operator.md"),
      serializeOperatorConfigDocument({
        config: {
          ...VALID_OPERATOR_CONFIG,
          first_name: "Bob",
          last_name: "Builder",
          company_name: "Beta Co",
        },
        body: "",
      }),
    );

    const outputA = buildOperatorConfigSessionStartOutput(join(systemA, "nested"));
    const outputB = buildOperatorConfigSessionStartOutput(join(systemB, "nested"));

    expect(outputA).toContain("Alpha Co");
    expect(outputA).toContain("Alice Operator");
    expect(outputA).not.toContain("Beta Co");
    expect(outputB).toContain("Beta Co");
    expect(outputB).toContain("Bob Builder");
    expect(outputB).not.toContain("Alpha Co");
  });
});

test("cli operator-config inspect reports missing system-scoped files without failing", async () => {
  await withTempDir("operator-config-cli-missing", async (root) => {
    const systemRoot = join(root, "system");
    await createAlsSystem(systemRoot);

    const result = captureCli(["operator-config", "inspect", systemRoot]);
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as { status: string; exists: boolean; file_path: string };
    expect(output.status).toBe("missing");
    expect(output.exists).toBe(false);
    expect(output.file_path).toBe(join(systemRoot, ".als", "operator.md"));
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
    expect(result.stdout.trim()).toBe(join(systemRoot, ".als", "operator.md"));
  });
});

test("cli operator-config session-start prints remediation for invalid configs", async () => {
  await withTempDir("operator-config-cli-remediation", async (root) => {
    const systemRoot = join(root, "system");
    const projectDir = join(systemRoot, "project");
    const operatorConfigPath = join(systemRoot, ".als", "operator.md");

    await createAlsSystem(systemRoot);
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      operatorConfigPath,
      `---
config_version: 1
created: 2026-04-25
updated: 2026-04-25
first_name: Nick
last_name: Frith
display_name: null
primary_email: not-an-email
role: Founder
profiles:
  - edgerunner
owns_company: false
company_name: null
company_type: null
company_type_other: null
revenue_band: null
---
`,
    );

    const result = captureCli(["operator-config", "session-start", projectDir]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Run /operator-config to repair it");
    expect(result.stdout).toContain("primary_email");
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
  await writeFile(join(systemRoot, ".als", "system.ts"), "export const system = {};\n");
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
