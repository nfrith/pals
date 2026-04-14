import { readFileSync } from "node:fs";
import { diag, reasons } from "./diagnostics.ts";
import { toRepoRelative } from "./system-paths.ts";
import type { CompilerDiagnostic } from "./types.ts";

type AuthoredSourcePhase = "system_config" | "module_shape";
type AuthoredExportName = "system" | "module" | "delamain";

interface AuthoredValueIssue {
  path: Array<string | number>;
  message: string;
}

const AUTHORED_SOURCE_HINT = "Author ALS entrypoints as synchronous declarative TypeScript data exports.";

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

  let loadedModule: unknown;
  try {
    const requireFn = require as NodeJS.Require;
    const resolvedPath = requireFn.resolve(fileAbs);
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
