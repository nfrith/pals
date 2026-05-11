import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { diag, reasons } from "./diagnostics.ts";
import { toRepoRelative } from "./system-paths.ts";
import type { CompilerDiagnostic } from "./types.ts";

type AuthoredSourcePhase = "system_config" | "module_shape" | "operator_roster" | "operator_profile";
type AuthoredExportName = "system" | "module" | "delamain" | "operatorRoster" | "operator";

interface AuthoredValueIssue {
  path: Array<string | number>;
  message: string;
}

const AUTHORED_SOURCE_HINT = "Author ALS entrypoints as synchronous declarative TypeScript data exports.";
const RESERVED_AUTHORING_SPECIFIER = "als:authoring";
const RESERVED_CONTRACTS_SPECIFIER = "als:contracts";
const AUTHORING_RUNTIME_PATH = fileURLToPath(new URL("./authoring/index.ts", import.meta.url));
const CONTRACTS_RUNTIME_PATH = fileURLToPath(new URL("./contracts.ts", import.meta.url));
const MATERIALIZED_LOAD_ROOT = join(tmpdir(), `als-authored-load-${process.pid}-${randomUUID()}`);
const MATERIALIZED_INSTANCE_ROOT = join(MATERIALIZED_LOAD_ROOT, "instances");
const transpiler = new Bun.Transpiler();
const materializedAuthoredRoots = new Map<string, string>();
let materializedLoadRootInitialized = false;

const LEGACY_AUTHORING_IMPORT_PATHS = {
  system: "./authoring.ts",
  module: "../../../authoring.ts",
  delamain: "../../../../../authoring.ts",
  operatorRoster: "./authoring.ts",
  operator: "../authoring.ts",
} as const satisfies Record<AuthoredExportName, string>;

export function loadAuthoredSourceExport(
  fileAbs: string,
  exportName: AuthoredExportName,
  phase: AuthoredSourcePhase,
  code: string,
  moduleId: string | null,
): { success: true; data: unknown } | { success: false; diagnostics: CompilerDiagnostic[] } {
  const fileRel = toRepoRelative(fileAbs);

  try {
    readFileSync(fileAbs, "utf-8");
  } catch (error) {
    return {
      success: false,
      diagnostics: [
        diag(code, "error", phase, fileRel, "Could not read TypeScript entrypoint", {
          module_id: moduleId ?? undefined,
          reason: reasons.AUTHORED_SOURCE_READ_FAILED,
          expected: "readable TypeScript file",
          actual: error instanceof Error ? error.message : String(error),
          hint: AUTHORED_SOURCE_HINT,
        }),
      ],
    };
  }

  const materializedSource = materializeAuthoredSource(fileAbs, fileRel, exportName, phase, code, moduleId);
  if (!materializedSource.success) {
    return materializedSource;
  }

  let loadedModule: unknown;
  try {
    const requireFn = require as NodeJS.Require;
    const resolvedPath = requireFn.resolve(materializedSource.entry_path);
    // ALS authored entrypoints are loaded once per validation/projection pass.
    // Clearing the direct module cache keeps same-file edits visible, but we do
    // not attempt to invalidate transitive imports beyond that single-shot use.
    delete requireFn.cache?.[resolvedPath];
    loadedModule = requireFn(resolvedPath);
  } catch (error) {
    return {
      success: false,
      diagnostics: [
        diag(code, "error", phase, fileRel, "Could not evaluate TypeScript entrypoint", {
          module_id: moduleId ?? undefined,
          reason: reasons.AUTHORED_SOURCE_LOAD_FAILED,
          expected: `valid TypeScript module exporting '${exportName}'`,
          actual: error instanceof Error ? error.message : String(error),
          hint: AUTHORED_SOURCE_HINT,
        }),
      ],
    };
  } finally {
    cleanupMaterializedSource(materializedSource);
  }

  const candidate = pickAuthoredExport(loadedModule, exportName);
  if (candidate === undefined) {
    return {
      success: false,
      diagnostics: [
        diag(code, "error", phase, fileRel, `TypeScript entrypoint must export '${exportName}' or a default export`, {
          module_id: moduleId ?? undefined,
          field: exportName,
          reason: reasons.AUTHORED_SOURCE_EXPORT_MISSING,
          expected: exportName,
          actual: describeAvailableExports(loadedModule),
          hint: `Export const ${exportName} = ...; export default ${exportName};`,
        }),
      ],
    };
  }

  const declarativeIssues = collectAuthoredValueIssues(candidate);
  if (declarativeIssues.length > 0) {
    return {
      success: false,
      diagnostics: declarativeIssues.map((issue) =>
        diag(code, "error", phase, fileRel, issue.message, {
          module_id: moduleId ?? undefined,
          field: issue.path.join(".") || null,
          reason: reasons.AUTHORED_SOURCE_VALUE_UNSUPPORTED,
          expected: "plain declarative ALS data",
          actual: issue.path,
          hint: AUTHORED_SOURCE_HINT,
        })),
    };
  }

  return { success: true, data: candidate };
}

