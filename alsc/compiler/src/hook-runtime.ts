import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  buildOperatorConfigSessionStartOutput,
  findAlsSystemRoot,
} from "./operator-config.ts";
import { resolveOwningModuleForPath } from "./module-owner.ts";
import type {
  CompilerDiagnostic,
  DeprecationDiagnosticPayload,
  SystemValidationOutput,
} from "./types.ts";
import { validateSystem } from "./validate.ts";

export const DEFAULT_BREADCRUMB_DIRECTORY = "/tmp";
export const SYSTEM_BREADCRUMB_ID = "__system__";

export interface HookRuntimeContext {
  plugin_root: string;
  breadcrumb_directory?: string;
}

export type HookDecision = "allow" | "block";
export type HookResultStatus = "pass" | "warn" | "fail" | "skip";
export type HookSkipReason =
  | "demo-mode"
  | "missing-input"
  | "outside-als"
  | "not-a-module"
  | "invalid-system"
  | "missing-breadcrumbs"
  | "infrastructure-error";

export interface HookModuleTarget {
  kind: "module";
  system_root: string;
  module_id: string;
}

export interface HookSystemTarget {
  kind: "system";
  system_root: string;
  module_id: null;
}

export type HookTarget = HookModuleTarget | HookSystemTarget;

export interface HookRuntimeResult {
  status: HookResultStatus;
  decision: HookDecision;
  reason: string | null;
  additional_context: string | null;
  skip_reason: HookSkipReason | null;
}

export interface PostEditValidationResult extends HookRuntimeResult {
  target: HookModuleTarget | null;
}

export interface StopGateValidationResult extends HookRuntimeResult {
  breadcrumb_file: string | null;
  cleared_breadcrumbs: boolean;
  targets: HookTarget[];
}

export interface BreadcrumbRecordResult {
  status: "recorded" | "duplicate" | "skip";
  skip_reason: HookSkipReason | null;
  breadcrumb_file: string | null;
  entry: string | null;
  target: HookTarget | null;
}

export interface HookTargetResolution {
  status: "module" | "system" | "not-found" | "invalid-system";
  diagnostic: string | null;
  relative_path: string | null;
  target: HookTarget | null;
}

export interface SessionStartHookInput {
  context?: HookRuntimeContext;
  cwd: string;
}

export interface PostEditValidationInput {
  context?: HookRuntimeContext;
  demo_mode?: boolean;
  file_path: string;
}

export interface BreadcrumbRecordInput {
  context?: HookRuntimeContext;
  file_path: string;
  session_id: string;
}

export interface StopGateValidationInput {
  context?: HookRuntimeContext;
  demo_mode?: boolean;
  session_id: string;
}

interface LocatedPath {
  relative_path: string;
  system_root: string;
}

export function buildOperatorConfigSessionStart(input: SessionStartHookInput): string {
  try {
    return buildOperatorConfigSessionStartOutput(resolve(input.cwd));
  } catch {
    return "";
  }
}

export function resolveTouchedPathTarget(
  filePath: string,
  options: { include_system_files?: boolean } = {},
): HookTargetResolution {
  if (!filePath) {
    return {
      status: "not-found",
      diagnostic: null,
      relative_path: null,
      target: null,
    };
  }

  const locatedPath = locateTouchedPath(filePath);
  if (!locatedPath) {
    return {
      status: "not-found",
      diagnostic: null,
      relative_path: null,
      target: null,
    };
  }

  const moduleResolution = resolveOwningModuleForPath(locatedPath.system_root, locatedPath.relative_path);
  if (moduleResolution.status === "found" && moduleResolution.module_id) {
    return {
      status: "module",
      diagnostic: null,
      relative_path: locatedPath.relative_path,
      target: {
        kind: "module",
        system_root: locatedPath.system_root,
        module_id: moduleResolution.module_id,
      },
    };
  }

  if (options.include_system_files && isSystemOwnedRelativePath(locatedPath.relative_path)) {
    return {
      status: "system",
      diagnostic: null,
      relative_path: locatedPath.relative_path,
      target: {
        kind: "system",
        system_root: locatedPath.system_root,
        module_id: null,
      },
    };
  }

  if (moduleResolution.status === "invalid-system") {
    return {
      status: "invalid-system",
      diagnostic: moduleResolution.diagnostic,
      relative_path: locatedPath.relative_path,
      target: null,
    };
  }

  return {
    status: "not-found",
    diagnostic: null,
    relative_path: locatedPath.relative_path,
    target: null,
  };
}

