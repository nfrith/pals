import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import { z } from "zod";
import {
  CONSTRUCT_ACTION_KINDS,
  CONSTRUCT_ACTION_MANIFEST_SCHEMA_LITERAL,
  CONSTRUCT_DRAIN_SIGNAL_KINDS,
  CONSTRUCT_LIFECYCLE_STRATEGIES,
  CONSTRUCT_MANIFEST_SCHEMA_LITERAL,
  CONSTRUCT_MIGRATION_STRATEGIES,
  CONSTRUCT_OPERATOR_PROMPT_INTENTS,
  CONSTRUCT_PROCESS_LOCATOR_KINDS,
  CONSTRUCT_RUNTIME_PATH_PLACEHOLDERS,
  CONSTRUCT_SOURCE_PATH_OWNERS,
  type ConstructActionKind,
  type ConstructLifecycleStrategyName,
  type ConstructMigrationStrategyName,
  type ConstructOperatorPromptIntent,
} from "./construct-contracts.ts";
import { inspectSequentialMigrationDirectoryEntries } from "./sequential-migration-validation.ts";

const nonEmptyString = z.string().trim().min(1, "must be a non-empty string");
const positiveInt = z.number().int().positive("must be a positive integer");

const sourcePathSchema = z.object({
  path: nonEmptyString,
  owner: z.enum(CONSTRUCT_SOURCE_PATH_OWNERS),
}).strict();

const rawConstructManifestSchema = z.object({
  schema: z.string(),
  name: nonEmptyString,
  version: positiveInt,
  migration_strategy: z.enum(CONSTRUCT_MIGRATION_STRATEGIES),
  lifecycle_strategy: z.enum(CONSTRUCT_LIFECYCLE_STRATEGIES),
  migrations_dir: nonEmptyString,
  source_paths: z.array(sourcePathSchema).min(1),
}).strict();

const startContractSchema = z.object({
  command: z.array(nonEmptyString).min(1),
  cwd: nonEmptyString,
}).strict();

const jsonFilePidLocatorSchema = z.object({
  kind: z.literal("json-file-pid"),
  path: nonEmptyString,
  pid_field: nonEmptyString,
}).strict();

const argvSubstringLocatorSchema = z.object({
  kind: z.literal("argv-substring"),
  argv_contains: z.array(nonEmptyString).min(1),
}).strict();

const drainSignalSchema = z.object({
  kind: z.literal("json-file-write"),
  path: nonEmptyString,
  payload: z.record(z.string(), z.unknown()),
}).strict();

const rawActionSchema = z.object({
  kind: z.enum(CONSTRUCT_ACTION_KINDS),
  construct: nonEmptyString,
  instance_id: nonEmptyString,
  display_name: nonEmptyString,
  start: startContractSchema,
  process_locator: z.union([jsonFilePidLocatorSchema, argvSubstringLocatorSchema]).optional(),
  drain_signal: drainSignalSchema.optional(),
}).strict();

const rawActionManifestSchema = z.object({
  schema: z.string(),
  actions: z.array(rawActionSchema),
}).strict();

export interface ConstructUpgradeInspectionIssue {
  code: string;
  path: string;
  message: string;
  expected: unknown;
  actual: unknown;
}

export interface ConstructManifestSourcePath {
  path: string;
  owner: "vendor" | "operator";
}

export interface ConstructManifest {
  schema: typeof CONSTRUCT_MANIFEST_SCHEMA_LITERAL;
  name: string;
  version: number;
  migration_strategy: ConstructMigrationStrategyName;
  lifecycle_strategy: ConstructLifecycleStrategyName;
  migrations_dir: string;
  source_paths: ConstructManifestSourcePath[];
}

export interface ConstructManifestInspectionOutput {
  status: "pass" | "fail";
  manifest_path: string;
  bundle_root: string;
  exists: boolean;
  errors: ConstructUpgradeInspectionIssue[];
  warnings: ConstructUpgradeInspectionIssue[];
  manifest: ConstructManifest | null;
}

export interface ConstructActionStartContract {
  command: string[];
  cwd: string;
}

