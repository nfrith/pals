import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import matter from "gray-matter";
import { loadAuthoredSourceExport } from "../../src/authored-load.ts";
import type { CompilerDiagnostic, ModuleValidationReport, SystemValidationOutput } from "../../src/types.ts";
import { validateSystem } from "../../src/validate.ts";

const fixtureRoot = fileURLToPath(
  new URL("../../../../reference-system/", import.meta.url),
);
const compilerAuthoringPath = fileURLToPath(
  new URL("../../src/authoring/index.ts", import.meta.url),
);

export interface FixtureSandbox {
  root: string;
}

async function createFixtureSandbox(label = "fixture", sourceRoot = fixtureRoot): Promise<FixtureSandbox> {
  const safeLabel = label.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  const root = join(tmpdir(), `als-compiler-${safeLabel}-${randomUUID()}`);
  await mkdir(root, { recursive: false });
  copyFixtureTree(sourceRoot, root);
  await writeFile(
    join(root, ".als/authoring.ts"),
    `export { defineSystem, defineModule, defineDelamain } from ${JSON.stringify(compilerAuthoringPath)};\n`,
  );
  return { root };
}

async function cleanupFixtureSandbox(sandbox: FixtureSandbox): Promise<void> {
  await rm(sandbox.root, { recursive: true, force: true });
}

export async function withFixtureSandbox(
  label: string,
  run: (sandbox: FixtureSandbox) => Promise<void> | void,
): Promise<void> {
  const sandbox = await createFixtureSandbox(label);
  let runError: unknown = null;

  try {
    await run(sandbox);
  } catch (error) {
    runError = error;
  }

  try {
    await cleanupFixtureSandbox(sandbox);
  } catch (cleanupError) {
    if (!runError) {
      throw cleanupError;
    }
  }

  if (runError) {
    throw runError;
  }
}

export function validateFixture(root: string, moduleFilter?: string): SystemValidationOutput {
  return validateSystem(root, moduleFilter);
}

export async function updateTextFile(
  root: string,
  relativePath: string,
  transform: (current: string) => string | Promise<string>,
): Promise<void> {
  const filePath = fixturePath(root, relativePath);
  const current = await readFile(filePath, "utf-8");
  const next = await transform(current);
  await writeFile(filePath, next);
}

export async function updateSystemYaml(
  root: string,
  transform: (current: Record<string, unknown>) => void | Promise<void>,
): Promise<void> {
  await updateAuthoredObjectFile(root, ".als/system.ts", "system", transform);
}

export async function updateShapeYaml(
  root: string,
  moduleId: string,
  version: number,
  transform: (current: Record<string, unknown>) => void | Promise<void>,
): Promise<void> {
  await updateAuthoredObjectFile(root, `.als/modules/${moduleId}/v${version}/module.ts`, "module", transform);
}

export async function updateRecord(
  root: string,
  relativePath: string,
  transform: (record: { data: Record<string, unknown>; content: string }) => void | Promise<void>,
): Promise<void> {
  const filePath = fixturePath(root, relativePath);
  const parsed = matter(await readFile(filePath, "utf-8"));
  const record = {
    data: structuredClone(parsed.data as Record<string, unknown>),
    content: parsed.content,
  };
  await transform(record);
  await writeFile(filePath, matter.stringify(record.content, record.data));
}