export function evaluatePostEditValidation(input: PostEditValidationInput): PostEditValidationResult {
  if (input.demo_mode) {
    return buildPostEditSkip("demo-mode");
  }

  if (!input.file_path) {
    return buildPostEditSkip("missing-input");
  }

  const resolution = resolveTouchedPathTarget(input.file_path);
  if (resolution.status === "invalid-system") {
    return buildPostEditSkip("invalid-system");
  }

  if (resolution.status !== "module" || !resolution.target) {
    return buildPostEditSkip("not-a-module");
  }

  try {
    const output = validateSystem(resolution.target.system_root, resolution.target.module_id);
    if (output.status === "fail") {
      return {
        status: "fail",
        decision: "block",
        reason: `ALS validation failed for module '${resolution.target.module_id}'. STOP: fix all errors before making any more edits.`,
        additional_context: JSON.stringify(output, null, 2),
        skip_reason: null,
        target: resolution.target,
      };
    }

    if (output.status === "warn") {
      return {
        status: "warn",
        decision: "allow",
        reason: null,
        additional_context: buildPostEditWarningContext(resolution.target.module_id, output),
        skip_reason: null,
        target: resolution.target,
      };
    }

    return {
      status: "pass",
      decision: "allow",
      reason: null,
      additional_context: null,
      skip_reason: null,
      target: resolution.target,
    };
  } catch {
    return buildPostEditSkip("infrastructure-error");
  }
}

export function recordTouchedPathBreadcrumb(input: BreadcrumbRecordInput): BreadcrumbRecordResult {
  if (!input.file_path || !input.session_id) {
    return {
      status: "skip",
      skip_reason: "missing-input",
      breadcrumb_file: null,
      entry: null,
      target: null,
    };
  }

  const resolution = resolveTouchedPathTarget(input.file_path, { include_system_files: true });
  if ((resolution.status !== "module" && resolution.status !== "system") || !resolution.target) {
    return {
      status: "skip",
      skip_reason: resolution.status === "invalid-system" ? "invalid-system" : "outside-als",
      breadcrumb_file: null,
      entry: null,
      target: null,
    };
  }

  const breadcrumbFile = resolveBreadcrumbFile(input.session_id, input.context);
  const breadcrumbEntry = renderBreadcrumbEntry(resolution.target);

  try {
    const existingEntries = existsSync(breadcrumbFile)
      ? new Set(
        readFileSync(breadcrumbFile, "utf-8")
          .split(/\r?\n/)
          .filter((line) => line.length > 0),
      )
      : new Set<string>();

    if (existingEntries.has(breadcrumbEntry)) {
      return {
        status: "duplicate",
        skip_reason: null,
        breadcrumb_file: breadcrumbFile,
        entry: breadcrumbEntry,
        target: resolution.target,
      };
    }

    appendFileSync(breadcrumbFile, `${breadcrumbEntry}\n`, "utf-8");
    return {
      status: "recorded",
      skip_reason: null,
      breadcrumb_file: breadcrumbFile,
      entry: breadcrumbEntry,
      target: resolution.target,
    };
  } catch {
    return {
      status: "skip",
      skip_reason: "infrastructure-error",
      breadcrumb_file: breadcrumbFile,
      entry: breadcrumbEntry,
      target: resolution.target,
    };
  }
}