export interface ConstructActionJsonFilePidLocator {
  kind: "json-file-pid";
  path: string;
  pid_field: string;
}

export interface ConstructActionArgvSubstringLocator {
  kind: "argv-substring";
  argv_contains: string[];
}

export type ConstructActionProcessLocator =
  | ConstructActionJsonFilePidLocator
  | ConstructActionArgvSubstringLocator;

export interface ConstructActionDrainSignal {
  kind: "json-file-write";
  path: string;
  payload: Record<string, unknown>;
}

export interface ConstructAction {
  kind: ConstructActionKind;
  construct: string;
  instance_id: string;
  display_name: string;
  start: ConstructActionStartContract;
  process_locator?: ConstructActionProcessLocator;
  drain_signal?: ConstructActionDrainSignal;
}

export interface ConstructActionManifest {
  schema: typeof CONSTRUCT_ACTION_MANIFEST_SCHEMA_LITERAL;
  actions: ConstructAction[];
}

export interface ConstructActionManifestInspectionOutput {
  status: "pass" | "fail";
  manifest_path: string;
  exists: boolean;
  errors: ConstructUpgradeInspectionIssue[];
  warnings: ConstructUpgradeInspectionIssue[];
  manifest: ConstructActionManifest | null;
  action_count: number;
}

type RawConstructManifest = z.infer<typeof rawConstructManifestSchema>;
type RawConstructActionManifest = z.infer<typeof rawActionManifestSchema>;

export function resolveConstructManifestPath(inputPath = process.cwd()): string {
  const candidate = resolve(inputPath);
  return basename(candidate) === "construct.json"
    ? candidate
    : resolve(candidate, "construct.json");
}

export function inspectConstructManifest(inputPath = process.cwd()): ConstructManifestInspectionOutput {
  const manifestPath = resolveConstructManifestPath(inputPath);
  const bundleRoot = resolve(manifestPath, "..");

  if (!existsSync(manifestPath)) {
    return buildManifestFailure(manifestPath, bundleRoot, [
      issue(
        "construct_manifest.path.missing",
        "manifest_path",
        "Construct manifest must resolve to an existing construct.json file.",
        "existing construct.json file",
        manifestPath,
      ),
    ]);
  }

  try {
    if (!statSync(manifestPath).isFile()) {
      return buildManifestFailure(manifestPath, bundleRoot, [
        issue(
          "construct_manifest.path.not_file",
          "manifest_path",
          "Construct manifest path must resolve to a file.",
          "file",
          "directory",
        ),
      ]);
    }
  } catch (error) {
    return buildManifestFailure(manifestPath, bundleRoot, [
      issue(
        "construct_manifest.path.unreadable",
        "manifest_path",
        `Could not stat construct manifest: ${formatError(error)}`,
        "readable file",
        null,
      ),
    ]);
  }

  const rawSource = readUtf8File(manifestPath, bundleRoot, "construct_manifest.read.failed");
  if (!rawSource.ok) {
    return rawSource.result;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawSource.contents);
  } catch (error) {
    return buildManifestFailure(manifestPath, bundleRoot, [
      issue(
        "construct_manifest.parse.failed",
        "construct",
        `Failed to parse construct manifest JSON: ${formatError(error)}`,
        "valid JSON object",
        null,
      ),
    ]);
  }

  const parsed = rawConstructManifestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return buildManifestFailure(
      manifestPath,
      bundleRoot,
      parsed.error.issues.map((entry) => issue(
        "construct_manifest.shape.invalid",
        renderZodPath(entry.path),
        entry.message,
        null,
        null,
      )),
    );
  }

  const errors: ConstructUpgradeInspectionIssue[] = [];
  const warnings: ConstructUpgradeInspectionIssue[] = [];
  validateSupportedConstructSchema(parsed.data.schema, errors);
  validateConstructVersionParity(bundleRoot, parsed.data.version, errors);
  validateRelativeBundlePath(bundleRoot, parsed.data.migrations_dir, "migrations_dir", errors);
  validateMigrationsDirectory(
    bundleRoot,
    parsed.data.migration_strategy,
    parsed.data.migrations_dir,
    parsed.data.version,
    errors,
  );
  validateSourcePaths(bundleRoot, parsed.data.source_paths, errors);

  return finalizeManifestInspection(manifestPath, bundleRoot, errors, warnings, {
    schema: CONSTRUCT_MANIFEST_SCHEMA_LITERAL,
    name: parsed.data.name,
    version: parsed.data.version,
    migration_strategy: parsed.data.migration_strategy,
    lifecycle_strategy: parsed.data.lifecycle_strategy,
    migrations_dir: parsed.data.migrations_dir,
    source_paths: parsed.data.source_paths,
  });
}