interface MaterializedAuthoredSource {
  success: true;
  entry_path: string;
}

type MaterializedAuthoredSourceResult =
  | MaterializedAuthoredSource
  | { success: false; diagnostics: CompilerDiagnostic[] };

function materializeAuthoredSource(
  fileAbs: string,
  fileRel: string,
  exportName: AuthoredExportName,
  phase: AuthoredSourcePhase,
  code: string,
  moduleId: string | null,
): MaterializedAuthoredSourceResult {
  const source = readFileSync(fileAbs, "utf-8");

  let transformedSource: string;
  try {
    transformedSource = transpiler.transformSync(source, "ts");
  } catch (error) {
    return {
      success: false,
      diagnostics: [
        diag(code, "error", phase, fileRel, "Could not evaluate TypeScript entrypoint", {
          module_id: moduleId ?? undefined,
          reason: reasons.AUTHORED_SOURCE_LOAD_FAILED,
          expected: `valid TypeScript module exporting '${exportName}'`,
          actual: error instanceof Error ? error.message : String(error),
          hint: AUTHORED_SOURCE_HINT,
        }),
      ],
    };
  }

  let scannedImports: Array<{ kind?: string; path?: string }> = [];
  try {
    scannedImports = transpiler.scanImports(transformedSource) as Array<{ kind?: string; path?: string }>;
  } catch (error) {
    return {
      success: false,
      diagnostics: [
        diag(code, "error", phase, fileRel, "Could not evaluate TypeScript entrypoint", {
          module_id: moduleId ?? undefined,
          reason: reasons.AUTHORED_SOURCE_LOAD_FAILED,
          expected: `valid TypeScript module exporting '${exportName}'`,
          actual: error instanceof Error ? error.message : String(error),
          hint: AUTHORED_SOURCE_HINT,
        }),
      ],
    };
  }

  const expectedLegacyImport = LEGACY_AUTHORING_IMPORT_PATHS[exportName];
  const unsupportedImportDiagnostics = scannedImports
    .filter((entry) => entry.kind === "import-statement" && typeof entry.path === "string")
    .map((entry) => entry.path as string)
    .filter((importPath) =>
      importPath !== RESERVED_AUTHORING_SPECIFIER
      && importPath !== RESERVED_CONTRACTS_SPECIFIER
      && importPath !== expectedLegacyImport,
    )
    .map((importPath) =>
      diag(
        code,
        "error",
        phase,
        fileRel,
        "Authored ALS entrypoints may only import value symbols from ALS authoring surfaces.",
        {
          module_id: moduleId ?? undefined,
          reason: reasons.AUTHORED_SOURCE_IMPORT_UNSUPPORTED,
          expected: [expectedLegacyImport, RESERVED_AUTHORING_SPECIFIER, RESERVED_CONTRACTS_SPECIFIER],
          actual: importPath,
          hint: `Import authoring helpers from '${RESERVED_AUTHORING_SPECIFIER}' and runtime contracts from '${RESERVED_CONTRACTS_SPECIFIER}'.`,
        },
      ),
    );
  if (unsupportedImportDiagnostics.length > 0) {
    return {
      success: false,
      diagnostics: unsupportedImportDiagnostics,
    };
  }

  const materializedRoot = resolveMaterializedAuthoredRoot(fileAbs);
  const materializedEntryPath = join(
    materializedRoot,
    inferMaterializedEntryRelativePath(fileAbs),
  );

  mkdirSync(dirname(materializedEntryPath), { recursive: true });
  writeFileSync(
    join(materializedRoot, "authoring.ts"),
    createLegacyAuthoringShim(),
    "utf-8",
  );
  writeFileSync(
    materializedEntryPath,
    rewriteReservedImportSpecifiers(transformedSource, {
      [RESERVED_AUTHORING_SPECIFIER]: AUTHORING_RUNTIME_PATH,
      [RESERVED_CONTRACTS_SPECIFIER]: CONTRACTS_RUNTIME_PATH,
    }),
    "utf-8",
  );

  return {
    success: true,
    entry_path: materializedEntryPath,
  };
}

function cleanupMaterializedSource(source: MaterializedAuthoredSourceResult): void {
  if (!source.success) {
    return;
  }

  const requireFn = require as NodeJS.Require;
  try {
    const resolvedPath = requireFn.resolve(source.entry_path);
    delete requireFn.cache?.[resolvedPath];
  } catch {
    // Ignore cache cleanup when the module was never resolved successfully.
  }
}

function createLegacyAuthoringShim(): string {
  return [
    `export { defineSystem, defineModule, defineDelamain, defineOperatorRoster, defineOperator } from ${JSON.stringify(AUTHORING_RUNTIME_PATH)};`,
    "export {",
    "  COMPATIBILITY_CLASSES,",
    "  COMPATIBILITY_CLASS_METADATA,",
    "  COMPATIBILITY_CLASS_RELEASE_HEADLINE_ORDER,",
    "  compareCompatibilityClassesByPrecedence,",
    "  highestCompatibilityClass,",
    "  isCompatibilityClass,",
    "  sortCompatibilityClassesByPrecedence,",
    "  type CompatibilityClass,",
    `} from ${JSON.stringify(CONTRACTS_RUNTIME_PATH)};`,
    "",
  ].join("\n");
}