export function evaluateStopGateValidation(input: StopGateValidationInput): StopGateValidationResult {
  if (input.demo_mode) {
    return buildStopGateSkip("demo-mode", input);
  }

  if (!input.session_id) {
    return buildStopGateSkip("missing-input", input);
  }

  const breadcrumbFile = resolveBreadcrumbFile(input.session_id, input.context);
  if (!existsSync(breadcrumbFile)) {
    return buildStopGateSkip("missing-breadcrumbs", input, breadcrumbFile);
  }

  const targets = readBreadcrumbTargets(breadcrumbFile);
  if (targets.length === 0) {
    return buildStopGateSkip("missing-breadcrumbs", input, breadcrumbFile);
  }

  const warningContexts: string[] = [];
  let failCount = 0;

  for (const target of targets) {
    let output: SystemValidationOutput;
    try {
      output = target.kind === "system"
        ? validateSystem(target.system_root)
        : validateSystem(target.system_root, target.module_id);
    } catch {
      continue;
    }

    if (output.status === "warn" || output.status === "fail") {
      const warningContext = buildStopWarningContext(target, output);
      if (warningContext.length > 0) {
        warningContexts.push(warningContext);
      }
    }

    if (output.status === "fail") {
      failCount += 1;
    }
  }

  if (failCount === 0) {
    rmSync(breadcrumbFile, { force: true });
    return {
      status: warningContexts.length > 0 ? "warn" : "pass",
      decision: "allow",
      reason: null,
      additional_context: warningContexts.length > 0
        ? `ALS validation finished with non-blocking warnings. Stop is allowed.\n\n${warningContexts.join("\n\n")}`
        : null,
      skip_reason: null,
      breadcrumb_file: breadcrumbFile,
      cleared_breadcrumbs: true,
      targets,
    };
  }

  return {
    status: "fail",
    decision: "block",
    reason: `ALS validation gate: ${failCount} system(s)/module(s) still have errors. Fix all validation errors before finishing.`,
    additional_context: warningContexts.length > 0
      ? `ALS validation gate blocked stop because errors remain.\n\n${warningContexts.join("\n\n")}`
      : null,
    skip_reason: null,
    breadcrumb_file: breadcrumbFile,
    cleared_breadcrumbs: false,
    targets,
  };
}

function buildPostEditSkip(skipReason: HookSkipReason): PostEditValidationResult {
  return {
    status: "skip",
    decision: "allow",
    reason: null,
    additional_context: null,
    skip_reason: skipReason,
    target: null,
  };
}

function buildStopGateSkip(
  skipReason: HookSkipReason,
  input: StopGateValidationInput,
  breadcrumbFile = input.session_id ? resolveBreadcrumbFile(input.session_id, input.context) : null,
): StopGateValidationResult {
  return {
    status: "skip",
    decision: "allow",
    reason: null,
    additional_context: null,
    skip_reason: skipReason,
    breadcrumb_file: breadcrumbFile,
    cleared_breadcrumbs: false,
    targets: [],
  };
}

function locateTouchedPath(filePath: string): LocatedPath | null {
  const absolutePath = resolve(filePath);
  const systemRoot = findAlsSystemRoot(absolutePath);
  if (!systemRoot) {
    return null;
  }

  const relativePath = normalizeRelativePath(systemRoot, absolutePath);
  if (!relativePath) {
    return null;
  }

  return {
    system_root: systemRoot,
    relative_path: relativePath,
  };
}

function normalizeRelativePath(systemRoot: string, absolutePath: string): string | null {
  const relativePath = relative(systemRoot, absolutePath);
  if (relativePath === "") {
    return ".";
  }

  if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    return null;
  }

  return relativePath.replaceAll(sep, "/");
}

function isSystemOwnedRelativePath(relativePath: string): boolean {
  return relativePath === ".als" || relativePath.startsWith(".als/");
}

function buildPostEditWarningContext(moduleId: string, output: SystemValidationOutput): string | null {
  const warningLines = renderWarningLines(output);
  if (warningLines.length === 0) {
    return null;
  }

  return [
    `ALS validation warnings for module "${moduleId}". These warnings do not block further edits.`,
    buildValidationSummaryLine(output),
    ...warningLines,
  ].join("\n");
}