export function resolveConstructActionManifestPath(inputPath = process.cwd()): string {
  const candidate = resolve(inputPath);
  return basename(candidate) === "action-manifest.json"
    ? candidate
    : resolve(candidate, "action-manifest.json");
}

export function inspectConstructActionManifest(inputPath = process.cwd()): ConstructActionManifestInspectionOutput {
  const manifestPath = resolveConstructActionManifestPath(inputPath);

  if (!existsSync(manifestPath)) {
    return buildActionManifestFailure(manifestPath, [
      issue(
        "construct_action_manifest.path.missing",
        "manifest_path",
        "Construct action manifest must resolve to an existing action-manifest.json file.",
        "existing action-manifest.json file",
        manifestPath,
      ),
    ]);
  }

  try {
    if (!statSync(manifestPath).isFile()) {
      return buildActionManifestFailure(manifestPath, [
        issue(
          "construct_action_manifest.path.not_file",
          "manifest_path",
          "Construct action manifest path must resolve to a file.",
          "file",
          "directory",
        ),
      ]);
    }
  } catch (error) {
    return buildActionManifestFailure(manifestPath, [
      issue(
        "construct_action_manifest.path.unreadable",
        "manifest_path",
        `Could not stat construct action manifest: ${formatError(error)}`,
        "readable file",
        null,
      ),
    ]);
  }

  const rawSource = readUtf8File(manifestPath, resolve(manifestPath, ".."), "construct_action_manifest.read.failed");
  if (!rawSource.ok) {
    return rawSource.result;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawSource.contents);
  } catch (error) {
    return buildActionManifestFailure(manifestPath, [
      issue(
        "construct_action_manifest.parse.failed",
        "manifest",
        `Failed to parse construct action manifest JSON: ${formatError(error)}`,
        "valid JSON object",
        null,
      ),
    ]);
  }

  const parsed = rawActionManifestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return buildActionManifestFailure(
      manifestPath,
      parsed.error.issues.map((entry) => issue(
        "construct_action_manifest.shape.invalid",
        renderZodPath(entry.path),
        entry.message,
        null,
        null,
      )),
    );
  }

  const errors: ConstructUpgradeInspectionIssue[] = [];
  const warnings: ConstructUpgradeInspectionIssue[] = [];
  validateSupportedActionManifestSchema(parsed.data.schema, errors);
  parsed.data.actions.forEach((action, index) => validateAction(action, index, errors));

  return finalizeActionManifestInspection(manifestPath, errors, warnings, {
    schema: CONSTRUCT_ACTION_MANIFEST_SCHEMA_LITERAL,
    actions: parsed.data.actions,
  });
}

export function isConstructOperatorPromptIntent(
  value: unknown,
): value is ConstructOperatorPromptIntent {
  return typeof value === "string" && CONSTRUCT_OPERATOR_PROMPT_INTENTS.includes(value as ConstructOperatorPromptIntent);
}

function readUtf8File(
  path: string,
  bundleRoot: string,
  errorCode: string,
):
  | { ok: true; contents: string }
  | { ok: false; result: ConstructManifestInspectionOutput | ConstructActionManifestInspectionOutput } {
  try {
    return {
      ok: true,
      contents: readFileSync(path, "utf-8"),
    };
  } catch (error) {
    const result = errorCode.startsWith("construct_manifest")
      ? buildManifestFailure(path, bundleRoot, [
        issue(
          errorCode,
          "manifest_path",
          `Could not read manifest file: ${formatError(error)}`,
          "readable UTF-8 file",
          null,
        ),
      ])
      : buildActionManifestFailure(path, [
        issue(
          errorCode,
          "manifest_path",
          `Could not read manifest file: ${formatError(error)}`,
          "readable UTF-8 file",
          null,
        ),
      ]);
    return { ok: false, result };
  }
}

