import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { codes } from "../src/diagnostics.ts";
import { validateSystem } from "../src/validate.ts";

const fixtureRoot = resolve(process.cwd(), "../../example-systems/centralized-metadata-happy-path");

async function copyFixture(): Promise<string> {
  const tempRoot = await mkdtemp(join(tmpdir(), "pals-compiler-"));
  await cp(fixtureRoot, tempRoot, { recursive: true });
  return tempRoot;
}

async function rewriteFixtureFile(
  tempRoot: string,
  relativePath: string,
  transform: (current: string) => string,
): Promise<void> {
  const filePath = join(tempRoot, relativePath);
  const current = await readFile(filePath, "utf-8");
  await writeFile(filePath, transform(current));
}

test("centralized metadata fixture validates clean", () => {
  const result = validateSystem(fixtureRoot);
  expect(result.status).toBe("pass");
  expect(result.summary.error_count).toBe(0);
  expect(result.summary.modules_checked).toBe(4);
});

test("disallowed subheading inside a paragraph-only section fails", async () => {
  const tempRoot = await copyFixture();
  await rewriteFixtureFile(
    tempRoot,
    "workspace/backlog/stories/STORY-0001.md",
    (original) =>
      original.replace(
        "Module contracts must reduce ambiguity for orchestrator and module skills.",
        "Module contracts must reduce ambiguity for orchestrator and module skills.\n\n### Illegal Subheading\n\nThis should fail.",
      ),
  );

  const result = validateSystem(tempRoot);
  expect(result.status).toBe("fail");

  const backlogReport = result.modules.find((report) => report.module_id === "backlog");
  expect(backlogReport).toBeDefined();
  expect(
    backlogReport!.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === codes.BODY_CONSTRAINT_VIOLATION &&
        diagnostic.file.endsWith("STORY-0001.md"),
    ),
  ).toBe(true);
});

test("unknown module mount fails system validation", async () => {
  const tempRoot = await copyFixture();
  await rewriteFixtureFile(
    tempRoot,
    ".pals/system.yaml",
    (current) => current.replace("mount: clients", "mount: ghosts"),
  );

  const result = validateSystem(tempRoot);
  expect(result.status).toBe("fail");
  expect(result.system_diagnostics.some((diagnostic) => diagnostic.code === codes.SYSTEM_INVALID)).toBe(true);
});

test("root mount paths must stay normalized and relative", async () => {
  const tempRoot = await copyFixture();
  await rewriteFixtureFile(
    tempRoot,
    ".pals/system.yaml",
    (current) => current.replace("path: clients", "path: ../clients"),
  );

  const result = validateSystem(tempRoot);
  expect(result.status).toBe("fail");
  expect(result.system_diagnostics.some((diagnostic) => diagnostic.code === codes.SYSTEM_INVALID)).toBe(true);
});

test("module paths must stay normalized and relative", async () => {
  const tempRoot = await copyFixture();
  await rewriteFixtureFile(
    tempRoot,
    ".pals/system.yaml",
    (current) => current.replace("path: registry", "path: ../registry"),
  );

  const result = validateSystem(tempRoot);
  expect(result.status).toBe("fail");
  expect(result.system_diagnostics.some((diagnostic) => diagnostic.code === codes.SYSTEM_INVALID)).toBe(true);
});

test("shape mount mismatch against the registry fails", async () => {
  const tempRoot = await copyFixture();
  await rewriteFixtureFile(
    tempRoot,
    ".pals/modules/client-registry/v1.yaml",
    (current) => current.replace("mount: clients", "mount: workspace"),
  );

  const result = validateSystem(tempRoot);
  expect(result.status).toBe("fail");

  const report = result.modules.find((moduleReport) => moduleReport.module_id === "client-registry");
  expect(report).toBeDefined();
  expect(report!.diagnostics.some((diagnostic) => diagnostic.code === codes.SHAPE_REGISTRY_MISMATCH)).toBe(true);
});