function buildStopWarningContext(target: HookTarget, output: SystemValidationOutput): string {
  const warningLines = renderWarningLines(output);
  if (warningLines.length === 0) {
    return "";
  }

  const targetLabel = target.kind === "system"
    ? `system ${target.system_root}`
    : `module ${target.module_id} in ${target.system_root}`;

  return [
    `ALS validation warnings remain for ${targetLabel}.`,
    buildValidationSummaryLine(output),
    ...warningLines,
  ].join("\n");
}

function buildValidationSummaryLine(output: SystemValidationOutput): string {
  return `Summary: ${output.summary.warning_count} warning(s), ${output.summary.error_count} error(s).`;
}

function renderWarningLines(output: SystemValidationOutput): string[] {
  return collectWarnings(output).map((diagnostic) => {
    const deprecationSuffix = formatDeprecationSuffix(diagnostic.deprecation);
    return `- [${diagnostic.code}] ${diagnostic.message}${deprecationSuffix}`;
  });
}

function collectWarnings(output: SystemValidationOutput): CompilerDiagnostic[] {
  const warnings: CompilerDiagnostic[] = [];

  for (const diagnostic of output.system_diagnostics) {
    if (diagnostic.severity === "warning") {
      warnings.push(diagnostic);
    }
  }

  for (const moduleReport of output.modules) {
    for (const diagnostic of moduleReport.diagnostics) {
      if (diagnostic.severity === "warning") {
        warnings.push(diagnostic);
      }
    }
  }

  return warnings;
}

function formatDeprecationSuffix(deprecation: DeprecationDiagnosticPayload | null): string {
  if (!deprecation) {
    return "";
  }

  const replacementClause = deprecation.replacement
    ? `, replacement: ${deprecation.replacement}`
    : "";

  return ` (contract: ${deprecation.contract}, value: ${deprecation.value}, since: ${deprecation.since}, removed_in: ${deprecation.removed_in}${replacementClause})`;
}

function resolveBreadcrumbFile(sessionId: string, context?: HookRuntimeContext): string {
  const breadcrumbDirectory = context?.breadcrumb_directory ?? DEFAULT_BREADCRUMB_DIRECTORY;
  return join(breadcrumbDirectory, `als-touched-${sessionId}`);
}

function renderBreadcrumbEntry(target: HookTarget): string {
  return target.kind === "system"
    ? `${target.system_root}:${SYSTEM_BREADCRUMB_ID}`
    : `${target.system_root}:${target.module_id}`;
}

function readBreadcrumbTargets(breadcrumbFile: string): HookTarget[] {
  const targetsBySystem = new Map<string, { system: boolean; modules: Set<string> }>();
  const lines = readFileSync(breadcrumbFile, "utf-8")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const separatorIndex = line.lastIndexOf(":");
    if (separatorIndex <= 0 || separatorIndex === line.length - 1) {
      continue;
    }

    const systemRoot = line.slice(0, separatorIndex);
    const moduleId = line.slice(separatorIndex + 1);
    const current = targetsBySystem.get(systemRoot) ?? { system: false, modules: new Set<string>() };

    if (moduleId === SYSTEM_BREADCRUMB_ID) {
      current.system = true;
      current.modules.clear();
      targetsBySystem.set(systemRoot, current);
      continue;
    }

    if (!current.system) {
      current.modules.add(moduleId);
      targetsBySystem.set(systemRoot, current);
    }
  }

  const targets: HookTarget[] = [];
  for (const [systemRoot, state] of targetsBySystem) {
    if (state.system) {
      targets.push({
        kind: "system",
        system_root: systemRoot,
        module_id: null,
      });
      continue;
    }

    for (const moduleId of state.modules) {
      targets.push({
        kind: "module",
        system_root: systemRoot,
        module_id: moduleId,
      });
    }
  }

  return targets;
}