function resolveMaterializedAuthoredRoot(fileAbs: string): string {
  const normalizedFileAbs = resolve(fileAbs);
  const authoredRootMarker = `${sep}.als${sep}`;
  const authoredRootIndex = normalizedFileAbs.lastIndexOf(authoredRootMarker);
  const authoredRootAbs = authoredRootIndex === -1
    ? dirname(normalizedFileAbs)
    : normalizedFileAbs.slice(0, authoredRootIndex + authoredRootMarker.length - 1);
  const cached = materializedAuthoredRoots.get(authoredRootAbs);
  if (cached) {
    return cached;
  }

  initializeMaterializedLoadRoot();
  const namespacedRoot = join(MATERIALIZED_INSTANCE_ROOT, hashMaterializedRoot(authoredRootAbs), ".als");
  mkdirSync(namespacedRoot, { recursive: true });
  materializedAuthoredRoots.set(authoredRootAbs, namespacedRoot);
  return namespacedRoot;
}

function initializeMaterializedLoadRoot(): void {
  if (materializedLoadRootInitialized) {
    return;
  }

  mkdirSync(MATERIALIZED_INSTANCE_ROOT, { recursive: true });
  process.once("exit", () => {
    rmSync(MATERIALIZED_LOAD_ROOT, { recursive: true, force: true });
  });
  materializedLoadRootInitialized = true;
}

function hashMaterializedRoot(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function inferMaterializedEntryRelativePath(fileAbs: string): string {
  const normalizedFileAbs = resolve(fileAbs);
  const authoredRootMarker = `${sep}.als${sep}`;
  const authoredRootIndex = normalizedFileAbs.lastIndexOf(authoredRootMarker);
  if (authoredRootIndex === -1) {
    return fileAbs.replace(/\.ts$/, ".js").split(sep).pop() ?? "entry.js";
  }

  const relativeWithinAls = normalizedFileAbs.slice(authoredRootIndex + authoredRootMarker.length);
  return relativeWithinAls.replace(/\.ts$/, ".js");
}

function rewriteReservedImportSpecifiers(
  source: string,
  importTargets: Record<string, string>,
): string {
  let rewritten = source;
  for (const [specifier, targetPath] of Object.entries(importTargets)) {
    rewritten = rewritten
      .replaceAll(`"${specifier}"`, JSON.stringify(targetPath))
      .replaceAll(`'${specifier}'`, JSON.stringify(targetPath));
  }

  return rewritten;
}

function pickAuthoredExport(loadedModule: unknown, exportName: AuthoredExportName): unknown {
  if (!isExportObject(loadedModule)) {
    return undefined;
  }

  if (Object.hasOwn(loadedModule, exportName)) {
    return loadedModule[exportName];
  }

  if (Object.hasOwn(loadedModule, "default")) {
    return loadedModule.default;
  }

  return undefined;
}

function describeAvailableExports(loadedModule: unknown): string[] | string {
  if (!isExportObject(loadedModule)) {
    return typeof loadedModule;
  }

  const exportKeys = Object.keys(loadedModule);
  return exportKeys.length > 0 ? exportKeys.sort() : "<none>";
}

function collectAuthoredValueIssues(
  value: unknown,
  path: Array<string | number> = [],
): AuthoredValueIssue[] {
  if (value === null) {
    return [];
  }

  const valueType = typeof value;
  if (valueType === "string" || valueType === "boolean") {
    return [];
  }

  if (valueType === "number") {
    return Number.isFinite(value)
      ? []
      : [{ path, message: "Authored ALS values must not contain NaN or Infinity" }];
  }

  if (valueType === "undefined") {
    return [{ path, message: "Authored ALS values must omit keys instead of using undefined" }];
  }

  if (valueType === "function") {
    return [{ path, message: "Authored ALS values must not contain functions" }];
  }

  if (valueType === "symbol" || valueType === "bigint") {
    return [{ path, message: `Authored ALS values must not contain ${valueType}` }];
  }

  if (!value || valueType !== "object") {
    return [{ path, message: `Unsupported authored ALS value type '${valueType}'` }];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectAuthoredValueIssues(item, [...path, index]));
  }

  if (!isPlainObject(value)) {
    return [{ path, message: "Authored ALS values must be plain objects, arrays, or primitives" }];
  }

  const issues: AuthoredValueIssue[] = [];
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (descriptor.get || descriptor.set) {
      issues.push({
        path: [...path, key],
        message: "Authored ALS values must not use getters or setters",
      });
      continue;
    }

    issues.push(...collectAuthoredValueIssues(descriptor.value, [...path, key]));
  }

  return issues;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isExportObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