export async function writePath(root: string, relativePath: string, contents: string): Promise<void> {
  const filePath = fixturePath(root, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

export async function removePath(root: string, relativePath: string): Promise<void> {
  await rm(fixturePath(root, relativePath), { recursive: true });
}

export async function renamePath(root: string, fromRelativePath: string, toRelativePath: string): Promise<void> {
  const toPath = fixturePath(root, toRelativePath);
  await mkdir(dirname(toPath), { recursive: true });
  await rename(fixturePath(root, fromRelativePath), toPath);
}

export async function mkdirPath(root: string, relativePath: string): Promise<void> {
  await mkdir(fixturePath(root, relativePath), { recursive: true });
}

function findModuleReport(
  result: SystemValidationOutput,
  moduleId: string,
): ModuleValidationReport | undefined {
  return result.modules.find((report) => report.module_id === moduleId);
}

export function expectSystemDiagnostic(
  result: SystemValidationOutput,
  code: string,
  fileSuffix?: string,
): CompilerDiagnostic {
  const diagnostic = result.system_diagnostics.find(
    (item) => item.code === code && (!fileSuffix || item.file.endsWith(fileSuffix)),
  );
  if (!diagnostic) {
    throw new Error(
      `Expected system diagnostic ${describeSearch(code, fileSuffix)}. Actual system diagnostics: ${describeDiagnostics(result.system_diagnostics)}`,
    );
  }

  return diagnostic;
}

export function expectModuleDiagnostic(
  result: SystemValidationOutput,
  moduleId: string,
  code: string,
  fileSuffix?: string,
): CompilerDiagnostic {
  const moduleReport = findModuleReport(result, moduleId);
  if (!moduleReport) {
    throw new Error(
      `Expected module report '${moduleId}'. Actual modules: ${result.modules.map((report) => report.module_id).join(", ") || "<none>"}`,
    );
  }

  const diagnostic = moduleReport.diagnostics.find(
    (item) => item.code === code && (!fileSuffix || item.file.endsWith(fileSuffix)),
  );
  if (!diagnostic) {
    throw new Error(
      `Expected module diagnostic ${describeSearch(code, fileSuffix)} in module '${moduleId}'. Actual diagnostics: ${describeDiagnostics(moduleReport.diagnostics)}`,
    );
  }

  return diagnostic;
}

export function expectModuleDiagnosticContaining(
  result: SystemValidationOutput,
  moduleId: string,
  code: string,
  messageFragment: string,
  fileSuffix?: string,
): CompilerDiagnostic {
  const moduleReport = findModuleReport(result, moduleId);
  if (!moduleReport) {
    throw new Error(
      `Expected module report '${moduleId}'. Actual modules: ${result.modules.map((report) => report.module_id).join(", ") || "<none>"}`,
    );
  }

  const diagnostic = moduleReport.diagnostics.find(
    (item) =>
      item.code === code &&
      item.message.includes(messageFragment) &&
      (!fileSuffix || item.file.endsWith(fileSuffix)),
  );
  if (!diagnostic) {
    throw new Error(
      `Expected module diagnostic ${describeSearch(code, fileSuffix)} containing "${messageFragment}" in module '${moduleId}'. Actual diagnostics: ${describeDiagnostics(moduleReport.diagnostics)}`,
    );
  }

  return diagnostic;
}

export function expectNoModuleDiagnostic(
  result: SystemValidationOutput,
  moduleId: string,
  code: string,
  fileSuffix?: string,
): void {
  const moduleReport = findModuleReport(result, moduleId);
  if (!moduleReport) {
    throw new Error(
      `Expected module report '${moduleId}'. Actual modules: ${result.modules.map((report) => report.module_id).join(", ") || "<none>"}`,
    );
  }

  const diagnostic = moduleReport.diagnostics.find(
    (item) => item.code === code && (!fileSuffix || item.file.endsWith(fileSuffix)),
  );
  if (!diagnostic) {
    return;
  }

  throw new Error(
    `Did not expect module diagnostic ${describeSearch(code, fileSuffix)} in module '${moduleId}'. Actual diagnostics: ${describeDiagnostics(moduleReport.diagnostics)}`,
  );
}

function fixturePath(root: string, relativePath: string): string {
  return join(root, relativePath);
}

async function updateAuthoredObjectFile(
  root: string,
  relativePath: string,
  exportName: "system" | "module" | "delamain",
  transform: (current: Record<string, unknown>) => void | Promise<void>,
): Promise<void> {
  const filePath = fixturePath(root, relativePath);
  const phase = exportName === "system" ? "system_config" : "module_shape";
  const loaded = loadAuthoredSourceExport(filePath, exportName, phase, "fixture", null);
  if (!loaded.success) {
    throw new Error(`Expected authored object at '${relativePath}', received diagnostics: ${describeDiagnostics(loaded.diagnostics)}`);
  }

  if (!isRecord(loaded.data)) {
    throw new Error(`Expected authored object at '${relativePath}', received ${describeValueType(loaded.data)}`);
  }

  const current = structuredClone(loaded.data);
  await transform(current);
  await writeFile(filePath, serializeAuthoredDefinition(exportName, current));
}

function copyFixtureTree(sourceRoot: string, destinationRoot: string, relativeRoot = ""): void {
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    const relativePath = relativeRoot ? join(relativeRoot, entry.name) : entry.name;

    if (entry.isDirectory() && relativePath === ".claude") {
      // Fixture sandboxes model authored source, not deployed Claude runtime
      // output. Tests that need .claude assets project or create them explicitly.
      continue;
    }

    if (entry.isDirectory() && entry.name === "node_modules") {
      // Fixture sandboxes do not need vendored runtime dependencies from the
      // checked-in reference deployment; deploy tests create or preserve their
      // own node_modules state explicitly when they need it.
      continue;
    }

    if (entry.isFile() && relativePath === join(".als", "CLAUDE.md")) {
      // .als/CLAUDE.md is generated deploy output, not authored source.
      continue;
    }

    const sourcePath = join(sourceRoot, entry.name);
    const destinationPath = join(destinationRoot, entry.name);

    if (entry.isDirectory()) {
      mkdirSync(destinationPath, { recursive: true });
      copyFixtureTree(sourcePath, destinationPath, relativePath);
      continue;
    }

    if (!entry.isFile()) continue;
    writeFileSync(destinationPath, readFileSync(sourcePath));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeValueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function serializeAuthoredDefinition(
  exportName: "system" | "module" | "delamain",
  value: Record<string, unknown>,
): string {
  const helperName = exportName === "system"
    ? "defineSystem"
    : exportName === "module"
      ? "defineModule"
      : "defineDelamain";

  const importPath = exportName === "system"
    ? "./authoring.ts"
    : exportName === "module"
      ? "../../../authoring.ts"
      : "../../../../../authoring.ts";

  return `import { ${helperName} } from ${JSON.stringify(importPath)};\n\nexport const ${exportName} = ${helperName}(${JSON.stringify(value, null, 2)} as const);\n\nexport default ${exportName};\n`;
}

function describeSearch(code: string, fileSuffix?: string): string {
  return fileSuffix ? `'${code}' with file suffix '${fileSuffix}'` : `'${code}'`;
}

function describeDiagnostics(diagnostics: CompilerDiagnostic[]): string {
  if (diagnostics.length === 0) return "<none>";
  return diagnostics
    .map((diagnostic) => `${diagnostic.code} @ ${diagnostic.file}`)
    .join(", ");
}