function validateSupportedConstructSchema(
  schema: string,
  errors: ConstructUpgradeInspectionIssue[],
): void {
  if (schema !== CONSTRUCT_MANIFEST_SCHEMA_LITERAL) {
    errors.push(issue(
      "construct_manifest.schema.unsupported",
      "schema",
      `Unsupported construct manifest schema '${schema}'.`,
      CONSTRUCT_MANIFEST_SCHEMA_LITERAL,
      schema,
    ));
  }
}

function validateSupportedActionManifestSchema(
  schema: string,
  errors: ConstructUpgradeInspectionIssue[],
): void {
  if (schema !== CONSTRUCT_ACTION_MANIFEST_SCHEMA_LITERAL) {
    errors.push(issue(
      "construct_action_manifest.schema.unsupported",
      "schema",
      `Unsupported construct action manifest schema '${schema}'.`,
      CONSTRUCT_ACTION_MANIFEST_SCHEMA_LITERAL,
      schema,
    ));
  }
}

function validateConstructVersionParity(
  bundleRoot: string,
  manifestVersion: number,
  errors: ConstructUpgradeInspectionIssue[],
): void {
  const versionPath = resolve(bundleRoot, "VERSION");
  if (!existsSync(versionPath)) {
    errors.push(issue(
      "construct_manifest.version_file.missing",
      "version",
      "Construct manifest requires a sibling VERSION file.",
      "existing VERSION file",
      versionPath,
    ));
    return;
  }

  let rawVersion: string;
  try {
    rawVersion = readFileSync(versionPath, "utf-8");
  } catch (error) {
    errors.push(issue(
      "construct_manifest.version_file.unreadable",
      "version",
      `Could not read VERSION file: ${formatError(error)}`,
      "readable VERSION file",
      null,
    ));
    return;
  }

  if (!/^[1-9][0-9]*\s*$/.test(rawVersion)) {
    errors.push(issue(
      "construct_manifest.version_file.invalid",
      "version",
      "VERSION file must contain a positive integer.",
      "positive integer",
      rawVersion.trim(),
    ));
    return;
  }

  const version = Number(rawVersion.trim());
  if (version !== manifestVersion) {
    errors.push(issue(
      "construct_manifest.version.mismatch",
      "version",
      "Construct manifest version must match the sibling VERSION file exactly.",
      version,
      manifestVersion,
    ));
  }
}

function validateMigrationsDirectory(
  bundleRoot: string,
  migrationStrategy: ConstructMigrationStrategyName,
  migrationsDir: string,
  manifestVersion: number,
  errors: ConstructUpgradeInspectionIssue[],
): void {
  const target = resolve(bundleRoot, migrationsDir);
  if (!existsSync(target)) {
    errors.push(issue(
      "construct_manifest.migrations_dir.missing",
      "migrations_dir",
      "Construct manifest migrations_dir must resolve to an existing directory.",
      "existing directory",
      target,
    ));
    return;
  }

  try {
    if (!statSync(target).isDirectory()) {
      errors.push(issue(
        "construct_manifest.migrations_dir.not_directory",
        "migrations_dir",
        "Construct manifest migrations_dir must resolve to a directory.",
        "directory",
        "file",
      ));
      return;
    }
  } catch (error) {
    errors.push(issue(
      "construct_manifest.migrations_dir.unreadable",
      "migrations_dir",
      `Could not stat migrations_dir: ${formatError(error)}`,
      "readable directory",
      null,
    ));
    return;
  }

  if (migrationStrategy !== "sequential") {
    return;
  }

  try {
    const inspection = inspectSequentialMigrationDirectoryEntries({
      entries: readdirSync(target),
      migrations_dir: target,
      target_version: manifestVersion,
      path_root: "migrations_dir",
    });
    errors.push(...inspection.issues);
  } catch (error) {
    errors.push(issue(
      "construct_manifest.migrations_dir.unreadable",
      "migrations_dir",
      `Could not read migrations_dir: ${formatError(error)}`,
      "readable directory",
      null,
    ));
  }
}

