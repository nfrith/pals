import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import matter from "gray-matter";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { CompilerDiagnostic, ModuleValidationReport, SystemValidationOutput } from "../../src/types.ts";
import { validateSystem } from "../../src/validate.ts";

const fixtureRoot = fileURLToPath(
  new URL("../../../../reference-system/", import.meta.url),
);

export interface FixtureSandbox {
  root: string;
}

async function createFixtureSandbox(label = "fixture", sourceRoot = fixtureRoot): Promise<FixtureSandbox> {
  const safeLabel = label.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  const root = join(tmpdir(), `als-compiler-${safeLabel}-${randomUUID()}`);
  await mkdir(root, { recursive: false });
  copyFixtureTree(sourceRoot, root);
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
  await updateYamlFile(root, ".als/system.yaml", transform);
}

export async function updateShapeYaml(
  root: string,
  moduleId: string,
  version: number,
  transform: (current: Record<string, unknown>) => void | Promise<void>,
): Promise<void> {
  await updateYamlFile(root, `.als/modules/${moduleId}/v${version}/shape.yaml`, transform);
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

async function updateYamlFile(
  root: string,
  relativePath: string,
  transform: (current: Record<string, unknown>) => void | Promise<void>,
): Promise<void> {
  const filePath = fixturePath(root, relativePath);
  const parsed = parseYaml(await readFile(filePath, "utf-8"));
  if (!isRecord(parsed)) {
    throw new Error(`Expected YAML object at '${relativePath}', received ${describeYamlType(parsed)}`);
  }

  const current = structuredClone(parsed);
  await transform(current);
  await writeFile(filePath, stringifyYaml(current));
}

function copyFixtureTree(sourceRoot: string, destinationRoot: string): void {
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    const sourcePath = join(sourceRoot, entry.name);
    const destinationPath = join(destinationRoot, entry.name);

    if (entry.isDirectory()) {
      mkdirSync(destinationPath, { recursive: true });
      copyFixtureTree(sourcePath, destinationPath);
      continue;
    }

    if (!entry.isFile()) continue;
    writeFileSync(destinationPath, readFileSync(sourcePath));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeYamlType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
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
