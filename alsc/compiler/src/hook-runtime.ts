import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

const VALIDATION_STATE_PREFIX = "als-validation-state";
const MODULE_STATE_DIRECTORY = "modules";
const BASELINE_DIRECTORY = "baseline";
const ACTIVE_DIRECTORY = "active";
const BASELINE_COMPLETE_FILE = "baseline.complete";
const STATE_FILE_SUFFIX = ".json";

export interface HookRuntimeContext {
  plugin_root: string;
  breadcrumb_directory?: string;
}

export type HookDecision = "allow" | "block";
export type HookResultStatus = "pass" | "warn" | "fail" | "skip";
export type HookSkipReason =
  | "demo-mode"
  | "missing-input"
  | "missing-session"
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

export type HookValidationClassification = "fresh" | "pre-existing";

export interface HookValidationAdvisoryDiagnostic {
  classification: HookValidationClassification;
  diagnostic: CompilerDiagnostic;
  fingerprint: string;
}

export interface PreEditBaselineResult {
  status: "captured" | "duplicate" | "skip";
  skip_reason: HookSkipReason | null;
  target: HookModuleTarget | null;
  baseline_count: number;
}

export interface PostEditValidationResult extends HookRuntimeResult {
  target: HookModuleTarget | null;
  output: SystemValidationOutput | null;
  surfaced_diagnostics: HookValidationAdvisoryDiagnostic[];
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

export interface PreEditBaselineInput {
  context?: HookRuntimeContext;
  demo_mode?: boolean;
  file_path: string;
  session_id: string;
}

export interface PostEditValidationInput {
  context?: HookRuntimeContext;
  demo_mode?: boolean;
  file_path: string;
  session_id?: string;
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

interface ValidationFingerprintEntry {
  diagnostic: CompilerDiagnostic;
  fingerprint: string;
}

interface ValidationStatePaths {
  module_root: string;
  baseline_directory: string;
  active_directory: string;
  baseline_complete_file: string;
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

export function capturePreEditValidationBaseline(input: PreEditBaselineInput): PreEditBaselineResult {
  if (input.demo_mode) {
    return buildPreEditSkip("demo-mode");
  }

  if (!input.file_path) {
    return buildPreEditSkip("missing-input");
  }

  if (!input.session_id) {
    return buildPreEditSkip("missing-session");
  }

  const resolution = resolveTouchedPathTarget(input.file_path);
  if (resolution.status === "invalid-system") {
    return buildPreEditSkip("invalid-system");
  }

  if (resolution.status !== "module" || !resolution.target) {
    return buildPreEditSkip("not-a-module");
  }

  const target = resolution.target as HookModuleTarget;
  const statePaths = resolveValidationStatePaths(input.session_id, target, input.context);
  if (existsSync(statePaths.baseline_complete_file)) {
    return {
      status: "duplicate",
      skip_reason: null,
      target,
      baseline_count: readMarkerSet(statePaths.baseline_directory).size,
    };
  }

  try {
    const output = validateSystem(target.system_root, target.module_id);
    const diagnostics = collectValidationDiagnostics(output);
    ensureValidationStateDirectories(statePaths);

    for (const entry of diagnostics) {
      writeMarkerFile(
        statePaths.baseline_directory,
        entry.fingerprint,
        JSON.stringify(buildMarkerPayload(entry.diagnostic), null, 2) + "\n",
      );
    }

    writeAtomicFile(statePaths.baseline_complete_file, "");
    return {
      status: "captured",
      skip_reason: null,
      target,
      baseline_count: diagnostics.length,
    };
  } catch {
    return buildPreEditSkip("infrastructure-error");
  }
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

  const target = resolution.target as HookModuleTarget;

  try {
    const output = validateSystem(target.system_root, target.module_id);
    const surfacedDiagnostics = input.session_id
      ? collectSessionScopedAdvisories(input.session_id, target, output, input.context)
      : collectValidationDiagnostics(output).map((entry) => ({
        classification: "fresh" as const,
        diagnostic: entry.diagnostic,
        fingerprint: entry.fingerprint,
      }));

    return {
      status: output.status,
      decision: "allow",
      reason: null,
      additional_context: buildPostEditAdvisoryContext(target.module_id, output, surfacedDiagnostics),
      skip_reason: null,
      target,
      output,
      surfaced_diagnostics: surfacedDiagnostics,
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

  const liveTargets: HookTarget[] = [];
  const warningContexts: string[] = [];
  let failCount = 0;

  for (const target of targets) {
    if (!existsSync(join(target.system_root, ".als", "system.ts"))) {
      continue;
    }

    liveTargets.push(target);

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
      targets: liveTargets,
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
    targets: liveTargets,
  };
}

function buildPreEditSkip(skipReason: HookSkipReason): PreEditBaselineResult {
  return {
    status: "skip",
    skip_reason: skipReason,
    target: null,
    baseline_count: 0,
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
    output: null,
    surfaced_diagnostics: [],
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

function buildPostEditAdvisoryContext(
  moduleId: string,
  output: SystemValidationOutput,
  surfacedDiagnostics: HookValidationAdvisoryDiagnostic[],
): string | null {
  if (surfacedDiagnostics.length === 0) {
    return null;
  }

  const freshCount = surfacedDiagnostics.filter((entry) => entry.classification === "fresh").length;
  const preExistingCount = surfacedDiagnostics.length - freshCount;
  const payload = {
    status: output.status,
    system_path: output.system_path,
    module_filter: output.module_filter,
    current_summary: output.summary,
    advisories: surfacedDiagnostics.map((entry) => ({
      classification: entry.classification,
      diagnostic: entry.diagnostic,
    })),
  };

  return [
    `ALS validation advisory for module "${moduleId}". These diagnostics do not block further edits.`,
    `Surfaced now: ${freshCount} fresh, ${preExistingCount} pre-existing.`,
    buildValidationSummaryLine(output),
    JSON.stringify(payload, null, 2),
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

function collectSessionScopedAdvisories(
  sessionId: string,
  target: HookModuleTarget,
  output: SystemValidationOutput,
  context?: HookRuntimeContext,
): HookValidationAdvisoryDiagnostic[] {
  const diagnostics = collectValidationDiagnostics(output);
  const statePaths = resolveValidationStatePaths(sessionId, target, context);
  const currentFingerprints = new Set(diagnostics.map((entry) => entry.fingerprint));

  pruneMarkers(statePaths.active_directory, currentFingerprints);
  pruneMarkers(statePaths.baseline_directory, currentFingerprints);

  const activeFingerprints = readMarkerSet(statePaths.active_directory);
  const baselineFingerprints = readMarkerSet(statePaths.baseline_directory);
  const surfacedDiagnostics = diagnostics
    .filter((entry) => !activeFingerprints.has(entry.fingerprint))
    .map((entry) => ({
      classification: baselineFingerprints.has(entry.fingerprint) ? "pre-existing" as const : "fresh" as const,
      diagnostic: entry.diagnostic,
      fingerprint: entry.fingerprint,
    }));

  if (surfacedDiagnostics.length === 0) {
    return [];
  }

  ensureValidationStateDirectories(statePaths);
  for (const entry of surfacedDiagnostics) {
    writeMarkerFile(
      statePaths.active_directory,
      entry.fingerprint,
      JSON.stringify({
        ...buildMarkerPayload(entry.diagnostic),
        classification: entry.classification,
      }, null, 2) + "\n",
    );
  }

  return surfacedDiagnostics;
}

function collectValidationDiagnostics(output: SystemValidationOutput): ValidationFingerprintEntry[] {
  const diagnostics: ValidationFingerprintEntry[] = [];
  const seenFingerprints = new Set<string>();

  const pushDiagnostic = (diagnostic: CompilerDiagnostic) => {
    const fingerprint = fingerprintDiagnostic(diagnostic);
    if (seenFingerprints.has(fingerprint)) {
      return;
    }

    seenFingerprints.add(fingerprint);
    diagnostics.push({
      diagnostic,
      fingerprint,
    });
  };

  for (const diagnostic of output.system_diagnostics) {
    pushDiagnostic(diagnostic);
  }

  for (const moduleReport of output.modules) {
    for (const diagnostic of moduleReport.diagnostics) {
      pushDiagnostic(diagnostic);
    }
  }

  return diagnostics;
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

function resolveValidationStatePaths(
  sessionId: string,
  target: HookModuleTarget,
  context?: HookRuntimeContext,
): ValidationStatePaths {
  const breadcrumbDirectory = context?.breadcrumb_directory ?? DEFAULT_BREADCRUMB_DIRECTORY;
  const sessionRoot = join(breadcrumbDirectory, `${VALIDATION_STATE_PREFIX}-${sessionId}`);
  const moduleRoot = join(
    sessionRoot,
    MODULE_STATE_DIRECTORY,
    buildModuleStateDirectoryName(target),
  );

  return {
    module_root: moduleRoot,
    baseline_directory: join(moduleRoot, BASELINE_DIRECTORY),
    active_directory: join(moduleRoot, ACTIVE_DIRECTORY),
    baseline_complete_file: join(moduleRoot, BASELINE_COMPLETE_FILE),
  };
}

function buildModuleStateDirectoryName(target: HookModuleTarget): string {
  const identity = `${target.system_root}\u0000${target.module_id}`;
  const digest = createHash("sha256").update(identity).digest("hex");
  return `${target.module_id}-${digest}`;
}

function ensureValidationStateDirectories(paths: ValidationStatePaths): void {
  mkdirSync(paths.module_root, { recursive: true });
  mkdirSync(paths.baseline_directory, { recursive: true });
  mkdirSync(paths.active_directory, { recursive: true });
}

function readMarkerSet(directory: string): Set<string> {
  if (!existsSync(directory)) {
    return new Set<string>();
  }

  try {
    return new Set(
      readdirSync(directory)
        .filter((entry) => entry.endsWith(STATE_FILE_SUFFIX))
        .map((entry) => entry.slice(0, -STATE_FILE_SUFFIX.length)),
    );
  } catch {
    return new Set<string>();
  }
}

function pruneMarkers(directory: string, currentFingerprints: Set<string>): void {
  if (!existsSync(directory)) {
    return;
  }

  try {
    for (const entry of readdirSync(directory)) {
      if (!entry.endsWith(STATE_FILE_SUFFIX)) {
        continue;
      }

      const fingerprint = entry.slice(0, -STATE_FILE_SUFFIX.length);
      if (currentFingerprints.has(fingerprint)) {
        continue;
      }

      rmSync(join(directory, entry), { force: true });
    }
  } catch {
    return;
  }
}

function writeMarkerFile(directory: string, fingerprint: string, contents: string): void {
  mkdirSync(directory, { recursive: true });
  writeAtomicFile(join(directory, `${fingerprint}${STATE_FILE_SUFFIX}`), contents);
}

function writeAtomicFile(filePath: string, contents: string): void {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tempPath, contents, "utf-8");
  renameSync(tempPath, filePath);
}

function buildMarkerPayload(diagnostic: CompilerDiagnostic): Record<string, unknown> {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    file: diagnostic.file,
    line: diagnostic.location.line,
    column: diagnostic.location.column,
    module_id: diagnostic.module_id,
    entity: diagnostic.entity,
    field: diagnostic.field,
    message: diagnostic.message,
  };
}

function fingerprintDiagnostic(diagnostic: CompilerDiagnostic): string {
  return createHash("sha256").update(stableSerialize({
    severity: diagnostic.severity,
    code: diagnostic.code,
    reason: diagnostic.reason,
    phase: diagnostic.phase,
    file: diagnostic.file,
    location: diagnostic.location,
    module_id: diagnostic.module_id,
    entity: diagnostic.entity,
    field: diagnostic.field,
    message: diagnostic.message,
    expected: diagnostic.expected,
    actual: diagnostic.actual,
    hint: diagnostic.hint,
    deprecation: diagnostic.deprecation,
  })).digest("hex");
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`);
  return `{${entries.join(",")}}`;
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