function validateSourcePaths(
  bundleRoot: string,
  sourcePaths: RawConstructManifest["source_paths"],
  errors: ConstructUpgradeInspectionIssue[],
): void {
  const seenPaths = new Set<string>();
  sourcePaths.forEach((sourcePath, index) => {
    const fieldPath = `source_paths.${index}.path`;
    if (seenPaths.has(sourcePath.path)) {
      errors.push(issue(
        "construct_manifest.source_path.duplicate",
        fieldPath,
        "Construct source_paths must not contain duplicate paths.",
        "unique path",
        sourcePath.path,
      ));
    }
    seenPaths.add(sourcePath.path);
    validateRelativeBundlePath(bundleRoot, sourcePath.path, fieldPath, errors);
  });
}

function validateRelativeBundlePath(
  bundleRoot: string,
  candidatePath: string,
  pathField: string,
  errors: ConstructUpgradeInspectionIssue[],
): void {
  const resolved = resolve(bundleRoot, candidatePath);
  const rel = relative(bundleRoot, resolved);
  if (
    rel === ""
    || rel === "."
    || rel.startsWith(`..${sep}`)
    || rel === ".."
    || candidatePath.startsWith("/")
  ) {
    errors.push(issue(
      "construct_manifest.path.escapes_bundle",
      pathField,
      "Construct bundle paths must stay inside the construct bundle root.",
      "relative in-bundle path",
      candidatePath,
    ));
  }
}

function validateAction(
  action: RawConstructActionManifest["actions"][number],
  index: number,
  errors: ConstructUpgradeInspectionIssue[],
): void {
  const basePath = `actions.${index}`;
  validateStartCommand(action.start.command, `${basePath}.start.command`, errors);
  validateRuntimePathToken(action.start.cwd, `${basePath}.start.cwd`, errors);

  if (action.kind === "drain-then-restart") {
    if (!action.process_locator) {
      errors.push(issue(
        "construct_action.process_locator.required",
        `${basePath}.process_locator`,
        "drain-then-restart actions require a process_locator.",
        "process_locator object",
        null,
      ));
    }
    if (!action.drain_signal) {
      errors.push(issue(
        "construct_action.drain_signal.required",
        `${basePath}.drain_signal`,
        "drain-then-restart actions require a drain_signal.",
        "drain_signal object",
        null,
      ));
    }
  }

  if (action.kind === "kill-then-restart") {
    if (!action.process_locator) {
      errors.push(issue(
        "construct_action.process_locator.required",
        `${basePath}.process_locator`,
        "kill-then-restart actions require a process_locator.",
        "process_locator object",
        null,
      ));
    }
    if (action.drain_signal) {
      errors.push(issue(
        "construct_action.drain_signal.forbidden",
        `${basePath}.drain_signal`,
        "kill-then-restart actions must not declare a drain_signal.",
        null,
        action.drain_signal.kind,
      ));
    }
  }

  if (action.kind === "start-only") {
    if (action.process_locator) {
      errors.push(issue(
        "construct_action.process_locator.forbidden",
        `${basePath}.process_locator`,
        "start-only actions must not declare a process_locator.",
        null,
        action.process_locator.kind,
      ));
    }
    if (action.drain_signal) {
      errors.push(issue(
        "construct_action.drain_signal.forbidden",
        `${basePath}.drain_signal`,
        "start-only actions must not declare a drain_signal.",
        null,
        action.drain_signal.kind,
      ));
    }
  }

  if (action.process_locator?.kind === "json-file-pid") {
    validateRuntimePathToken(action.process_locator.path, `${basePath}.process_locator.path`, errors);
  }

  if (action.drain_signal?.kind === "json-file-write") {
    validateRuntimePathToken(action.drain_signal.path, `${basePath}.drain_signal.path`, errors);
  }
}

function validateStartCommand(
  command: string[],
  pathField: string,
  errors: ConstructUpgradeInspectionIssue[],
): void {
  command.forEach((part, index) => {
    if (isPathBearingCommandPart(part)) {
      validateRuntimePathToken(part, `${pathField}.${index}`, errors);
    }
  });
}

function validateRuntimePathToken(
  value: string,
  pathField: string,
  errors: ConstructUpgradeInspectionIssue[],
): void {
  if (value.startsWith("/")) {
    errors.push(issue(
      "construct_action.path.absolute_forbidden",
      pathField,
      "Construct action paths must use runtime placeholders, not absolute paths.",
      CONSTRUCT_RUNTIME_PATH_PLACEHOLDERS,
      value,
    ));
    return;
  }

  const placeholder = CONSTRUCT_RUNTIME_PATH_PLACEHOLDERS.find((entry) => value.startsWith(entry));
  if (!placeholder) {
    errors.push(issue(
      "construct_action.path.placeholder_required",
      pathField,
      "Construct action paths must start with $ALS_SYSTEM_ROOT or $CLAUDE_PLUGIN_ROOT.",
      CONSTRUCT_RUNTIME_PATH_PLACEHOLDERS,
      value,
    ));
    return;
  }

  if (value.includes("$") && !value.startsWith(placeholder)) {
    errors.push(issue(
      "construct_action.path.placeholder_invalid",
      pathField,
      "Construct action paths may only use approved runtime placeholders.",
      CONSTRUCT_RUNTIME_PATH_PLACEHOLDERS,
      value,
    ));
  }
}

function isPathBearingCommandPart(value: string): boolean {
  return value.startsWith("$")
    || value.startsWith(".")
    || value.includes("/");
}

function buildManifestFailure(
  manifestPath: string,
  bundleRoot: string,
  errors: ConstructUpgradeInspectionIssue[],
): ConstructManifestInspectionOutput {
  return {
    status: "fail",
    manifest_path: manifestPath,
    bundle_root: bundleRoot,
    exists: existsSync(manifestPath),
    errors,
    warnings: [],
    manifest: null,
  };
}

function finalizeManifestInspection(
  manifestPath: string,
  bundleRoot: string,
  errors: ConstructUpgradeInspectionIssue[],
  warnings: ConstructUpgradeInspectionIssue[],
  manifest: ConstructManifest,
): ConstructManifestInspectionOutput {
  return {
    status: errors.length === 0 ? "pass" : "fail",
    manifest_path: manifestPath,
    bundle_root: bundleRoot,
    exists: true,
    errors,
    warnings,
    manifest: errors.length === 0 ? manifest : null,
  };
}

function buildActionManifestFailure(
  manifestPath: string,
  errors: ConstructUpgradeInspectionIssue[],
): ConstructActionManifestInspectionOutput {
  return {
    status: "fail",
    manifest_path: manifestPath,
    exists: existsSync(manifestPath),
    errors,
    warnings: [],
    manifest: null,
    action_count: 0,
  };
}

function finalizeActionManifestInspection(
  manifestPath: string,
  errors: ConstructUpgradeInspectionIssue[],
  warnings: ConstructUpgradeInspectionIssue[],
  manifest: ConstructActionManifest,
): ConstructActionManifestInspectionOutput {
  return {
    status: errors.length === 0 ? "pass" : "fail",
    manifest_path: manifestPath,
    exists: true,
    errors,
    warnings,
    manifest: errors.length === 0 ? manifest : null,
    action_count: manifest.actions.length,
  };
}

function issue(
  code: string,
  path: string,
  message: string,
  expected: unknown,
  actual: unknown,
): ConstructUpgradeInspectionIssue {
  return {
    code,
    path,
    message,
    expected,
    actual,
  };
}

function renderZodPath(path: Array<string | number>): string {
  if (path.length === 0) {
    return "manifest";
  }

  return path.map((part) => String(part)).join(".");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
