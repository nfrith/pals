import { basename, dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { readFileSync, readdirSync, statSync, type Dirent } from "node:fs";
import matter from "gray-matter";
import { ZodError } from "zod";
import { loadAuthoredSourceExport } from "./authored-load.ts";
import {
  ALS_UPGRADE_ASSISTANCE,
  ALS_UPGRADE_MODE,
  SUPPORTED_ALS_VERSIONS,
  VALIDATION_OUTPUT_SCHEMA_LITERAL,
  isSupportedAlsVersion,
} from "./contracts.ts";
import { codes, computeStatus, diag, reasons } from "./diagnostics.ts";
import {
  MarkdownProcessingError,
  parseBody,
  validateBodyMarkdownSurface,
  validateRegionMarkdown,
  validateSectionMarkdown,
  type ParsedBody,
} from "./markdown.ts";
import { parsePathTemplate, matchPath, type ParsedPathTemplate } from "./parser/path-template.ts";
import { parseRefUri, refTargetEntity } from "./refs.ts";
import {
  type BodyRegionShape,
  findLegacyRequiredIssues,
  type JsonlEntityShape,
  type JsonlRowFieldShape,
  isPathPrefix,
  type MarkdownEntityShape,
  moduleShapeSchema,
  modulePathsOverlap,
  splitModuleMountPath,
  SYSTEM_MODULE_DESCRIPTION_MAX_LENGTH,
  systemConfigSchema,
  type EntityShape,
  type FilePathBase,
  type FieldShape,
  type ModuleShape,
  type SectionDefinitionShape,
  type SectionShape,
  type TitleShape,
  type SystemConfig,
  type VariantEntityShape,
} from "./schema.ts";
import {
  collectDelamainSessionFields,
  type DelamainAgentProvider,
  delamainShapeSchema,
  type DelamainShape,
  validateDelamainDefinition,
} from "./delamain.ts";
import {
  inferredMigrationsPath,
  inferredModuleBundlePath,
  inferredModuleEntryPath,
  inferredSystemPath,
  inferredSkillEntryPath,
  inferredSkillsPath,
  toRepoRelative,
} from "./system-paths.ts";
import type { CompilerDiagnostic, ModuleValidationReport, ModuleValidationSummary, SystemValidationOutput } from "./types.ts";

interface LoadedModuleContext {
  system_id: string;
  system_root_abs: string;
  module_id: string;
  module_bundle_abs: string;
  module_bundle_rel: string;
  module_path_abs: string;
  module_path_rel: string;
  shape_path_abs: string;
  shape_path_rel: string;
  module_version: number;
  shape: ModuleShape;
  delamains: Map<string, LoadedDelamainBundle>;
  templates: Map<string, ParsedPathTemplate>;
}

interface LoadedDelamainBundle {
  name: string;
  primary_path_abs: string;
  primary_path_rel: string;
  bundle_root_abs: string;
  shape: DelamainShape;
  session_fields: string[];
}

interface ParsedRecord {
  source_format: "markdown" | "jsonl";
  module_id: string;
  file_abs: string;
  file_rel: string;
  file_rel_within_module: string;
  entity_name: string;
  entity_shape: EntityShape;
  frontmatter: Record<string, unknown> | null;
  body: ParsedBody | null;
  rows: JsonlRow[] | null;
  bindings: Map<string, string>;
  canonical_uri: string | null;
}

interface ModuleWorkState {
  module_id: string;
  module_path_rel: string;
  module_version: number;
  diagnostics: CompilerDiagnostic[];
  files_checked: number;
  files_ignored: number;
  file_error_map: Map<string, boolean>;
  parsed_records: ParsedRecord[];
  context: LoadedModuleContext | null;
}

interface JsonlRow {
  line_number: number;
  value: Record<string, unknown>;
}

interface RecordDiscoveryResult {
  record_file_paths: string[];
  errored_file_paths: string[];
  ignored_file_paths: string[];
  diagnostics: CompilerDiagnostic[];
}

export interface EffectiveEntityContract {
  fields: Record<string, FieldShape>;
  known_field_names: string[];
  body: EffectiveBodyContract | null;
  diagnostics: CompilerDiagnostic[];
  body_diagnostics: CompilerDiagnostic[];
}

interface EffectiveBodyContract {
  title?: TitleShape;
  preamble?: BodyRegionShape;
  sections: SectionShape[];
}

class FrontmatterProcessingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FrontmatterProcessingError";
  }
}

type RenderedTitleExpectation =
  | { kind: "authored" }
  | { kind: "expected"; value: string }
  | { kind: "invalid_source"; field: string; actual: unknown };

interface FilePathContractShape {
  base: FilePathBase;
}

type SafeStatResult =
  | { kind: "ok"; stat: ReturnType<typeof statSync> }
  | { kind: "missing" }
  | { kind: "unreadable"; error: NodeJS.ErrnoException };

export interface EffectiveEntityContractContext {
  module_id: string;
  entity_name: string;
  record_file: string;
  shape_file: string;
}

export interface LoadedSystemValidationContext {
  system_root_abs: string;
  system_root_rel: string;
  system_config_path_abs: string;
  system_config: SystemConfig | null;
  als_version: number | null;
  initial_diagnostics: CompilerDiagnostic[];
}

export function validateSystem(systemRootInput: string, moduleFilter?: string): SystemValidationOutput {
  return validateLoadedSystem(loadSystemValidationContext(systemRootInput), moduleFilter);
}

export function loadSystemValidationContext(systemRootInput: string): LoadedSystemValidationContext {
  const systemRootAbs = resolve(systemRootInput);
  const systemRootRel = toRepoRelative(systemRootAbs);
  const systemConfigPathAbs = resolve(systemRootAbs, inferredSystemPath());
  const parsedSystem = parseAuthoredSourceFile<SystemConfig>(
    systemConfigPathAbs,
    "system",
    systemConfigSchema,
    "system_config",
    codes.SYSTEM_INVALID,
    null,
  );

  if (!parsedSystem.success) {
    return {
      system_root_abs: systemRootAbs,
      system_root_rel: systemRootRel,
      system_config_path_abs: systemConfigPathAbs,
      system_config: null,
      als_version: null,
      initial_diagnostics: parsedSystem.diagnostics,
    };
  }

  const systemConfig = parsedSystem.data;
  const alsVersionDiagnostics = validateAlsVersionSupport(systemConfig, systemConfigPathAbs);
  return {
    system_root_abs: systemRootAbs,
    system_root_rel: systemRootRel,
    system_config_path_abs: systemConfigPathAbs,
    system_config: systemConfig,
    als_version: systemConfig.als_version,
    initial_diagnostics: alsVersionDiagnostics,
  };
}

export function validateLoadedSystem(
  context: LoadedSystemValidationContext,
  moduleFilter?: string,
): SystemValidationOutput {
  const systemDiagnostics: CompilerDiagnostic[] = [...context.initial_diagnostics];
  const moduleReports: ModuleValidationReport[] = [];
  const outputModuleFilter = moduleFilter ?? null;

  if (!context.system_config || systemDiagnostics.length > 0) {
    return buildSystemOutput(context.system_root_rel, systemDiagnostics, moduleReports, context.als_version, outputModuleFilter);
  }

  const systemConfig = context.system_config;

  const reportingModuleIds = getSelectedModuleIds(systemConfig, moduleFilter, context.system_config_path_abs, systemDiagnostics);
  if (reportingModuleIds.length === 0) {
    return buildSystemOutput(context.system_root_rel, systemDiagnostics, moduleReports, systemConfig.als_version, outputModuleFilter);
  }

  const layoutDiagnostics = validateSystemLayout(context.system_root_abs, systemConfig);
  if (layoutDiagnostics.length > 0) {
    return buildSystemOutput(context.system_root_rel, systemDiagnostics.concat(layoutDiagnostics), moduleReports, systemConfig.als_version, outputModuleFilter);
  }

  const moduleStates = moduleFilter
    ? loadModuleDependencyClosure(context.system_root_abs, systemConfig, reportingModuleIds)
    : reportingModuleIds.map((moduleId) => loadModuleState(context.system_root_abs, systemConfig, moduleId));
  const reportingModuleIdSet = new Set(reportingModuleIds);
  const stateByModuleId = new Map(moduleStates.map((state) => [state.module_id, state]));

  const recordsByUri = new Map<string, ParsedRecord[]>();
  for (const state of moduleStates) {
    for (const record of state.parsed_records) {
      if (!record.canonical_uri) continue;
      if (!recordsByUri.has(record.canonical_uri)) {
        recordsByUri.set(record.canonical_uri, []);
      }
      recordsByUri.get(record.canonical_uri)!.push(record);
    }
  }

  for (const [canonicalUri, records] of recordsByUri) {
    if (records.length <= 1) continue;
    for (const record of records) {
      const state = stateByModuleId.get(record.module_id);
      if (!state) continue;
      const diagnostic = diag(codes.ID_DUPLICATE, "error", "identity", record.file_rel, `Duplicate canonical identity '${canonicalUri}'`, {
        module_id: record.module_id,
        entity: record.entity_name,
        expected: "unique canonical identity",
        actual: canonicalUri,
      });
      state.diagnostics.push(diagnostic);
      markErroredFiles(state.file_error_map, [diagnostic]);
    }
  }

  const recordIndex = new Map<string, ParsedRecord>();
  for (const [canonicalUri, records] of recordsByUri) {
    if (records.length === 1) {
      recordIndex.set(canonicalUri, records[0]);
    }
  }

  for (const state of moduleStates) {
    if (!state.context) continue;
    for (const record of state.parsed_records) {
      const recordDiagnostics = validateRecord(record, state.context, recordIndex, { include_resolved_refs: false });
      state.diagnostics.push(...recordDiagnostics);
      markErroredFiles(state.file_error_map, recordDiagnostics);
    }
  }

  const filteredContextDiagnostics = moduleFilter
    ? collectFilteredContextDiagnostics(
      moduleFilter,
      reportingModuleIds,
      moduleStates,
      context.system_config_path_abs,
    )
    : [];
  const hasInvalidFilteredContext = filteredContextDiagnostics.length > 0;

  for (const state of moduleStates) {
    if (!state.context) continue;
    if (moduleFilter && hasInvalidFilteredContext && !reportingModuleIdSet.has(state.module_id)) {
      continue;
    }

    const resolvedRefTargetScope = moduleFilter && hasInvalidFilteredContext && reportingModuleIdSet.has(state.module_id)
      ? reportingModuleIdSet
      : undefined;

    for (const record of state.parsed_records) {
      const recordDiagnostics = validateResolvedReferencesOnly(record, state.context, recordIndex, resolvedRefTargetScope);
      state.diagnostics.push(...recordDiagnostics);
      markErroredFiles(state.file_error_map, recordDiagnostics);
    }
  }

  for (const state of moduleStates) {
    moduleReports.push(
      buildModuleReport(
        state.module_id,
        state.module_path_rel,
        state.module_version,
        state.diagnostics,
        state.files_checked,
        state.files_ignored,
        state.file_error_map,
      ),
    );
  }

  systemDiagnostics.push(...filteredContextDiagnostics);

  const reportedModuleReports = moduleReports.filter((report) => reportingModuleIds.includes(report.module_id));
  return buildSystemOutput(context.system_root_rel, systemDiagnostics, reportedModuleReports, systemConfig.als_version, outputModuleFilter);
}

function loadModuleDependencyClosure(
  systemRootAbs: string,
  systemConfig: SystemConfig,
  seedModuleIds: string[],
): ModuleWorkState[] {
  const pendingModuleIds = [...seedModuleIds].sort();
  const seenModuleIds = new Set<string>();
  const moduleStates = new Map<string, ModuleWorkState>();

  while (pendingModuleIds.length > 0) {
    const moduleId = pendingModuleIds.shift()!;
    if (seenModuleIds.has(moduleId)) continue;

    seenModuleIds.add(moduleId);
    const state = loadModuleState(systemRootAbs, systemConfig, moduleId);
    moduleStates.set(moduleId, state);

    if (!state.context) continue;

    for (const dependencyModuleId of state.context.shape.dependencies.map((dependency) => dependency.module).sort()) {
      if (!systemConfig.modules[dependencyModuleId]) continue;
      if (seenModuleIds.has(dependencyModuleId) || pendingModuleIds.includes(dependencyModuleId)) continue;
      pendingModuleIds.push(dependencyModuleId);
    }

    pendingModuleIds.sort();
  }

  return [...moduleStates.values()].sort((left, right) => left.module_id.localeCompare(right.module_id));
}

function loadModuleState(systemRootAbs: string, systemConfig: SystemConfig, moduleId: string): ModuleWorkState {
  const registryEntry = systemConfig.modules[moduleId];
  const modulePathAbs = resolveModulePath(systemRootAbs, registryEntry.path);
  const modulePathRel = toRepoRelative(modulePathAbs);
  const moduleBundleAbs = resolve(systemRootAbs, inferredModuleBundlePath(moduleId, registryEntry.version));
  const moduleBundleRel = toRepoRelative(moduleBundleAbs);
  const shapePathAbs = resolve(systemRootAbs, inferredModuleEntryPath(moduleId, registryEntry.version));
  const shapePathRel = toRepoRelative(shapePathAbs);

  const shapeResult = parseAuthoredSourceFile<ModuleShape>(
    shapePathAbs,
    "module",
    moduleShapeSchema,
    "module_shape",
    codes.SHAPE_INVALID,
    moduleId,
  );
  if (!shapeResult.success) {
    return {
      module_id: moduleId,
      module_path_rel: modulePathRel,
      module_version: registryEntry.version,
      diagnostics: shapeResult.diagnostics,
      files_checked: 0,
      files_ignored: 0,
      file_error_map: new Map<string, boolean>(),
      parsed_records: [],
      context: null,
    };
  }

  const delamainLoad = loadDelamainBundles(moduleId, moduleBundleAbs, shapePathRel, shapeResult.data);

  const context: LoadedModuleContext = {
    system_id: systemConfig.system_id,
    system_root_abs: systemRootAbs,
    module_id: moduleId,
    module_bundle_abs: moduleBundleAbs,
    module_bundle_rel: moduleBundleRel,
    module_path_abs: modulePathAbs,
    module_path_rel: modulePathRel,
    shape_path_abs: shapePathAbs,
    shape_path_rel: shapePathRel,
    module_version: registryEntry.version,
    shape: shapeResult.data,
    delamains: delamainLoad.bundles,
    templates: new Map(Object.entries(shapeResult.data.entities).map(([entityName, entity]) => [entityName, parsePathTemplate(entity.path, entityName)])),
  };

  const diagnostics: CompilerDiagnostic[] = [...shapeResult.diagnostics, ...delamainLoad.diagnostics];
  diagnostics.push(...validateShapeContracts(context, systemConfig));

  const discovery = discoverRecordFiles(context.module_path_abs, context.module_id);
  diagnostics.push(...discovery.diagnostics);
  const fileErrorMap = new Map<string, boolean>();
  for (const fileAbs of discovery.record_file_paths.concat(discovery.errored_file_paths)) {
    fileErrorMap.set(toRepoRelative(fileAbs), false);
  }
  markErroredFiles(fileErrorMap, discovery.diagnostics);

  const parsedRecords: ParsedRecord[] = [];

  for (const fileAbs of discovery.record_file_paths) {
    const recordParse = parseRecord(context, fileAbs);
    diagnostics.push(...recordParse.diagnostics);
    markErroredFiles(fileErrorMap, recordParse.diagnostics);
    if (recordParse.record) {
      parsedRecords.push(recordParse.record);
    }
  }

  return {
    module_id: moduleId,
    module_path_rel: modulePathRel,
    module_version: registryEntry.version,
    diagnostics,
    files_checked: discovery.record_file_paths.length + discovery.errored_file_paths.length,
    files_ignored: discovery.ignored_file_paths.length,
    file_error_map: fileErrorMap,
    parsed_records: parsedRecords,
    context,
  };
}

function loadDelamainBundles(
  moduleId: string,
  moduleBundleAbs: string,
  shapePathRel: string,
  shape: ModuleShape,
): { bundles: Map<string, LoadedDelamainBundle>; diagnostics: CompilerDiagnostic[] } {
  const bundles = new Map<string, LoadedDelamainBundle>();
  const diagnostics: CompilerDiagnostic[] = [];

  for (const [delamainName, registryEntry] of Object.entries(shape.delamains ?? {})) {
    const resolvedPrimaryPath = resolvePathInsideRoot(moduleBundleAbs, registryEntry.path);
    if (!resolvedPrimaryPath) {
      diagnostics.push(
        diag(
          codes.DELAMAIN_FILE_INVALID,
          "error",
          "module_shape",
          shapePathRel,
          `Delamain '${delamainName}' registry path escapes the active module version bundle`,
          {
            module_id: moduleId,
            field: `delamains.${delamainName}.path`,
            reason: reasons.DELAMAIN_BUNDLE_PATH_ESCAPE,
            expected: "path inside the active module version bundle",
            actual: registryEntry.path,
          },
        ),
      );
      continue;
    }

    const primaryPathAbs = resolvedPrimaryPath;
    const primaryPathRel = toRepoRelative(primaryPathAbs);
    const primaryStat = safeStatResult(primaryPathAbs);
    if (primaryStat.kind !== "ok") {
      diagnostics.push(buildDelamainFileTargetDiagnostic(moduleId, shapePathRel, `delamains.${delamainName}.path`, delamainName, registryEntry.path, primaryStat));
      continue;
    }

    if (!primaryStat.stat.isFile()) {
      diagnostics.push(
        diag(
          codes.DELAMAIN_FILE_INVALID,
          "error",
          "module_shape",
          shapePathRel,
          `Delamain '${delamainName}' registry path must resolve to a file`,
          {
            module_id: moduleId,
            field: `delamains.${delamainName}.path`,
            reason: reasons.DELAMAIN_BUNDLE_TARGET_NOT_FILE,
            expected: "file",
            actual: registryEntry.path,
          },
        ),
      );
      continue;
    }

    const parsedDelamain = parseAuthoredSourceFile<DelamainShape>(
      primaryPathAbs,
      "delamain",
      delamainShapeSchema,
      "module_shape",
      codes.DELAMAIN_INVALID,
      moduleId,
    );
    diagnostics.push(...parsedDelamain.diagnostics);
    if (!parsedDelamain.success) {
      continue;
    }

    for (const issue of validateDelamainDefinition(parsedDelamain.data)) {
      diagnostics.push(
        diag(
          codes.DELAMAIN_CONTRACT_INVALID,
          "error",
          "module_shape",
          primaryPathRel,
          issue.message,
          {
            module_id: moduleId,
            field: issue.path.join(".") || null,
          },
        ),
      );
    }

    const bundle: LoadedDelamainBundle = {
      name: delamainName,
      primary_path_abs: primaryPathAbs,
      primary_path_rel: primaryPathRel,
      bundle_root_abs: dirname(primaryPathAbs),
      shape: parsedDelamain.data,
      session_fields: collectDelamainSessionFields(parsedDelamain.data),
    };

    diagnostics.push(...validateDelamainPromptAssets(moduleId, moduleBundleAbs, bundle));
    bundles.set(delamainName, bundle);
  }

  return { bundles, diagnostics };
}

function validateDelamainPromptAssets(
  moduleId: string,
  moduleBundleAbs: string,
  bundle: LoadedDelamainBundle,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  for (const [stateName, state] of Object.entries(bundle.shape.states)) {
    if (state.path) {
      diagnostics.push(
        ...validateDelamainPromptAsset(
          moduleId,
          moduleBundleAbs,
          bundle,
          state.path,
          `states.${stateName}.path`,
          `Delamain state '${stateName}' agent path`,
          state.provider ?? null,
        ),
      );
    }

    const subAgentPath = state["sub-agent"];
    if (subAgentPath) {
      diagnostics.push(
        ...validateDelamainPromptAsset(
          moduleId,
          moduleBundleAbs,
          bundle,
          subAgentPath,
          `states.${stateName}.sub-agent`,
          `Delamain state '${stateName}' sub-agent path`,
          state.provider ?? null,
        ),
      );
    }
  }

  return diagnostics;
}

function validateDelamainPromptAsset(
  moduleId: string,
  moduleBundleAbs: string,
  bundle: LoadedDelamainBundle,
  authoredPath: string,
  fieldPath: string,
  label: string,
  provider: DelamainAgentProvider | null,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const resolvedAssetPath = resolvePathInsideRoot(bundle.bundle_root_abs, authoredPath);

  if (!resolvedAssetPath || !isPathInsideRoot(moduleBundleAbs, resolvedAssetPath)) {
    diagnostics.push(
      diag(
        codes.DELAMAIN_FILE_INVALID,
        "error",
        "module_shape",
        bundle.primary_path_rel,
        `${label} must remain inside the active module version bundle`,
        {
          module_id: moduleId,
          field: fieldPath,
          reason: reasons.DELAMAIN_ASSET_PATH_ESCAPE,
          expected: "path inside the active module version bundle",
          actual: authoredPath,
        },
      ),
    );
    return diagnostics;
  }

  if (!resolvedAssetPath.endsWith(".md")) {
    diagnostics.push(
      diag(
        codes.DELAMAIN_PROMPT_INVALID,
        "error",
        "module_shape",
        bundle.primary_path_rel,
        `${label} must resolve to a markdown file`,
        {
          module_id: moduleId,
          field: fieldPath,
          expected: "markdown file",
          actual: authoredPath,
        },
      ),
    );
    return diagnostics;
  }

  const assetRel = toRepoRelative(resolvedAssetPath);
  const assetStat = safeStatResult(resolvedAssetPath);
  if (assetStat.kind !== "ok") {
    diagnostics.push(buildDelamainAssetTargetDiagnostic(moduleId, bundle.primary_path_rel, fieldPath, authoredPath, assetStat));
    return diagnostics;
  }

  if (!assetStat.stat.isFile()) {
    diagnostics.push(
      diag(
        codes.DELAMAIN_FILE_INVALID,
        "error",
        "module_shape",
        bundle.primary_path_rel,
        `${label} must resolve to a file`,
        {
          module_id: moduleId,
          field: fieldPath,
          reason: reasons.DELAMAIN_ASSET_TARGET_NOT_FILE,
          expected: "file",
          actual: authoredPath,
        },
      ),
    );
    return diagnostics;
  }

  const assetRead = safeReadTextFile(resolvedAssetPath);
  if (assetRead.error) {
    diagnostics.push(
      diag(
        codes.DELAMAIN_FILE_INVALID,
        "error",
        "module_shape",
        assetRel,
        "Could not read Delamain prompt asset",
        {
          module_id: moduleId,
          field: fieldPath,
          reason: reasons.DELAMAIN_ASSET_TARGET_UNREADABLE,
          expected: "readable markdown file",
          actual: {
            code: assetRead.error.code ?? null,
            message: assetRead.error.message,
          },
        },
      ),
    );
    return diagnostics;
  }

  let parsed;
  try {
    parsed = parseFrontmatter(assetRead.contents);
  } catch (error) {
    if (!(error instanceof FrontmatterProcessingError)) {
      throw error;
    }

    diagnostics.push(
      diag(
        codes.DELAMAIN_PROMPT_INVALID,
        "error",
        "module_shape",
        assetRel,
        "Failed to parse Delamain prompt frontmatter",
        {
          module_id: moduleId,
          field: fieldPath,
          actual: error instanceof Error ? error.message : String(error),
        },
      ),
    );
    return diagnostics;
  }

  if (!isPlainObject(parsed.data) || Object.keys(parsed.data).length === 0) {
    diagnostics.push(
      diag(
        codes.DELAMAIN_PROMPT_INVALID,
        "error",
        "module_shape",
        assetRel,
        "Delamain prompt assets must declare YAML frontmatter",
        {
          module_id: moduleId,
          field: fieldPath,
          expected: "markdown file with YAML frontmatter",
          actual: null,
        },
      ),
    );
  }

  if (parsed.content.trim().length === 0) {
    diagnostics.push(
      diag(
        codes.DELAMAIN_PROMPT_INVALID,
        "error",
        "module_shape",
        assetRel,
        "Delamain prompt assets must contain a non-empty markdown body",
        {
          module_id: moduleId,
          field: fieldPath,
          expected: "non-empty markdown body",
          actual: "",
        },
      ),
    );
  }

  const promptFrontmatter = isPlainObject(parsed.data) ? parsed.data : {};
  for (const requiredField of ["name", "description"] as const) {
    if (typeof promptFrontmatter[requiredField] !== "string" || promptFrontmatter[requiredField].trim().length === 0) {
      diagnostics.push(
        diag(
          codes.DELAMAIN_PROMPT_INVALID,
          "error",
          "module_shape",
          assetRel,
          `Delamain prompt assets must declare frontmatter ${requiredField}`,
          {
            module_id: moduleId,
            field: requiredField,
            expected: "non-empty string",
            actual: promptFrontmatter[requiredField] ?? null,
          },
        ),
      );
    }
  }

  diagnostics.push(
    ...validateDelamainPromptProviderContract(
      moduleId,
      assetRel,
      fieldPath,
      provider,
      promptFrontmatter,
      parsed.content,
    ),
  );

  return diagnostics;
}

const ANTHROPIC_AGENT_MODELS = new Set(["sonnet", "opus", "haiku"]);
const ANTHROPIC_ONLY_FRONTMATTER_FIELDS = new Set(["tools"]);
const OPENAI_ONLY_FRONTMATTER_FIELDS = new Set([
  "approval-policy",
  "network-enabled",
  "reasoning-effort",
  "sandbox-mode",
]);
const CLAUDE_SKILL_REFERENCE_PATTERN = /(^|[\s`(])\/[a-z][a-z0-9-]*/im;
const CODEX_SKILL_REFERENCE_PATTERN = /(^|[\s`(])\$[a-z][a-z0-9-]*/im;

function validateDelamainPromptProviderContract(
  moduleId: string,
  assetRel: string,
  fieldPath: string,
  provider: DelamainAgentProvider | null,
  promptFrontmatter: Record<string, unknown>,
  promptBody: string,
): CompilerDiagnostic[] {
  if (!provider) {
    return [];
  }

  const diagnostics: CompilerDiagnostic[] = [];

  if (provider === "anthropic") {
    for (const fieldName of OPENAI_ONLY_FRONTMATTER_FIELDS) {
      if (fieldName in promptFrontmatter) {
        diagnostics.push(
          diag(
            codes.DELAMAIN_PROMPT_INVALID,
            "error",
            "module_shape",
            assetRel,
            `Anthropic Delamain prompt assets must not declare '${fieldName}'`,
            {
              module_id: moduleId,
              field: fieldPath,
              expected: "anthropic-compatible frontmatter",
              actual: fieldName,
            },
          ),
        );
      }
    }

    if (
      "model" in promptFrontmatter
      && (
        typeof promptFrontmatter.model !== "string"
        || !ANTHROPIC_AGENT_MODELS.has(promptFrontmatter.model.trim())
      )
    ) {
      diagnostics.push(
        diag(
          codes.DELAMAIN_PROMPT_INVALID,
          "error",
          "module_shape",
          assetRel,
          "Anthropic Delamain prompt assets must use an Anthropic model alias",
          {
            module_id: moduleId,
            field: "model",
            expected: [...ANTHROPIC_AGENT_MODELS],
            actual: promptFrontmatter.model ?? null,
          },
        ),
      );
    }

    const codexSkillReference = promptBody.match(CODEX_SKILL_REFERENCE_PATTERN)?.[0]?.trim();
    if (codexSkillReference) {
      diagnostics.push(
        diag(
          codes.DELAMAIN_PROMPT_INVALID,
          "error",
          "module_shape",
          assetRel,
          "Anthropic Delamain prompt assets must not use Codex `$skill` syntax",
          {
            module_id: moduleId,
            field: fieldPath,
            expected: "Claude `/skill` syntax or plain instructions",
            actual: codexSkillReference,
          },
        ),
      );
    }

    return diagnostics;
  }

  for (const fieldName of ANTHROPIC_ONLY_FRONTMATTER_FIELDS) {
    if (fieldName in promptFrontmatter) {
      diagnostics.push(
        diag(
          codes.DELAMAIN_PROMPT_INVALID,
          "error",
          "module_shape",
          assetRel,
          `OpenAI Delamain prompt assets must not declare '${fieldName}'`,
          {
            module_id: moduleId,
            field: fieldPath,
            expected: "openai-compatible frontmatter",
            actual: fieldName,
          },
        ),
      );
    }
  }

  for (const requiredField of ["sandbox-mode", "approval-policy"] as const) {
    if (
      typeof promptFrontmatter[requiredField] !== "string"
      || promptFrontmatter[requiredField].trim().length === 0
    ) {
      diagnostics.push(
        diag(
          codes.DELAMAIN_PROMPT_INVALID,
          "error",
          "module_shape",
          assetRel,
          `OpenAI Delamain prompt assets must declare frontmatter ${requiredField}`,
          {
            module_id: moduleId,
            field: requiredField,
            expected: "non-empty string",
            actual: promptFrontmatter[requiredField] ?? null,
          },
        ),
      );
    }
  }

  const claudeSkillReference = promptBody.match(CLAUDE_SKILL_REFERENCE_PATTERN)?.[0]?.trim();
  if (claudeSkillReference) {
    diagnostics.push(
      diag(
        codes.DELAMAIN_PROMPT_INVALID,
        "error",
        "module_shape",
        assetRel,
        "OpenAI Delamain prompt assets must not use Claude `/skill` syntax",
        {
          module_id: moduleId,
          field: fieldPath,
          expected: "Codex `$skill` syntax or plain instructions",
          actual: claudeSkillReference,
        },
      ),
    );
  }

  return diagnostics;
}

function validateRecord(
  record: ParsedRecord,
  context: LoadedModuleContext,
  recordIndex: Map<string, ParsedRecord>,
  options: { include_resolved_refs?: boolean } = {},
): CompilerDiagnostic[] {
  if (record.source_format === "jsonl") {
    // JSONL rows do not support refs in this pass, so row validation is the full record contract.
    return validateJsonlRows(record);
  }

  const diagnostics: CompilerDiagnostic[] = [];
  const effectiveContract = resolveEffectiveEntityContract(record.entity_shape as MarkdownEntityShape, record.frontmatter ?? {}, {
    module_id: context.module_id,
    entity_name: record.entity_name,
    record_file: record.file_rel,
    shape_file: context.shape_path_rel,
  }, context.delamains);
  diagnostics.push(...validateFrontmatter(record, context, effectiveContract.fields, effectiveContract.known_field_names));
  diagnostics.push(...effectiveContract.diagnostics);
  diagnostics.push(...validateBody(record, effectiveContract.body, effectiveContract.body_diagnostics));
  diagnostics.push(...validateIdentity(record));
  diagnostics.push(...validateParentReferencePrefix(record));
  if (options.include_resolved_refs !== false) {
    diagnostics.push(...validateResolvedReferences(record, context, recordIndex, effectiveContract.fields));
  }
  return diagnostics;
}

function validateResolvedReferencesOnly(
  record: ParsedRecord,
  context: LoadedModuleContext,
  recordIndex: Map<string, ParsedRecord>,
  allowedTargetModuleIds?: ReadonlySet<string>,
): CompilerDiagnostic[] {
  if (record.source_format === "jsonl") {
    // JSONL records have no ref-bearing surfaces in this pass, so there is no
    // resolved-reference phase to run after shape and row validation.
    return [];
  }

  const effectiveContract = resolveEffectiveEntityContract(record.entity_shape as MarkdownEntityShape, record.frontmatter ?? {}, {
    module_id: context.module_id,
    entity_name: record.entity_name,
    record_file: record.file_rel,
    shape_file: context.shape_path_rel,
  }, context.delamains);

  return validateResolvedReferences(record, context, recordIndex, effectiveContract.fields, allowedTargetModuleIds);
}

function validateFrontmatter(
  record: ParsedRecord,
  context: LoadedModuleContext,
  declaredFields: Record<string, FieldShape>,
  knownFieldNames: string[],
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const frontmatter = record.frontmatter ?? {};

  for (const fieldName of Object.keys(declaredFields)) {
    if (!(fieldName in frontmatter)) {
      diagnostics.push(
        diag(codes.FM_MISSING_FIELD, "error", "record_frontmatter", record.file_rel, `Missing declared frontmatter field '${fieldName}'`, {
          module_id: record.module_id,
          entity: record.entity_name,
          field: fieldName,
          expected: fieldName,
          actual: null,
        }),
      );
    }
  }

  for (const fieldName of Object.keys(frontmatter)) {
    if (!(fieldName in declaredFields) && !knownFieldNames.includes(fieldName)) {
      diagnostics.push(
        diag(codes.FM_UNKNOWN_FIELD, "error", "record_frontmatter", record.file_rel, `Unknown frontmatter field '${fieldName}'`, {
          module_id: record.module_id,
          entity: record.entity_name,
          field: fieldName,
          expected: knownFieldNames,
          actual: fieldName,
        }),
      );
    }
  }

  for (const [fieldName, fieldShape] of Object.entries(declaredFields)) {
    if (!(fieldName in frontmatter)) continue;
    diagnostics.push(...validateFieldValue(record, context, fieldName, fieldShape, frontmatter[fieldName]));
  }

  return diagnostics;
}

function validateFieldValue(
  record: ParsedRecord,
  context: LoadedModuleContext,
  fieldName: string,
  fieldShape: FieldShape,
  value: unknown,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  if (value === null || value === undefined) {
    if (!fieldShape.allow_null) {
      diagnostics.push(
        diag(codes.FM_TYPE_MISMATCH, "error", "record_frontmatter", record.file_rel, `Field '${fieldName}' is not nullable`, {
          module_id: record.module_id,
          entity: record.entity_name,
          field: fieldName,
          expected: `non-null ${fieldShape.type}`,
          actual: value,
        }),
      );
    }
    return diagnostics;
  }

  switch (fieldShape.type) {
    case "id":
      if (typeof value !== "string" || value.length === 0) {
        diagnostics.push(
          diag(codes.FM_TYPE_MISMATCH, "error", "record_frontmatter", record.file_rel, `Field '${fieldName}' must be a non-empty string`, {
            module_id: record.module_id,
            entity: record.entity_name,
            field: fieldName,
            expected: "non-empty string",
            actual: value,
          }),
        );
      }
      break;

    case "string":
      if (typeof value !== "string" || value.length === 0) {
        diagnostics.push(
          diag(codes.FM_TYPE_MISMATCH, "error", "record_frontmatter", record.file_rel, `Field '${fieldName}' must be a non-empty string`, {
            module_id: record.module_id,
            entity: record.entity_name,
            field: fieldName,
            expected: "non-empty string",
            actual: value,
          }),
        );
      }
      break;

    case "number":
      if (typeof value !== "number") {
        diagnostics.push(
          diag(codes.FM_TYPE_MISMATCH, "error", "record_frontmatter", record.file_rel, `Field '${fieldName}' must be a number`, {
            module_id: record.module_id,
            entity: record.entity_name,
            field: fieldName,
            expected: "number",
            actual: typeof value,
          }),
        );
      }
      break;

    case "date":
      if (typeof value === "string") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          diagnostics.push(
            diag(codes.FM_DATE_FORMAT, "error", "record_frontmatter", record.file_rel, `Field '${fieldName}' must use YYYY-MM-DD`, {
              module_id: record.module_id,
              entity: record.entity_name,
              field: fieldName,
              expected: "YYYY-MM-DD",
              actual: value,
            }),
          );
        }
      } else if (!(value instanceof Date)) {
        diagnostics.push(
          diag(codes.FM_TYPE_MISMATCH, "error", "record_frontmatter", record.file_rel, `Field '${fieldName}' must be a date`, {
            module_id: record.module_id,
            entity: record.entity_name,
            field: fieldName,
            expected: "YYYY-MM-DD or Date",
            actual: typeof value,
          }),
        );
      }
      break;

    case "enum":
      if (typeof value !== "string") {
        diagnostics.push(
          diag(codes.FM_TYPE_MISMATCH, "error", "record_frontmatter", record.file_rel, `Field '${fieldName}' must be a string enum`, {
            module_id: record.module_id,
            entity: record.entity_name,
            field: fieldName,
            expected: "string enum",
            actual: typeof value,
          }),
        );
      } else if (!fieldShape.allowed_values.includes(value)) {
        diagnostics.push(
          diag(codes.FM_ENUM_INVALID, "error", "record_frontmatter", record.file_rel, `Field '${fieldName}' has invalid enum value '${value}'`, {
            module_id: record.module_id,
            entity: record.entity_name,
            field: fieldName,
            expected: fieldShape.allowed_values,
            actual: value,
          }),
        );
      }
      break;

    case "delamain":
      if (typeof value !== "string") {
        diagnostics.push(
          diag(codes.FM_TYPE_MISMATCH, "error", "record_frontmatter", record.file_rel, `Field '${fieldName}' must be a Delamain state name`, {
            module_id: record.module_id,
            entity: record.entity_name,
            field: fieldName,
            expected: "Delamain state name",
            actual: typeof value,
          }),
        );
      } else {
        const bundle = context.delamains.get(fieldShape.delamain);
        if (!bundle) {
          diagnostics.push(
            diag(
              codes.DELAMAIN_CONTRACT_INVALID,
              "error",
              "record_frontmatter",
              record.file_rel,
              `Could not validate field '${fieldName}' because Delamain '${fieldShape.delamain}' did not load`,
              {
                module_id: record.module_id,
                entity: record.entity_name,
                field: fieldName,
                reason: reasons.DELAMAIN_BINDING_UNRESOLVED,
                expected: `loaded Delamain '${fieldShape.delamain}'`,
                actual: fieldShape.delamain,
              },
            ),
          );
        } else if (!(value in bundle.shape.states)) {
          diagnostics.push(
            diag(codes.FM_ENUM_INVALID, "error", "record_frontmatter", record.file_rel, `Field '${fieldName}' has invalid Delamain state '${value}'`, {
              module_id: record.module_id,
              entity: record.entity_name,
              field: fieldName,
              expected: Object.keys(bundle.shape.states).sort(),
              actual: value,
            }),
          );
        }
      }
      break;

    case "ref":
      diagnostics.push(...validateRefContract(record, context, fieldName, fieldShape, value));
      break;

    case "file_path":
      if (typeof value !== "string") {
        diagnostics.push(buildFilePathTypeDiagnostic(record, fieldName, fieldShape.base, codes.FM_TYPE_MISMATCH, value));
      } else {
        diagnostics.push(...validateFilePathContract(record, context, fieldName, fieldShape, value));
      }
      break;

    case "list":
      if (!Array.isArray(value)) {
        diagnostics.push(
          diag(codes.FM_TYPE_MISMATCH, "error", "record_frontmatter", record.file_rel, `Field '${fieldName}' must be a list`, {
            module_id: record.module_id,
            entity: record.entity_name,
            field: fieldName,
            expected: "array",
            actual: typeof value,
          }),
        );
      } else {
        const seenEnumValues = fieldShape.items.type === "enum" ? new Set<string>() : null;
        const allowedEnumValues = fieldShape.items.type === "enum" ? new Set(fieldShape.items.allowed_values) : null;
        value.forEach((item, index) => {
          if (fieldShape.items.type === "string") {
            if (typeof item !== "string") {
              diagnostics.push(
                diag(codes.FM_ARRAY_ITEM, "error", "record_frontmatter", record.file_rel, `Field '${fieldName}[${index}]' must be a string`, {
                  module_id: record.module_id,
                  entity: record.entity_name,
                  field: `${fieldName}[${index}]`,
                  expected: "string",
                  actual: typeof item,
                }),
              );
            }
          } else if (fieldShape.items.type === "enum") {
            if (typeof item !== "string") {
              diagnostics.push(
                diag(codes.FM_ARRAY_ITEM, "error", "record_frontmatter", record.file_rel, `Field '${fieldName}[${index}]' must be a string (enum member)`, {
                  module_id: record.module_id,
                  entity: record.entity_name,
                  field: `${fieldName}[${index}]`,
                  expected: "string (enum member)",
                  actual: typeof item,
                }),
              );
            } else if (!allowedEnumValues!.has(item)) {
              diagnostics.push(
                diag(codes.FM_ENUM_INVALID, "error", "record_frontmatter", record.file_rel, `Field '${fieldName}[${index}]' has invalid enum value '${item}'`, {
                  module_id: record.module_id,
                  entity: record.entity_name,
                  field: `${fieldName}[${index}]`,
                  expected: fieldShape.items.allowed_values,
                  actual: item,
                }),
              );
            } else if (seenEnumValues!.has(item)) {
              diagnostics.push(
                diag(codes.FM_ARRAY_ITEM, "error", "record_frontmatter", record.file_rel, `Field '${fieldName}[${index}]' duplicates enum value '${item}'`, {
                  module_id: record.module_id,
                  entity: record.entity_name,
                  field: `${fieldName}[${index}]`,
                  reason: reasons.FRONTMATTER_LIST_ITEM_DUPLICATE,
                  expected: "unique enum list item",
                  actual: item,
                }),
              );
            } else {
              seenEnumValues!.add(item);
            }
          } else if (fieldShape.items.type === "file_path") {
            const itemFieldName = `${fieldName}[${index}]`;
            if (typeof item !== "string") {
              diagnostics.push(buildFilePathTypeDiagnostic(record, itemFieldName, fieldShape.items.base, codes.FM_ARRAY_ITEM, item));
            } else {
              diagnostics.push(...validateFilePathContract(record, context, itemFieldName, { base: fieldShape.items.base }, item));
            }
          } else {
            diagnostics.push(...validateRefContract(record, context, `${fieldName}[${index}]`, { type: "ref", allow_null: false, target: fieldShape.items.target }, item));
          }
        });
      }
      break;
  }

  return diagnostics;
}

function validateJsonlRows(record: ParsedRecord): CompilerDiagnostic[] {
  if (record.source_format !== "jsonl") {
    return [];
  }

  const diagnostics: CompilerDiagnostic[] = [];
  const rowFields = (record.entity_shape as JsonlEntityShape).rows.fields;
  const declaredFieldNames = Object.keys(rowFields).sort();

  for (const row of record.rows ?? []) {
    for (const fieldName of declaredFieldNames) {
      if (!(fieldName in row.value)) {
        diagnostics.push(
          diag(codes.ROW_MISSING_FIELD, "error", "record_rows", record.file_rel, `JSONL row ${row.line_number} is missing declared field '${fieldName}'`, {
            module_id: record.module_id,
            entity: record.entity_name,
            field: fieldName,
            expected: fieldName,
            actual: null,
            line: row.line_number,
            column: 1,
          }),
        );
      }
    }

    for (const fieldName of Object.keys(row.value)) {
      if (!(fieldName in rowFields)) {
        diagnostics.push(
          diag(codes.ROW_UNKNOWN_FIELD, "error", "record_rows", record.file_rel, `JSONL row ${row.line_number} contains undeclared field '${fieldName}'`, {
            module_id: record.module_id,
            entity: record.entity_name,
            field: fieldName,
            expected: declaredFieldNames,
            actual: fieldName,
            line: row.line_number,
            column: 1,
          }),
        );
      }
    }

    for (const [fieldName, fieldShape] of Object.entries(rowFields)) {
      if (!(fieldName in row.value)) continue;
      diagnostics.push(...validateJsonlRowFieldValue(record, row.line_number, fieldName, fieldShape, row.value[fieldName]));
    }
  }

  return diagnostics;
}

function validateJsonlRowFieldValue(
  record: ParsedRecord,
  lineNumber: number,
  fieldName: string,
  fieldShape: JsonlRowFieldShape,
  value: unknown,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  if (value === null || value === undefined) {
    if (!fieldShape.allow_null) {
      diagnostics.push(
        diag(codes.ROW_TYPE_MISMATCH, "error", "record_rows", record.file_rel, `JSONL row ${lineNumber} field '${fieldName}' is not nullable`, {
          module_id: record.module_id,
          entity: record.entity_name,
          field: fieldName,
          expected: `non-null ${fieldShape.type}`,
          actual: value,
          line: lineNumber,
          column: 1,
        }),
      );
    }
    return diagnostics;
  }

  switch (fieldShape.type) {
    case "string":
      if (typeof value !== "string" || value.length === 0) {
        diagnostics.push(
          diag(codes.ROW_TYPE_MISMATCH, "error", "record_rows", record.file_rel, `JSONL row ${lineNumber} field '${fieldName}' must be a non-empty string`, {
            module_id: record.module_id,
            entity: record.entity_name,
            field: fieldName,
            expected: "non-empty string",
            actual: value,
            line: lineNumber,
            column: 1,
          }),
        );
      }
      break;

    case "number":
      if (typeof value !== "number") {
        diagnostics.push(
          diag(codes.ROW_TYPE_MISMATCH, "error", "record_rows", record.file_rel, `JSONL row ${lineNumber} field '${fieldName}' must be a number`, {
            module_id: record.module_id,
            entity: record.entity_name,
            field: fieldName,
            expected: "number",
            actual: typeof value,
            line: lineNumber,
            column: 1,
          }),
        );
      }
      break;

    case "date":
      if (typeof value !== "string") {
        diagnostics.push(
          diag(codes.ROW_TYPE_MISMATCH, "error", "record_rows", record.file_rel, `JSONL row ${lineNumber} field '${fieldName}' must be a date`, {
            module_id: record.module_id,
            entity: record.entity_name,
            field: fieldName,
            expected: "YYYY-MM-DD",
            actual: typeof value,
            line: lineNumber,
            column: 1,
          }),
        );
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        diagnostics.push(
          diag(codes.ROW_DATE_FORMAT, "error", "record_rows", record.file_rel, `JSONL row ${lineNumber} field '${fieldName}' must use YYYY-MM-DD`, {
            module_id: record.module_id,
            entity: record.entity_name,
            field: fieldName,
            expected: "YYYY-MM-DD",
            actual: value,
            line: lineNumber,
            column: 1,
          }),
        );
      }
      break;

    case "enum":
      if (typeof value !== "string") {
        diagnostics.push(
          diag(codes.ROW_TYPE_MISMATCH, "error", "record_rows", record.file_rel, `JSONL row ${lineNumber} field '${fieldName}' must be a string enum`, {
            module_id: record.module_id,
            entity: record.entity_name,
            field: fieldName,
            expected: "string enum",
            actual: typeof value,
            line: lineNumber,
            column: 1,
          }),
        );
      } else if (!fieldShape.allowed_values.includes(value)) {
        diagnostics.push(
          diag(codes.ROW_ENUM_INVALID, "error", "record_rows", record.file_rel, `JSONL row ${lineNumber} field '${fieldName}' has invalid enum value '${value}'`, {
            module_id: record.module_id,
            entity: record.entity_name,
            field: fieldName,
            expected: fieldShape.allowed_values,
            actual: value,
            line: lineNumber,
            column: 1,
          }),
        );
      }
      break;

    case "list":
      if (!Array.isArray(value)) {
        diagnostics.push(
          diag(codes.ROW_TYPE_MISMATCH, "error", "record_rows", record.file_rel, `JSONL row ${lineNumber} field '${fieldName}' must be a list`, {
            module_id: record.module_id,
            entity: record.entity_name,
            field: fieldName,
            expected: "array",
            actual: typeof value,
            line: lineNumber,
            column: 1,
          }),
        );
        break;
      }

      const seenEnumValues = fieldShape.items.type === "enum" ? new Set<string>() : null;
      const allowedEnumValues = fieldShape.items.type === "enum" ? new Set(fieldShape.items.allowed_values) : null;
      value.forEach((item, index) => {
        const indexedFieldName = `${fieldName}[${index}]`;
        if (fieldShape.items.type === "string") {
          if (typeof item !== "string") {
            diagnostics.push(
              diag(codes.ROW_ARRAY_ITEM, "error", "record_rows", record.file_rel, `JSONL row ${lineNumber} field '${indexedFieldName}' must be a string`, {
                module_id: record.module_id,
                entity: record.entity_name,
                field: indexedFieldName,
                expected: "string",
                actual: typeof item,
                line: lineNumber,
                column: 1,
              }),
            );
          }
          return;
        }

        if (typeof item !== "string") {
          diagnostics.push(
            diag(codes.ROW_ARRAY_ITEM, "error", "record_rows", record.file_rel, `JSONL row ${lineNumber} field '${indexedFieldName}' must be a string (enum member)`, {
              module_id: record.module_id,
              entity: record.entity_name,
              field: indexedFieldName,
              expected: "string (enum member)",
              actual: typeof item,
              line: lineNumber,
              column: 1,
            }),
          );
        } else if (!allowedEnumValues!.has(item)) {
          diagnostics.push(
            diag(codes.ROW_ENUM_INVALID, "error", "record_rows", record.file_rel, `JSONL row ${lineNumber} field '${indexedFieldName}' has invalid enum value '${item}'`, {
              module_id: record.module_id,
              entity: record.entity_name,
              field: indexedFieldName,
              expected: fieldShape.items.allowed_values,
              actual: item,
              line: lineNumber,
              column: 1,
            }),
          );
        } else if (seenEnumValues!.has(item)) {
          diagnostics.push(
            diag(codes.ROW_ARRAY_ITEM, "error", "record_rows", record.file_rel, `JSONL row ${lineNumber} field '${indexedFieldName}' duplicates enum value '${item}'`, {
              module_id: record.module_id,
              entity: record.entity_name,
              field: indexedFieldName,
              reason: reasons.ROW_LIST_ITEM_DUPLICATE,
              expected: "unique enum list item",
              actual: item,
              line: lineNumber,
              column: 1,
            }),
          );
        } else {
          seenEnumValues!.add(item);
        }
      });
      break;
  }

  return diagnostics;
}

function validateFilePathContract(
  record: ParsedRecord,
  context: LoadedModuleContext,
  fieldName: string,
  fieldShape: FilePathContractShape,
  value: string,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  if (value.length === 0) {
    diagnostics.push(
      buildInvalidFilePathDiagnostic(record, fieldName, fieldShape.base, value, "must be a non-empty file path string"),
    );
    return diagnostics;
  }

  if (isMarkdownLinkValue(value)) {
    diagnostics.push(
      buildInvalidFilePathDiagnostic(record, fieldName, fieldShape.base, value, "must be a plain file path, not a markdown link"),
    );
    return diagnostics;
  }

  if (value.includes("://")) {
    diagnostics.push(
      buildInvalidFilePathDiagnostic(record, fieldName, fieldShape.base, value, "must be a filesystem path, not a URI"),
    );
    return diagnostics;
  }

  let targetAbs: string;
  if (fieldShape.base === "system_root") {
    if (value.startsWith("/") || value.startsWith("\\") || value.includes("\\")) {
      diagnostics.push(
        buildInvalidFilePathDiagnostic(record, fieldName, fieldShape.base, value, "must be a normalized relative path using '/' separators"),
      );
      return diagnostics;
    }

    if (hasWindowsDrivePrefix(value)) {
      diagnostics.push(
        buildInvalidFilePathDiagnostic(record, fieldName, fieldShape.base, value, "must be relative to the ALS system root, not a drive-prefixed path"),
      );
      return diagnostics;
    }

    const segments = value.split("/");
    if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
      diagnostics.push(
        buildInvalidFilePathDiagnostic(record, fieldName, fieldShape.base, value, "must not contain empty, '.', or '..' path segments"),
      );
      return diagnostics;
    }

    targetAbs = resolve(context.system_root_abs, value);
  } else {
    if (!isAbsolute(value)) {
      diagnostics.push(
        buildInvalidFilePathDiagnostic(record, fieldName, fieldShape.base, value, "must be an absolute host file path"),
      );
      return diagnostics;
    }

    if (value.endsWith("/") || value.endsWith("\\")) {
      diagnostics.push(
        buildInvalidFilePathDiagnostic(record, fieldName, fieldShape.base, value, "must not end with a directory separator"),
      );
      return diagnostics;
    }

    if (hasNonNormalizedHostAbsoluteSegments(value)) {
      diagnostics.push(
        buildInvalidFilePathDiagnostic(record, fieldName, fieldShape.base, value, "must be a normalized absolute host file path without empty, '.', or '..' path segments"),
      );
      return diagnostics;
    }

    targetAbs = value;
  }

  const targetStat = safeStatResult(targetAbs);
  if (targetStat.kind === "missing") {
    diagnostics.push(
      diag(codes.FM_FILE_PATH_TARGET, "error", "record_frontmatter", record.file_rel, `Field '${fieldName}' points to a missing file`, {
        module_id: record.module_id,
        entity: record.entity_name,
        field: fieldName,
        reason: reasons.FRONTMATTER_FILE_PATH_TARGET_MISSING,
        expected: "existing file",
        actual: value,
      }),
    );
    return diagnostics;
  }

  if (targetStat.kind === "unreadable") {
    diagnostics.push(
      diag(codes.FM_FILE_PATH_TARGET, "error", "record_frontmatter", record.file_rel, `Field '${fieldName}' points to a file the validator cannot access`, {
        module_id: record.module_id,
        entity: record.entity_name,
        field: fieldName,
        reason: reasons.FRONTMATTER_FILE_PATH_TARGET_UNREADABLE,
        expected: "accessible existing file",
        actual: value,
      }),
    );
    return diagnostics;
  }

  if (!targetStat.stat.isFile()) {
    diagnostics.push(
      diag(codes.FM_FILE_PATH_TARGET, "error", "record_frontmatter", record.file_rel, `Field '${fieldName}' must point to a file, not a directory`, {
        module_id: record.module_id,
        entity: record.entity_name,
        field: fieldName,
        reason: reasons.FRONTMATTER_FILE_PATH_TARGET_NOT_FILE,
        expected: "file",
        actual: value,
      }),
    );
  }

  return diagnostics;
}

function buildFilePathTypeDiagnostic(
  record: ParsedRecord,
  fieldName: string,
  base: FilePathBase,
  code: typeof codes.FM_TYPE_MISMATCH | typeof codes.FM_ARRAY_ITEM,
  actual: unknown,
): CompilerDiagnostic {
  return diag(code, "error", "record_frontmatter", record.file_rel, `Field '${fieldName}' must be a string file path`, {
    module_id: record.module_id,
    entity: record.entity_name,
    field: fieldName,
    expected: describeFilePathExpectedValue(base),
    actual: typeof actual,
  });
}

function buildInvalidFilePathDiagnostic(
  record: ParsedRecord,
  fieldName: string,
  base: FilePathBase,
  actual: unknown,
  detail: string,
): CompilerDiagnostic {
  return diag(
    codes.FM_FILE_PATH_FORMAT,
    "error",
    "record_frontmatter",
    record.file_rel,
    `Field '${fieldName}' ${detail}`,
    {
      module_id: record.module_id,
      entity: record.entity_name,
      field: fieldName,
      reason: reasons.FRONTMATTER_FILE_PATH_INVALID,
      expected: describeFilePathExpectedValue(base),
      actual,
    },
  );
}

function describeFilePathExpectedValue(base: FilePathBase): string {
  switch (base) {
    case "system_root":
      return "system-root-relative file path";
    case "host_absolute":
      return "absolute host file path";
    default: {
      const exhaustiveCheck: never = base;
      return exhaustiveCheck;
    }
  }
}

function isMarkdownLinkValue(value: string): boolean {
  return /^\[[^\]]*\]\(([^)]+)\)$/.test(value);
}

function hasWindowsDrivePrefix(value: string): boolean {
  return /^[A-Za-z]:/.test(value);
}

function hasNonNormalizedHostAbsoluteSegments(value: string): boolean {
  const root = parse(value).root;
  const remainder = value.slice(root.length);
  const segments = process.platform === "win32" ? remainder.split(/[\\/]/) : remainder.split("/");
  return segments.some((segment) => segment.length === 0 || segment === "." || segment === "..");
}

function validateBody(
  record: ParsedRecord,
  declaredBody: EffectiveBodyContract | null,
  bodyDiagnostics: CompilerDiagnostic[],
): CompilerDiagnostic[] {
  if (bodyDiagnostics.length > 0) {
    return bodyDiagnostics;
  }

  const diagnostics: CompilerDiagnostic[] = [];
  if (!declaredBody) return diagnostics;
  if (!record.body) return diagnostics;
  const body = record.body;
  const frontmatter = record.frontmatter ?? {};

  diagnostics.push(
    ...validateBodyMarkdownSurface(body.markdown_surface, record.file_rel, record.module_id, record.entity_name),
  );

  if (body.titles.length > 1) {
    diagnostics.push(
      diag(codes.BODY_CONSTRAINT_VIOLATION, "error", "record_body", record.file_rel, "Multiple top-level h1 headings are not allowed", {
        module_id: record.module_id,
        entity: record.entity_name,
        field: "title",
        reason: reasons.BODY_TITLE_MULTIPLE_H1,
        expected: "exactly one top-level h1",
        actual: body.titles,
      }),
    );
  }

  if (declaredBody.title) {
    if (body.content_before_title.trim().length > 0) {
      diagnostics.push(
        diag(codes.BODY_CONSTRAINT_VIOLATION, "error", "record_body", record.file_rel, "Content before the declared h1 title is not allowed", {
          module_id: record.module_id,
          entity: record.entity_name,
          field: "title",
          reason: reasons.BODY_TITLE_CONTENT_BEFORE_DECLARED,
          expected: "h1 as first structural body region",
          actual: body.content_before_title.trim(),
        }),
      );
    }

    if (!body.title) {
      diagnostics.push(
        diag(codes.BODY_CONSTRAINT_VIOLATION, "error", "record_body", record.file_rel, "Missing declared h1 title", {
          module_id: record.module_id,
          entity: record.entity_name,
          field: "title",
          reason: reasons.BODY_TITLE_MISSING_DECLARED,
          expected: "exactly one h1",
          actual: null,
        }),
      );
    } else {
      const expectedTitle = renderExpectedTitle(declaredBody.title, frontmatter);
      if (expectedTitle.kind === "invalid_source") {
        diagnostics.push(
          diag(codes.BODY_CONSTRAINT_VIOLATION, "error", "record_body", record.file_rel, `Cannot validate the declared h1 title because frontmatter field '${expectedTitle.field}' is not a non-empty string`, {
            module_id: record.module_id,
            entity: record.entity_name,
            field: "title",
            reason: reasons.BODY_TITLE_SOURCE_INVALID,
            expected: {
              source_field: expectedTitle.field,
              type: "non-empty string",
            },
            actual: expectedTitle.actual,
          }),
        );
      } else if (expectedTitle.kind === "expected" && body.title !== expectedTitle.value) {
        diagnostics.push(
          diag(codes.BODY_CONSTRAINT_VIOLATION, "error", "record_body", record.file_rel, "The h1 title does not match the declared title source", {
            module_id: record.module_id,
            entity: record.entity_name,
            field: "title",
            reason: reasons.BODY_TITLE_MISMATCH,
            expected: expectedTitle.value,
            actual: body.title,
          }),
        );
      }
    }
  } else if (body.titles.length > 0) {
    diagnostics.push(
      diag(codes.BODY_CONSTRAINT_VIOLATION, "error", "record_body", record.file_rel, "Undeclared h1 title content is not allowed", {
        module_id: record.module_id,
        entity: record.entity_name,
        field: "title",
        reason: reasons.BODY_TITLE_UNDECLARED,
        expected: "no top-level h1",
        actual: body.titles,
      }),
    );
  }

  if (declaredBody.preamble) {
    diagnostics.push(
      ...validateRegionMarkdown("preamble", declaredBody.preamble, body.preamble, record.file_rel, record.module_id, record.entity_name, 2),
    );
  } else if (body.preamble.trim().length > 0) {
    diagnostics.push(
      diag(codes.BODY_CONSTRAINT_VIOLATION, "error", "record_body", record.file_rel, "Undeclared top-level preamble content is not allowed", {
        module_id: record.module_id,
        entity: record.entity_name,
        field: "preamble",
        reason: reasons.BODY_PREAMBLE_UNDECLARED,
        expected: "no top-level preamble",
        actual: body.preamble.trim(),
      }),
    );
  }

  const duplicateSectionNames = Array.from(new Set(body.duplicate_section_names));
  for (const sectionName of duplicateSectionNames) {
    diagnostics.push(
      diag(codes.BODY_CONSTRAINT_VIOLATION, "error", "record_body", record.file_rel, `Duplicate top-level section '## ${sectionName}' is not allowed`, {
        module_id: record.module_id,
        entity: record.entity_name,
        field: sectionName,
        reason: reasons.BODY_SECTION_DUPLICATE,
        expected: "unique top-level section names",
        actual: sectionName,
      }),
    );
  }

  const membershipDiagnosticsStart = diagnostics.length;

  for (const section of declaredBody.sections) {
    if (!body.by_name.has(section.name)) {
      diagnostics.push(
        diag(codes.BODY_MISSING_SECTION, "error", "record_body", record.file_rel, `Missing declared section '## ${section.name}'`, {
          module_id: record.module_id,
          entity: record.entity_name,
          field: section.name,
          expected: section.name,
          actual: null,
        }),
      );
    }
  }

  for (const section of body.ordered) {
    if (!declaredBody.sections.find((declared) => declared.name === section.name)) {
      diagnostics.push(
        diag(codes.BODY_UNKNOWN_SECTION, "error", "record_body", record.file_rel, `Unknown section '## ${section.name}'`, {
          module_id: record.module_id,
          entity: record.entity_name,
          field: section.name,
          expected: declaredBody.sections.map((declared) => declared.name),
          actual: section.name,
        }),
      );
    }
  }

  const hasMembershipErrors = diagnostics.length > membershipDiagnosticsStart;
  const actualKnownOrder = body.ordered
    .map((section) => section.name)
    .filter((sectionName) => declaredBody.sections.some((declared) => declared.name === sectionName));
  const expectedOrder = declaredBody.sections.map((section) => section.name);
  if (!hasMembershipErrors && duplicateSectionNames.length === 0 && actualKnownOrder.join("||") !== expectedOrder.join("||")) {
    diagnostics.push(
      diag(codes.BODY_ORDER_MISMATCH, "error", "record_body", record.file_rel, "Section order does not match shape definition", {
        module_id: record.module_id,
        entity: record.entity_name,
        expected: expectedOrder,
        actual: actualKnownOrder,
      }),
    );
  }

  for (const section of declaredBody.sections) {
    if (duplicateSectionNames.includes(section.name)) continue;
    const content = body.by_name.get(section.name);
    if (content === undefined) continue;
    diagnostics.push(...validateSectionMarkdown(section, content, record.file_rel, record.module_id, record.entity_name));
  }

  return diagnostics;
}

function validateIdentity(record: ParsedRecord): CompilerDiagnostic[] {
  if (record.source_format !== "markdown") {
    return [];
  }

  const diagnostics: CompilerDiagnostic[] = [];
  const idValue = record.frontmatter?.id;
  if (typeof idValue !== "string" || idValue.length === 0) {
    return diagnostics;
  }

  const fileStem = basename(record.file_rel).replace(/\.md$/, "");
  if (fileStem !== idValue) {
    diagnostics.push(
      diag(codes.ID_FILENAME_MISMATCH, "error", "identity", record.file_rel, `Filename stem '${fileStem}' does not match id '${idValue}'`, {
        module_id: record.module_id,
        entity: record.entity_name,
        field: "id",
        expected: idValue,
        actual: fileStem,
      }),
    );
  }

  return diagnostics;
}

function validateResolvedReferences(
  record: ParsedRecord,
  context: LoadedModuleContext,
  recordIndex: Map<string, ParsedRecord>,
  declaredFields: Record<string, FieldShape>,
  allowedTargetModuleIds?: ReadonlySet<string>,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const frontmatter = record.frontmatter ?? {};

  for (const [fieldName, fieldShape] of Object.entries(declaredFields)) {
    if (!(fieldName in frontmatter)) continue;
    const value = frontmatter[fieldName];

    if (fieldShape.type === "ref") {
      if (allowedTargetModuleIds && !allowedTargetModuleIds.has(fieldShape.target.module)) {
        continue;
      }
      diagnostics.push(...validateResolvedRef(record, context, fieldName, fieldShape, value, recordIndex));
    } else if (fieldShape.type === "list" && fieldShape.items.type === "ref" && Array.isArray(value)) {
      if (allowedTargetModuleIds && !allowedTargetModuleIds.has(fieldShape.items.target.module)) {
        continue;
      }
      value.forEach((item, index) => {
        diagnostics.push(
          ...validateResolvedRef(record, context, `${fieldName}[${index}]`, { type: "ref", allow_null: false, target: fieldShape.items.target }, item, recordIndex),
        );
      });
    }
  }

  return diagnostics;
}

function validateParentReferencePrefix(record: ParsedRecord): CompilerDiagnostic[] {
  if (record.source_format !== "markdown") {
    return [];
  }

  const diagnostics: CompilerDiagnostic[] = [];
  const parentConfig = (record.entity_shape as MarkdownEntityShape).identity.parent;
  if (parentConfig && record.canonical_uri) {
    const parentFieldValue = record.frontmatter?.[parentConfig.ref_field];
    const parsedParentRef = typeof parentFieldValue === "string" ? parseRefUri(parentFieldValue) : null;
    if (parsedParentRef && !record.canonical_uri.startsWith(`${parsedParentRef.uri}/`)) {
      diagnostics.push(
        diag(codes.REF_PARENT_PREFIX, "error", "reference", record.file_rel, `Parent ref '${parentConfig.ref_field}' is not a strict prefix of the record canonical URI`, {
          module_id: record.module_id,
          entity: record.entity_name,
          field: parentConfig.ref_field,
          expected: `${parsedParentRef.uri}/...`,
          actual: record.canonical_uri,
        }),
      );
    }
  }

  return diagnostics;
}

export function resolveEffectiveEntityContract(
  entityShape: MarkdownEntityShape,
  frontmatter: Record<string, unknown>,
  meta: EffectiveEntityContractContext,
  delamains: Map<string, LoadedDelamainBundle> = new Map(),
): EffectiveEntityContract {
  if (!isVariantEntityShape(entityShape)) {
    const synthesized = synthesizeDelamainSessionFields(entityShape.fields, frontmatter, delamains, meta, null);
    return {
      fields: synthesized.fields,
      known_field_names: materializeKnownFieldNames(synthesized.fields, synthesized.supplemental_known_field_names),
      body: {
        title: entityShape.body.title,
        preamble: entityShape.body.preamble,
        sections: entityShape.body.sections,
      },
      diagnostics: synthesized.diagnostics,
      body_diagnostics: [],
    };
  }

  const discriminatorField = entityShape.discriminator;
  const expectedVariants = Object.keys(entityShape.variants).sort();
  const knownFieldNames = collectKnownFieldNames(entityShape, delamains);

  if (!(discriminatorField in frontmatter)) {
    return {
      fields: entityShape.fields,
      known_field_names: knownFieldNames,
      body: null,
      diagnostics: [
        unresolvedVariantDiagnostic(
          meta,
          discriminatorField,
          `Could not resolve variant contract because discriminator field '${discriminatorField}' is missing`,
          expectedVariants,
          null,
        ),
      ],
      body_diagnostics: [
        unresolvedVariantBodyDiagnostic(
          meta,
          discriminatorField,
          `Could not validate body because discriminator field '${discriminatorField}' is missing`,
          expectedVariants,
          null,
        ),
      ],
    };
  }

  const discriminatorValue = frontmatter[discriminatorField];
  if (typeof discriminatorValue !== "string") {
    return {
      fields: entityShape.fields,
      known_field_names: knownFieldNames,
      body: null,
      diagnostics: [
        unresolvedVariantDiagnostic(
          meta,
          discriminatorField,
          `Could not resolve variant contract because discriminator field '${discriminatorField}' is not a string`,
          expectedVariants,
          discriminatorValue,
        ),
      ],
      body_diagnostics: [
        unresolvedVariantBodyDiagnostic(
          meta,
          discriminatorField,
          `Could not validate body because discriminator field '${discriminatorField}' is not a string`,
          expectedVariants,
          discriminatorValue,
        ),
      ],
    };
  }

  const variant = entityShape.variants[discriminatorValue];
  if (!variant) {
    return {
      fields: entityShape.fields,
      known_field_names: knownFieldNames,
      body: null,
      diagnostics: [
        unresolvedVariantDiagnostic(
          meta,
          discriminatorField,
          `Could not resolve variant contract because discriminator field '${discriminatorField}' has unknown variant '${discriminatorValue}'`,
          expectedVariants,
          discriminatorValue,
        ),
      ],
      body_diagnostics: [
        unresolvedVariantBodyDiagnostic(
          meta,
          discriminatorField,
          `Could not validate body because discriminator field '${discriminatorField}' has unknown variant '${discriminatorValue}'`,
          expectedVariants,
          discriminatorValue,
        ),
      ],
    };
  }

  const fields = {
    ...entityShape.fields,
    ...variant.fields,
  };
  const synthesized = synthesizeDelamainSessionFields(fields, frontmatter, delamains, meta, discriminatorValue);
  const diagnostics: CompilerDiagnostic[] = [];
  const sections: SectionShape[] = [];

  variant.sections.forEach((sectionName, index) => {
    const materialized = materializeSectionShape(sectionName, entityShape.section_definitions[sectionName]);
    if (!materialized) {
      diagnostics.push(
        diag(
          codes.SHAPE_CONTRACT_INVALID,
          "error",
          "module_shape",
          meta.shape_file,
          `Variant '${discriminatorValue}' references missing section definition '${sectionName}' during contract resolution`,
          {
            module_id: meta.module_id,
            entity: meta.entity_name,
            field: `entities.${meta.entity_name}.variants.${discriminatorValue}.sections[${index}]`,
            expected: Object.keys(entityShape.section_definitions).sort(),
            actual: sectionName,
            hint: "This should have been caught during shape validation before record validation.",
          },
        ),
      );
      return;
    }
    sections.push(materialized);
  });

  return {
    fields: synthesized.fields,
    known_field_names: materializeKnownFieldNames(synthesized.fields, synthesized.supplemental_known_field_names),
    body: diagnostics.length > 0
      ? null
      : {
          title: entityShape.body?.title,
          preamble: entityShape.body?.preamble,
          sections,
        },
    diagnostics: diagnostics.concat(synthesized.diagnostics),
    body_diagnostics: [],
  };
}

function isVariantEntityShape(entityShape: MarkdownEntityShape): entityShape is VariantEntityShape {
  return "discriminator" in entityShape;
}

function renderExpectedTitle(title: TitleShape, frontmatter: Record<string, unknown>): RenderedTitleExpectation {
  const { source } = title;

  if (source.kind === "authored") {
    return { kind: "authored" };
  }

  if (source.kind === "field") {
    const value = frontmatter[source.field];
    if (typeof value !== "string" || value.length === 0) {
      return {
        kind: "invalid_source",
        field: source.field,
        actual: value,
      };
    }
    return { kind: "expected", value };
  }

  const parts: string[] = [];
  for (const part of source.parts) {
    if (part.kind === "literal") {
      parts.push(part.value);
      continue;
    }

    const value = frontmatter[part.field];
    if (typeof value !== "string" || value.length === 0) {
      return {
        kind: "invalid_source",
        field: part.field,
        actual: value,
      };
    }
    parts.push(value);
  }

  return { kind: "expected", value: parts.join("") };
}

function materializeSectionShape(name: string, definition: SectionDefinitionShape | undefined): SectionShape | null {
  if (!definition) {
    return null;
  }

  return {
    name,
    ...definition,
  };
}

function unresolvedVariantDiagnostic(
  meta: EffectiveEntityContractContext,
  discriminatorField: string,
  message: string,
  expectedVariants: string[],
  actual: unknown,
): CompilerDiagnostic {
  return diag(codes.FM_VARIANT_UNRESOLVED, "error", "record_frontmatter", meta.record_file, message, {
    module_id: meta.module_id,
    entity: meta.entity_name,
    field: discriminatorField,
    expected: expectedVariants,
    actual,
    hint: "Fix the discriminator field before validating variant-local fields.",
  });
}

function unresolvedVariantBodyDiagnostic(
  meta: EffectiveEntityContractContext,
  discriminatorField: string,
  message: string,
  expectedVariants: string[],
  actual: unknown,
): CompilerDiagnostic {
  return diag(codes.BODY_VARIANT_UNRESOLVED, "error", "record_body", meta.record_file, message, {
    module_id: meta.module_id,
    entity: meta.entity_name,
    field: discriminatorField,
    expected: expectedVariants,
    actual,
    hint: "Fix the discriminator field before validating body sections.",
  });
}

function collectKnownFieldNames(entityShape: VariantEntityShape, delamains: Map<string, LoadedDelamainBundle>): string[] {
  const knownFieldNames = new Set(Object.keys(entityShape.fields));

  const rootBinding = selectEffectiveDelamainBinding(entityShape.fields);
  if (rootBinding) {
    for (const sessionFieldName of collectImplicitSessionFieldNames(rootBinding.delamain_name, delamains)) {
      knownFieldNames.add(sessionFieldName);
    }
  }

  for (const variant of Object.values(entityShape.variants)) {
    for (const fieldName of Object.keys(variant.fields)) {
      knownFieldNames.add(fieldName);
    }

    if (!rootBinding) {
      const variantBinding = selectEffectiveDelamainBinding(variant.fields);
      if (variantBinding) {
        for (const sessionFieldName of collectImplicitSessionFieldNames(variantBinding.delamain_name, delamains)) {
          knownFieldNames.add(sessionFieldName);
        }
      }
    }
  }

  return Array.from(knownFieldNames).sort();
}

function synthesizeDelamainSessionFields(
  fields: Record<string, FieldShape>,
  frontmatter: Record<string, unknown>,
  delamains: Map<string, LoadedDelamainBundle>,
  meta: EffectiveEntityContractContext,
  variantName: string | null,
): { fields: Record<string, FieldShape>; diagnostics: CompilerDiagnostic[]; supplemental_known_field_names: string[] } {
  const binding = selectEffectiveDelamainBinding(fields);
  if (!binding) {
    return {
      fields,
      diagnostics: [],
      supplemental_known_field_names: [],
    };
  }

  const bundle = delamains.get(binding.delamain_name);
  if (!bundle) {
    return {
      fields,
      diagnostics: [
        diag(
          codes.DELAMAIN_CONTRACT_INVALID,
          "error",
          "record_frontmatter",
          meta.record_file,
          `Could not materialize Delamain session fields because Delamain '${binding.delamain_name}' did not load`,
          {
            module_id: meta.module_id,
            entity: meta.entity_name,
            field: variantName ? `${variantName}.${binding.field_path}` : binding.field_path,
            reason: reasons.DELAMAIN_BINDING_UNRESOLVED,
            expected: `loaded Delamain '${binding.delamain_name}'`,
            actual: binding.delamain_name,
          },
        ),
      ],
      supplemental_known_field_names: Object.keys(frontmatter),
    };
  }

  const nextFields: Record<string, FieldShape> = { ...fields };
  const diagnostics: CompilerDiagnostic[] = [];

  for (const sessionFieldName of bundle.session_fields) {
    if (sessionFieldName in nextFields) {
      diagnostics.push(
        diag(
          codes.DELAMAIN_CONTRACT_INVALID,
          "error",
          "record_frontmatter",
          meta.record_file,
          `Delamain session-field '${sessionFieldName}' collides with an explicit field on the active effective entity schema`,
          {
            module_id: meta.module_id,
            entity: meta.entity_name,
            field: variantName ? `${variantName}.${sessionFieldName}` : sessionFieldName,
            reason: reasons.DELAMAIN_SESSION_FIELD_COLLISION,
            expected: "session-field name that does not collide with explicit fields",
            actual: sessionFieldName,
          },
        ),
      );
      continue;
    }

    nextFields[sessionFieldName] = {
      type: "string",
      allow_null: true,
    };
  }

  return {
    fields: nextFields,
    diagnostics,
    supplemental_known_field_names: [],
  };
}

function materializeKnownFieldNames(
  fields: Record<string, FieldShape>,
  supplementalKnownFieldNames: string[],
): string[] {
  return Array.from(new Set([...Object.keys(fields), ...supplementalKnownFieldNames])).sort();
}

function collectImplicitSessionFieldNames(
  delamainName: string,
  delamains: Map<string, LoadedDelamainBundle>,
): string[] {
  return delamains.get(delamainName)?.session_fields ?? [];
}

function selectEffectiveDelamainBinding(
  fields: Record<string, FieldShape>,
): { field_path: string; delamain_name: string } | null {
  const bindings = collectDelamainBindings(fields);
  if (bindings.length !== 1) {
    return null;
  }

  return bindings[0];
}

function collectDelamainBindings(
  fields: Record<string, FieldShape>,
  prefix = "",
): Array<{ field_path: string; delamain_name: string }> {
  const bindings: Array<{ field_path: string; delamain_name: string }> = [];

  for (const [fieldName, fieldShape] of Object.entries(fields)) {
    if (fieldShape.type !== "delamain") continue;
    bindings.push({
      field_path: `${prefix}${fieldName}`,
      delamain_name: fieldShape.delamain,
    });
  }

  return bindings;
}

function validateRefContract(
  record: ParsedRecord,
  context: LoadedModuleContext,
  fieldName: string,
  fieldShape: Extract<FieldShape, { type: "ref" }>,
  value: unknown,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  if (typeof value !== "string") {
    diagnostics.push(
      diag(codes.FM_REF_FORMAT, "error", "record_frontmatter", record.file_rel, `Field '${fieldName}' must be a markdown link`, {
        module_id: record.module_id,
        entity: record.entity_name,
        field: fieldName,
        expected: "[label](als://...)",
        actual: typeof value,
      }),
    );
    return diagnostics;
  }

  const parsedRef = parseRefUri(value);
  if (!parsedRef) {
    diagnostics.push(
      diag(codes.FM_REF_FORMAT, "error", "record_frontmatter", record.file_rel, `Field '${fieldName}' is not a valid ALS ref`, {
        module_id: record.module_id,
        entity: record.entity_name,
        field: fieldName,
        expected: "[label](als://system_id/module/entity/id)",
        actual: value,
      }),
    );
    return diagnostics;
  }

  if (parsedRef.system_id !== context.system_id || parsedRef.module !== fieldShape.target.module) {
    diagnostics.push(
      diag(codes.REF_CONTRACT_MISMATCH, "error", "reference", record.file_rel, `Field '${fieldName}' points to the wrong system/module`, {
        module_id: record.module_id,
        entity: record.entity_name,
        field: fieldName,
        expected: {
          system_id: context.system_id,
          module: fieldShape.target.module,
          entity: fieldShape.target.entity,
        },
        actual: {
          system_id: parsedRef.system_id,
          module: parsedRef.module,
          entity: refTargetEntity(parsedRef),
        },
      }),
    );
  }

  if (refTargetEntity(parsedRef) !== fieldShape.target.entity) {
    diagnostics.push(
      diag(codes.REF_ENTITY_MISMATCH, "error", "reference", record.file_rel, `Field '${fieldName}' points to the wrong entity`, {
        module_id: record.module_id,
        entity: record.entity_name,
        field: fieldName,
        expected: fieldShape.target.entity,
        actual: refTargetEntity(parsedRef),
      }),
    );
  }

  return diagnostics;
}

function validateResolvedRef(
  record: ParsedRecord,
  context: LoadedModuleContext,
  fieldName: string,
  _fieldShape: Extract<FieldShape, { type: "ref" }>,
  value: unknown,
  recordIndex: Map<string, ParsedRecord>,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  if (typeof value !== "string") return diagnostics;

  const parsedRef = parseRefUri(value);
  if (!parsedRef) return diagnostics;

  if (parsedRef.system_id !== context.system_id) {
    diagnostics.push(
      diag(codes.REF_CONTRACT_MISMATCH, "error", "reference", record.file_rel, `Reference '${fieldName}' points to the wrong system`, {
        module_id: record.module_id,
        entity: record.entity_name,
        field: fieldName,
        expected: context.system_id,
        actual: parsedRef.system_id,
      }),
    );
    return diagnostics;
  }

  if (!recordIndex.has(parsedRef.uri)) {
    diagnostics.push(
      diag(codes.REF_UNRESOLVED, "error", "reference", record.file_rel, `Reference '${fieldName}' does not resolve`, {
        module_id: record.module_id,
        entity: record.entity_name,
        field: fieldName,
        expected: "existing record",
        actual: parsedRef.uri,
      }),
    );
  }

  return diagnostics;
}

function parseRecord(
  context: LoadedModuleContext,
  fileAbs: string,
): { record: ParsedRecord | null; diagnostics: CompilerDiagnostic[] } {
  const diagnostics: CompilerDiagnostic[] = [];
  const fileRel = toRepoRelative(fileAbs);
  const fileRelWithinModule = relative(context.module_path_abs, fileAbs).replace(/\\/g, "/");
  const entityMatch = inferEntity(fileRelWithinModule, context);
  if (!entityMatch) {
    diagnostics.push(
      diag(codes.PARSE_ENTITY_INFER, "error", "parse", fileRel, `Could not infer entity from path '${fileRelWithinModule}'`, {
        module_id: context.module_id,
        expected: Object.values(context.shape.entities).map((entity) => entity.path),
        actual: fileRelWithinModule,
      }),
    );
    return { record: null, diagnostics };
  }

  const entityShape = context.shape.entities[entityMatch.entity_name];
  const fileRead = safeReadTextFile(fileAbs);
  if (fileRead.error) {
    diagnostics.push(
      diag(entityShape.source_format === "jsonl" ? codes.PARSE_JSONL : codes.PARSE_FRONTMATTER, "error", "parse", fileRel, "Could not read record file", {
        module_id: context.module_id,
        entity: entityMatch.entity_name,
        expected: entityShape.source_format === "jsonl" ? "readable jsonl file" : "readable markdown file",
        actual: {
          code: fileRead.error.code ?? null,
          message: fileRead.error.message,
        },
        hint: "Check file permissions and rerun validation.",
      }),
    );
    return { record: null, diagnostics };
  }

  return entityShape.source_format === "jsonl"
    ? parseJsonlRecord(context, entityMatch, fileAbs, fileRel, fileRelWithinModule, fileRead.contents, diagnostics)
    : parseMarkdownRecord(context, entityMatch, fileAbs, fileRel, fileRelWithinModule, fileRead.contents, diagnostics);
}

function parseMarkdownRecord(
  context: LoadedModuleContext,
  entityMatch: { entity_name: string; bindings: Map<string, string>; template: ParsedPathTemplate },
  fileAbs: string,
  fileRel: string,
  fileRelWithinModule: string,
  fileContents: string,
  diagnostics: CompilerDiagnostic[],
): { record: ParsedRecord | null; diagnostics: CompilerDiagnostic[] } {
  let parsedMatter;
  try {
    parsedMatter = parseFrontmatter(fileContents);
  } catch (error) {
    if (!(error instanceof FrontmatterProcessingError)) {
      throw error;
    }

    diagnostics.push(
      diag(codes.PARSE_FRONTMATTER, "error", "parse", fileRel, "Failed to parse frontmatter", {
        module_id: context.module_id,
        entity: entityMatch.entity_name,
        actual: error instanceof Error ? error.message : String(error),
      }),
    );
    return { record: null, diagnostics };
  }

  let body: ParsedBody;
  try {
    body = parseBody(parsedMatter.content);
  } catch (error) {
    if (!(error instanceof MarkdownProcessingError)) {
      throw error;
    }

    diagnostics.push(
      diag(codes.PARSE_MARKDOWN, "error", "parse", fileRel, "Failed to parse markdown body", {
        module_id: context.module_id,
        entity: entityMatch.entity_name,
        field: "body",
        actual: error instanceof Error ? error.message : String(error),
      }),
    );
    return { record: null, diagnostics };
  }

  const record: ParsedRecord = {
    source_format: "markdown",
    module_id: context.module_id,
    file_abs: fileAbs,
    file_rel: fileRel,
    file_rel_within_module: fileRelWithinModule,
    entity_name: entityMatch.entity_name,
    entity_shape: context.shape.entities[entityMatch.entity_name],
    frontmatter: parsedMatter.data as Record<string, unknown>,
    body,
    rows: null,
    bindings: entityMatch.bindings,
    canonical_uri: null,
  };

  record.canonical_uri = buildCanonicalUri(context, entityMatch.entity_name, record, entityMatch.bindings);
  return { record, diagnostics };
}

function parseJsonlRecord(
  context: LoadedModuleContext,
  entityMatch: { entity_name: string; bindings: Map<string, string>; template: ParsedPathTemplate },
  fileAbs: string,
  fileRel: string,
  fileRelWithinModule: string,
  fileContents: string,
  diagnostics: CompilerDiagnostic[],
): { record: ParsedRecord | null; diagnostics: CompilerDiagnostic[] } {
  const rows = parseJsonlRows(fileContents, fileRel, context.module_id, entityMatch.entity_name, diagnostics);

  // Unlike markdown, JSONL lines are independent. Keep the record and any rows
  // that did parse so row-schema diagnostics can accumulate in the same run.
  const record: ParsedRecord = {
    source_format: "jsonl",
    module_id: context.module_id,
    file_abs: fileAbs,
    file_rel: fileRel,
    file_rel_within_module: fileRelWithinModule,
    entity_name: entityMatch.entity_name,
    entity_shape: context.shape.entities[entityMatch.entity_name],
    frontmatter: null,
    body: null,
    rows,
    bindings: entityMatch.bindings,
    canonical_uri: null,
  };

  record.canonical_uri = buildCanonicalUri(context, entityMatch.entity_name, record, entityMatch.bindings);
  return { record, diagnostics };
}

function parseJsonlRows(
  source: string,
  fileRel: string,
  moduleId: string,
  entityName: string,
  diagnostics: CompilerDiagnostic[],
): JsonlRow[] {
  const rawLines = source.split(/\r?\n/);
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }

  const rows: JsonlRow[] = [];

  rawLines.forEach((rawLine, index) => {
    const lineNumber = index + 1;

    if (rawLine.trim().length === 0) {
      diagnostics.push(
        diag(codes.PARSE_JSONL, "error", "parse", fileRel, `JSONL line ${lineNumber} must be a JSON object`, {
          module_id: moduleId,
          entity: entityName,
          reason: reasons.JSONL_LINE_INVALID,
          expected: "one JSON object per non-empty line",
          actual: rawLine,
          line: lineNumber,
          column: 1,
        }),
      );
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawLine);
    } catch (error) {
      diagnostics.push(
        diag(codes.PARSE_JSONL, "error", "parse", fileRel, `Failed to parse JSONL line ${lineNumber}`, {
          module_id: moduleId,
          entity: entityName,
          reason: reasons.JSONL_LINE_INVALID,
          expected: "valid JSON object line",
          actual: error instanceof Error ? error.message : String(error),
          line: lineNumber,
          column: 1,
        }),
      );
      return;
    }

    if (!isPlainObject(parsed)) {
      diagnostics.push(
        diag(codes.PARSE_JSONL, "error", "parse", fileRel, `JSONL line ${lineNumber} must be a JSON object`, {
          module_id: moduleId,
          entity: entityName,
          reason: reasons.JSONL_LINE_NOT_OBJECT,
          expected: "JSON object",
          actual: parsed,
          line: lineNumber,
          column: 1,
        }),
      );
      return;
    }

    rows.push({
      line_number: lineNumber,
      value: parsed,
    });
  });

  return rows;
}

function inferEntity(
  relativePath: string,
  context: LoadedModuleContext,
) : { entity_name: string; bindings: Map<string, string>; template: ParsedPathTemplate } | null {
  const matches: Array<{ entity_name: string; bindings: Map<string, string>; template: ParsedPathTemplate }> = [];

  for (const [entityName, template] of context.templates) {
    const bindings = matchPath(relativePath, template);
    if (bindings) {
      matches.push({ entity_name: entityName, bindings, template });
    }
  }

  if (matches.length !== 1) return null;
  return matches[0];
}

function buildCanonicalUri(
  context: LoadedModuleContext,
  entityName: string,
  record: ParsedRecord,
  bindings: Map<string, string>,
): string | null {
  if (record.source_format === "jsonl") {
    return buildJsonlCanonicalUri(context, entityName, bindings);
  }

  const idValue = record.frontmatter?.id;
  if (typeof idValue !== "string" || idValue.length === 0) return null;

  const segments: string[] = [];
  const lineage: string[] = [];

  let currentEntityName: string | undefined = entityName;
  while (currentEntityName) {
    lineage.unshift(currentEntityName);
    const currentEntityShape = context.shape.entities[currentEntityName];
    if (currentEntityShape.source_format !== "markdown") {
      break;
    }
    currentEntityName = currentEntityShape.identity.parent?.entity;
  }

  for (const lineageEntity of lineage) {
    const entityId = lineageEntity === entityName ? idValue : bindings.get(lineageEntity);
    if (!entityId) return null;
    segments.push(lineageEntity, entityId);
  }

  return `als://${context.system_id}/${context.module_id}/${segments.join("/")}`;
}

function buildJsonlCanonicalUri(
  context: LoadedModuleContext,
  entityName: string,
  bindings: Map<string, string>,
): string | null {
  const template = context.templates.get(entityName);
  if (!template) return null;

  const lineage: string[] = [];
  const seenEntityNames = new Set<string>();
  for (const segment of template.segments) {
    if (segment.kind !== "placeholder" || !segment.entity_name) continue;
    if (seenEntityNames.has(segment.entity_name)) continue;
    seenEntityNames.add(segment.entity_name);
    lineage.push(segment.entity_name);
  }

  if (lineage.length === 0) return null;

  const segments: string[] = [];
  for (const lineageEntity of lineage) {
    const entityId = bindings.get(lineageEntity);
    if (!entityId) return null;
    segments.push(lineageEntity, entityId);
  }

  return `als://${context.system_id}/${context.module_id}/${segments.join("/")}`;
}

function validateShapeContracts(
  context: LoadedModuleContext,
  systemConfig: SystemConfig,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const dependencySet = new Set(context.shape.dependencies.map((dependency) => dependency.module));

  for (const dependency of context.shape.dependencies) {
    if (!systemConfig.modules[dependency.module]) {
      diagnostics.push(
        diag(codes.SHAPE_CONTRACT_INVALID, "error", "module_shape", context.shape_path_rel, `Dependency '${dependency.module}' is not declared in system.ts`, {
          module_id: context.module_id,
          field: "dependencies",
          expected: Object.keys(systemConfig.modules).sort(),
          actual: dependency.module,
        }),
      );
    }
  }

  for (const [entityName, entityShape] of Object.entries(context.shape.entities)) {
    if (entityShape.source_format !== "markdown") {
      continue;
    }

    for (const [fieldName, fieldShape] of Object.entries(entityShape.fields)) {
      diagnostics.push(...validateFieldContract(context, dependencySet, entityName, fieldName, fieldShape));
    }

    if (isVariantEntityShape(entityShape)) {
      for (const [variantName, variant] of Object.entries(entityShape.variants)) {
        for (const [fieldName, fieldShape] of Object.entries(variant.fields)) {
          diagnostics.push(
            ...validateFieldContract(context, dependencySet, entityName, `${variantName}.${fieldName}`, fieldShape),
          );
        }
      }
    }

    diagnostics.push(...validateEntityDelamainContracts(context, entityName, entityShape));
  }

  return diagnostics;
}

function validateFieldContract(
  context: LoadedModuleContext,
  dependencySet: Set<string>,
  entityName: string,
  fieldName: string,
  fieldShape: FieldShape,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  if (fieldShape.type === "ref" && fieldShape.target.module !== context.module_id && !dependencySet.has(fieldShape.target.module)) {
    diagnostics.push(
      diag(codes.SHAPE_CONTRACT_INVALID, "error", "module_shape", context.shape_path_rel, `Field '${fieldName}' targets undeclared dependency '${fieldShape.target.module}'`, {
        module_id: context.module_id,
        entity: entityName,
        field: fieldName,
        expected: [...dependencySet].sort(),
        actual: fieldShape.target.module,
      }),
    );
  }

  if (fieldShape.type === "list" && fieldShape.items.type === "ref" && fieldShape.items.target.module !== context.module_id && !dependencySet.has(fieldShape.items.target.module)) {
    diagnostics.push(
      diag(codes.SHAPE_CONTRACT_INVALID, "error", "module_shape", context.shape_path_rel, `Field '${fieldName}' targets undeclared dependency '${fieldShape.items.target.module}'`, {
        module_id: context.module_id,
        entity: entityName,
        field: fieldName,
        expected: [...dependencySet].sort(),
        actual: fieldShape.items.target.module,
      }),
    );
  }

  if (fieldShape.type === "delamain") {
    if (!(fieldShape.delamain in (context.shape.delamains ?? {}))) {
      diagnostics.push(
        diag(
          codes.DELAMAIN_CONTRACT_INVALID,
          "error",
          "module_shape",
          context.shape_path_rel,
          `Field '${fieldName}' references unknown Delamain '${fieldShape.delamain}'`,
          {
            module_id: context.module_id,
            entity: entityName,
            field: fieldName,
            expected: Object.keys(context.shape.delamains ?? {}).sort(),
            actual: fieldShape.delamain,
          },
        ),
      );
    }
  }

  return diagnostics;
}

function validateEntityDelamainContracts(
  context: LoadedModuleContext,
  entityName: string,
  entityShape: MarkdownEntityShape,
): CompilerDiagnostic[] {
  if (!isVariantEntityShape(entityShape)) {
    return validatePlainEntityDelamainContracts(context, entityName, entityShape);
  }

  return validateVariantEntityDelamainContracts(context, entityName, entityShape);
}

function validatePlainEntityDelamainContracts(
  context: LoadedModuleContext,
  entityName: string,
  entityShape: MarkdownEntityShape,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const rootBindings = collectDelamainBindings(entityShape.fields);

  if (rootBindings.length > 1) {
    diagnostics.push(
      ...buildTooManyDelamainDiagnostics(
        context,
        entityName,
        rootBindings.map((binding) => binding.field_path),
        "Plain entities may declare at most one Delamain-bound field",
      ),
    );
  }

  if (rootBindings.length === 1) {
    diagnostics.push(...validateEffectiveSchemaSessionFieldCollisions(
      context,
      entityName,
      null,
      Object.keys(entityShape.fields),
      rootBindings[0].delamain_name,
    ));
  }

  return diagnostics;
}

function validateVariantEntityDelamainContracts(
  context: LoadedModuleContext,
  entityName: string,
  entityShape: VariantEntityShape,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const rootBindings = collectDelamainBindings(entityShape.fields);

  if (rootBindings.length > 1) {
    diagnostics.push(
      ...buildTooManyDelamainDiagnostics(
        context,
        entityName,
        rootBindings.map((binding) => binding.field_path),
        "Variant entity root fields may declare at most one Delamain-bound field",
      ),
    );
  }

  for (const [variantName, variant] of Object.entries(entityShape.variants)) {
    const variantBindings = collectDelamainBindings(variant.fields, `${variantName}.`);

    if (rootBindings.length > 0 && variantBindings.length > 0) {
      diagnostics.push(
        ...buildTooManyDelamainDiagnostics(
          context,
          entityName,
          variantBindings.map((binding) => binding.field_path),
          `Variant '${variantName}' cannot declare a Delamain-bound field when root fields already declare one`,
        ),
      );
      continue;
    }

    if (variantBindings.length > 1) {
      diagnostics.push(
        ...buildTooManyDelamainDiagnostics(
          context,
          entityName,
          variantBindings.map((binding) => binding.field_path),
          `Variant '${variantName}' may declare at most one Delamain-bound field`,
        ),
      );
      continue;
    }

    const effectiveBinding = rootBindings[0] ?? variantBindings[0] ?? null;
    if (!effectiveBinding) {
      continue;
    }

    diagnostics.push(...validateEffectiveSchemaSessionFieldCollisions(
      context,
      entityName,
      variantName,
      Object.keys(entityShape.fields).concat(Object.keys(variant.fields)),
      effectiveBinding.delamain_name,
    ));
  }

  return diagnostics;
}

function buildTooManyDelamainDiagnostics(
  context: LoadedModuleContext,
  entityName: string,
  fieldPaths: string[],
  message: string,
): CompilerDiagnostic[] {
  return fieldPaths.map((fieldPath) =>
    diag(
      codes.DELAMAIN_CONTRACT_INVALID,
      "error",
      "module_shape",
      context.shape_path_rel,
      message,
      {
        module_id: context.module_id,
        entity: entityName,
        field: fieldPath,
        reason: reasons.DELAMAIN_EFFECTIVE_FIELD_CONFLICT,
        expected: "at most one Delamain-bound field per effective entity schema",
        actual: fieldPath,
      },
    )
  );
}

function validateEffectiveSchemaSessionFieldCollisions(
  context: LoadedModuleContext,
  entityName: string,
  variantName: string | null,
  explicitFieldNames: string[],
  delamainName: string,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const bundle = context.delamains.get(delamainName);
  if (!bundle) {
    return diagnostics;
  }

  const explicitFieldNameSet = new Set(explicitFieldNames);
  const seenImplicit = new Set<string>();
  for (const sessionFieldName of bundle.session_fields) {
    if (explicitFieldNameSet.has(sessionFieldName)) {
      diagnostics.push(
        diag(
          codes.DELAMAIN_CONTRACT_INVALID,
          "error",
          "module_shape",
          context.shape_path_rel,
          `Delamain session-field '${sessionFieldName}' collides with an explicit field on the same effective entity schema`,
          {
            module_id: context.module_id,
            entity: entityName,
            field: variantName ? `variants.${variantName}.fields.${sessionFieldName}` : sessionFieldName,
            reason: reasons.DELAMAIN_SESSION_FIELD_COLLISION,
            expected: "session-field name that does not collide with explicit fields",
            actual: sessionFieldName,
          },
        ),
      );
    }

    if (seenImplicit.has(sessionFieldName)) {
      diagnostics.push(
        diag(
          codes.DELAMAIN_CONTRACT_INVALID,
          "error",
          "module_shape",
          context.shape_path_rel,
          `Delamain session-field '${sessionFieldName}' collides with another implicit session field on the same effective entity schema`,
          {
            module_id: context.module_id,
            entity: entityName,
            field: variantName ? `variants.${variantName}` : entityName,
            reason: reasons.DELAMAIN_SESSION_FIELD_COLLISION,
            expected: "unique implicit session-field names",
            actual: sessionFieldName,
          },
        ),
      );
    }
    seenImplicit.add(sessionFieldName);
  }

  return diagnostics;
}

function validateSystemLayout(
  systemRootAbs: string,
  systemConfig: SystemConfig,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  const seenModulePaths: Array<{ module_id: string; path: string; segments: string[] }> = [];
  for (const [moduleId, registryEntry] of Object.entries(systemConfig.modules)) {
    const modulePath = registryEntry.path;
    const modulePathSegments = splitModuleMountPath(modulePath);
    const overlappingModule = seenModulePaths.find((existing) => modulePathsOverlap(modulePathSegments, existing.segments));
    if (overlappingModule) {
      const conflictMessage = describeModulePathConflict(
        moduleId,
        modulePath,
        modulePathSegments,
        overlappingModule.module_id,
        overlappingModule.path,
        overlappingModule.segments,
      );
      diagnostics.push(
        diag(
          codes.SYSTEM_MODULE_PATH_CONFLICT,
          "error",
          "system_config",
          modulePath,
          conflictMessage,
          {
            module_id: moduleId,
            field: "path",
            expected: "non-overlapping module path",
            actual: modulePath,
          },
        ),
      );
    } else {
      seenModulePaths.push({ module_id: moduleId, path: modulePath, segments: modulePathSegments });
    }

    const modulePathAbs = resolveModulePath(systemRootAbs, modulePath);
    const modulePathRel = toRepoRelative(modulePathAbs);
    const moduleStat = safeStat(modulePathAbs);

    if (!moduleStat) {
      diagnostics.push(
        diag(codes.SYSTEM_MODULE_PATH_INVALID, "error", "system_config", modulePathRel, `Module '${moduleId}' path does not exist`, {
          module_id: moduleId,
          field: "path",
          expected: "existing directory",
          actual: "missing",
        }),
      );
    } else if (!moduleStat.isDirectory()) {
      diagnostics.push(
        diag(codes.SYSTEM_MODULE_PATH_INVALID, "error", "system_config", modulePathRel, `Module '${moduleId}' path is not a directory`, {
          module_id: moduleId,
          field: "path",
          expected: "directory",
          actual: "file",
        }),
      );
    }

    diagnostics.push(...validateRequiredModuleBundles(systemRootAbs, moduleId, registryEntry.version));
    diagnostics.push(...validateActiveModuleSkills(systemRootAbs, moduleId, registryEntry.version, registryEntry.skills));
  }

  return diagnostics;
}

function validateRequiredModuleBundles(systemRootAbs: string, moduleId: string, activeVersion: number): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  for (let version = 1; version <= activeVersion; version += 1) {
    const bundlePath = inferredModuleBundlePath(moduleId, version);
    const bundlePathAbs = resolve(systemRootAbs, bundlePath);
    const bundlePathRel = toRepoRelative(bundlePathAbs);
    const bundleStat = safeStat(bundlePathAbs);

    if (!bundleStat) {
      diagnostics.push(
        diag(codes.SYSTEM_MODULE_BUNDLE_INVALID, "error", "system_config", bundlePathRel, `Required module version bundle for module '${moduleId}' does not exist`, {
          module_id: moduleId,
          reason: reasons.SYSTEM_MODULE_BUNDLE_MISSING,
          expected: "existing directory",
          actual: "missing",
          hint: `Author contiguous version bundles from v1 through v${activeVersion}.`,
        }),
      );
      continue;
    }

    if (!bundleStat.isDirectory()) {
      diagnostics.push(
        diag(codes.SYSTEM_MODULE_BUNDLE_INVALID, "error", "system_config", bundlePathRel, `Required module version bundle for module '${moduleId}' is not a directory`, {
          module_id: moduleId,
          reason: reasons.SYSTEM_MODULE_BUNDLE_NOT_DIRECTORY,
          expected: "directory",
          actual: "file",
          hint: "Store each module version as a directory bundle containing module.ts and related assets.",
        }),
      );
      continue;
    }

    diagnostics.push(...validateModuleEntryPresence(systemRootAbs, moduleId, version));

    if (version > 1) {
      diagnostics.push(...validateMigrationAssets(systemRootAbs, moduleId, version));
    }
  }

  return diagnostics;
}

function validateModuleEntryPresence(systemRootAbs: string, moduleId: string, version: number): CompilerDiagnostic[] {
  const shapePath = inferredModuleEntryPath(moduleId, version);
  const shapePathAbs = resolve(systemRootAbs, shapePath);
  const shapePathRel = toRepoRelative(shapePathAbs);
  const shapeStat = safeStat(shapePathAbs);

  if (!shapeStat) {
    return [
      diag(codes.SHAPE_FILE_MISSING, "error", "module_shape", shapePathRel, `Inferred module entrypoint for module '${moduleId}' does not exist`, {
        module_id: moduleId,
        reason: reasons.SYSTEM_SHAPE_FILE_MISSING,
        expected: shapePath,
        actual: "missing",
        hint: "Add module.ts to the required module version bundle.",
      }),
    ];
  }

  if (!shapeStat.isFile()) {
    return [
      diag(codes.SHAPE_FILE_MISSING, "error", "module_shape", shapePathRel, `Inferred module entrypoint for module '${moduleId}' is not a file`, {
        module_id: moduleId,
        reason: reasons.SYSTEM_SHAPE_FILE_NOT_FILE,
        expected: "file",
        actual: "directory",
        hint: "Store the module entrypoint at module.ts inside the version bundle.",
      }),
    ];
  }

  return [];
}

function validateActiveModuleSkills(
  systemRootAbs: string,
  moduleId: string,
  activeVersion: number,
  skills: string[],
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const skillsPath = inferredSkillsPath(moduleId, activeVersion);
  const skillsPathAbs = resolve(systemRootAbs, skillsPath);
  const skillsPathRel = toRepoRelative(skillsPathAbs);
  const skillsStat = safeStat(skillsPathAbs);

  if (skills.length === 0) {
    if (!skillsStat) {
      return [];
    }

    if (!skillsStat.isDirectory()) {
      return [
        diag(codes.SYSTEM_MODULE_SKILLS_INVALID, "error", "system_config", skillsPathRel, `Active skills path for module '${moduleId}' is not a directory`, {
          module_id: moduleId,
          reason: reasons.SYSTEM_SKILLS_DIR_NOT_DIRECTORY,
          expected: "directory or missing path",
          actual: "file",
          hint: "Either omit skills/ entirely for skills: [] or store active skills as directories.",
        }),
      ];
    }
  } else {
    if (!skillsStat) {
      return [
        diag(codes.SYSTEM_MODULE_SKILLS_INVALID, "error", "system_config", skillsPathRel, `Active skills directory for module '${moduleId}' does not exist`, {
          module_id: moduleId,
          reason: reasons.SYSTEM_SKILLS_DIR_MISSING,
          expected: "existing directory",
          actual: "missing",
          hint: "Add skills/<skill-id>/SKILL.md for every listed active skill.",
        }),
      ];
    }

    if (!skillsStat.isDirectory()) {
      return [
        diag(codes.SYSTEM_MODULE_SKILLS_INVALID, "error", "system_config", skillsPathRel, `Active skills path for module '${moduleId}' is not a directory`, {
          module_id: moduleId,
          reason: reasons.SYSTEM_SKILLS_DIR_NOT_DIRECTORY,
          expected: "directory",
          actual: "file",
          hint: "Store active skills under skills/<skill-id>/SKILL.md.",
        }),
      ];
    }
  }

  const skillsDir = safeReadDir(skillsPathAbs);
  if (skillsDir.error) {
    return diagnostics.concat(
      diag(codes.SYSTEM_MODULE_SKILLS_INVALID, "error", "system_config", skillsPathRel, `Could not read active skills directory for module '${moduleId}'`, {
        module_id: moduleId,
        reason: reasons.SYSTEM_SKILLS_DIR_UNREADABLE,
        expected: "readable directory",
        actual: {
          code: skillsDir.error.code ?? null,
          message: skillsDir.error.message,
        },
        hint: "Check file permissions and directory structure for the active skills bundle.",
      }),
    );
  }

  const expectedSkillIds = new Set(skills);

  for (const skillId of skills) {
    const entryPath = inferredSkillEntryPath(moduleId, activeVersion, skillId);
    const entryPathAbs = resolve(systemRootAbs, entryPath);
    const entryPathRel = toRepoRelative(entryPathAbs);
    const entryStat = safeStat(entryPathAbs);

    if (!entryStat) {
      diagnostics.push(
        diag(codes.SYSTEM_MODULE_SKILLS_INVALID, "error", "system_config", entryPathRel, `Active skill entrypoint for module '${moduleId}' does not exist`, {
          module_id: moduleId,
          field: skillId,
          reason: reasons.SYSTEM_SKILL_ENTRY_MISSING,
          expected: entryPath,
          actual: "missing",
          hint: "Add SKILL.md to the listed skill bundle.",
        }),
      );
      continue;
    }

    if (!entryStat.isFile()) {
      diagnostics.push(
        diag(codes.SYSTEM_MODULE_SKILLS_INVALID, "error", "system_config", entryPathRel, `Active skill entrypoint for module '${moduleId}' is not a file`, {
          module_id: moduleId,
          field: skillId,
          reason: reasons.SYSTEM_SKILL_ENTRY_NOT_FILE,
          expected: "file",
          actual: "directory",
          hint: "Each listed skill bundle must contain a SKILL.md entrypoint file.",
        }),
      );
    }
  }

  if (!skillsStat || !skillsStat.isDirectory()) {
    return diagnostics;
  }

  for (const entry of skillsDir.entries) {
    const entryPathRel = toRepoRelative(resolve(skillsPathAbs, entry.name));
    if (!entry.isDirectory()) {
      diagnostics.push(
        diag(codes.SYSTEM_MODULE_SKILLS_INVALID, "error", "system_config", entryPathRel, `Unexpected non-directory entry in active skills directory for module '${moduleId}'`, {
          module_id: moduleId,
          reason: reasons.SYSTEM_SKILLS_UNEXPECTED_ROOT_FILE,
          expected: "listed skill directories only",
          actual: entry.name,
          hint: "Move supporting files inside a listed skill directory instead of the skills/ root.",
        }),
      );
      continue;
    }

    if (!expectedSkillIds.has(entry.name)) {
      diagnostics.push(
        diag(codes.SYSTEM_MODULE_SKILLS_INVALID, "error", "system_config", entryPathRel, `Unlisted skill directory '${entry.name}' exists for module '${moduleId}'`, {
          module_id: moduleId,
          field: entry.name,
          reason: reasons.SYSTEM_SKILLS_UNLISTED_DIRECTORY,
          expected: [...expectedSkillIds],
          actual: entry.name,
          hint: "List the skill in .als/system.ts or remove it from the active bundle.",
        }),
      );
    }
  }

  return diagnostics;
}

function validateMigrationAssets(systemRootAbs: string, moduleId: string, version: number): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const migrationsPath = inferredMigrationsPath(moduleId, version);
  const migrationsPathAbs = resolve(systemRootAbs, migrationsPath);
  const migrationsPathRel = toRepoRelative(migrationsPathAbs);
  const migrationsStat = safeStat(migrationsPathAbs);

  if (!migrationsStat) {
    return [
      diag(codes.SYSTEM_MODULE_MIGRATIONS_INVALID, "error", "system_config", migrationsPathRel, `Required migrations directory for module '${moduleId}' version v${version} does not exist`, {
        module_id: moduleId,
        reason: reasons.SYSTEM_MIGRATIONS_DIR_MISSING,
        expected: "existing directory",
        actual: "missing",
        hint: "Author inbound migration assets on the target version bundle for every vK where K > 1.",
      }),
    ];
  }

  if (!migrationsStat.isDirectory()) {
    return [
      diag(codes.SYSTEM_MODULE_MIGRATIONS_INVALID, "error", "system_config", migrationsPathRel, `Required migrations path for module '${moduleId}' version v${version} is not a directory`, {
        module_id: moduleId,
        reason: reasons.SYSTEM_MIGRATIONS_DIR_NOT_DIRECTORY,
        expected: "directory",
        actual: "file",
        hint: "Store inbound migration assets under vK/migrations/ on the target version bundle.",
      }),
    ];
  }

  const manifestPath = `${migrationsPath}/MANIFEST.md`;
  const manifestPathAbs = resolve(systemRootAbs, manifestPath);
  const manifestPathRel = toRepoRelative(manifestPathAbs);
  const manifestStat = safeStat(manifestPathAbs);

  if (!manifestStat) {
    diagnostics.push(
      diag(codes.SYSTEM_MODULE_MIGRATIONS_INVALID, "error", "system_config", manifestPathRel, `Migration manifest for module '${moduleId}' version v${version} does not exist`, {
        module_id: moduleId,
        reason: reasons.SYSTEM_MIGRATION_MANIFEST_MISSING,
        expected: manifestPath,
        actual: "missing",
        hint: "Add MANIFEST.md to the target bundle's migrations directory.",
      }),
    );
  } else if (!manifestStat.isFile()) {
    diagnostics.push(
      diag(codes.SYSTEM_MODULE_MIGRATIONS_INVALID, "error", "system_config", manifestPathRel, `Migration manifest for module '${moduleId}' version v${version} is not a file`, {
        module_id: moduleId,
        reason: reasons.SYSTEM_MIGRATION_MANIFEST_NOT_FILE,
        expected: "file",
        actual: "directory",
        hint: "Store the migration manifest as MANIFEST.md.",
      }),
    );
  }

  const artifactScan = findAdditionalMigrationArtifact(migrationsPathAbs);
  if (artifactScan.error) {
    diagnostics.push(
      diag(codes.SYSTEM_MODULE_MIGRATIONS_INVALID, "error", "system_config", migrationsPathRel, `Could not read migration assets for module '${moduleId}' version v${version}`, {
        module_id: moduleId,
        reason: reasons.SYSTEM_MIGRATION_ASSET_MISSING,
        expected: "readable migration artifact directory",
        actual: {
          code: artifactScan.error.code ?? null,
          message: artifactScan.error.message,
        },
        hint: "Check file permissions inside the migrations directory.",
      }),
    );
  } else if (!artifactScan.found) {
    diagnostics.push(
      diag(codes.SYSTEM_MODULE_MIGRATIONS_INVALID, "error", "system_config", migrationsPathRel, `Migration assets for module '${moduleId}' version v${version} must include at least one file besides MANIFEST.md`, {
        module_id: moduleId,
        reason: reasons.SYSTEM_MIGRATION_ASSET_MISSING,
        expected: "MANIFEST.md plus at least one additional migration artifact",
        actual: "MANIFEST.md only",
        hint: "Add a script, prompt bundle, or another executable migration artifact beside MANIFEST.md.",
      }),
    );
  }

  return diagnostics;
}

function resolveModulePath(systemRootAbs: string, modulePath: string): string {
  return resolve(systemRootAbs, modulePath);
}

function describeModulePathConflict(
  moduleId: string,
  modulePath: string,
  modulePathSegments: string[],
  overlappingModuleId: string,
  overlappingModulePath: string,
  overlappingModuleSegments: string[],
): string {
  if (modulePath === overlappingModulePath) {
    return `Module '${moduleId}' duplicates mount path '${modulePath}' already used by '${overlappingModuleId}'`;
  }

  if (isPathPrefix(modulePathSegments, overlappingModuleSegments)) {
    return `Module '${moduleId}' mount path '${modulePath}' is an ancestor of '${overlappingModuleId}' at '${overlappingModulePath}'`;
  }

  return `Module '${moduleId}' mount path '${modulePath}' is nested under '${overlappingModuleId}' at '${overlappingModulePath}'`;
}

function safeStat(pathAbs: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(pathAbs);
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === "ENOENT" || errorCode === "ENOTDIR") {
        return null;
      }
    }

    throw error;
  }
}

function buildDelamainFileTargetDiagnostic(
  moduleId: string,
  shapePathRel: string,
  fieldPath: string,
  delamainName: string,
  authoredPath: string,
  statResult: SafeStatResult,
): CompilerDiagnostic {
  if (statResult.kind === "missing") {
    return diag(
      codes.DELAMAIN_FILE_INVALID,
      "error",
      "module_shape",
      shapePathRel,
      `Delamain '${delamainName}' registry path could not be resolved`,
      {
        module_id: moduleId,
        field: fieldPath,
        reason: reasons.DELAMAIN_BUNDLE_TARGET_MISSING,
        expected: "existing Delamain primary file",
        actual: authoredPath,
      },
    );
  }

  return diag(
    codes.DELAMAIN_FILE_INVALID,
    "error",
    "module_shape",
    shapePathRel,
    `Could not read Delamain '${delamainName}' registry target`,
    {
      module_id: moduleId,
      field: fieldPath,
      reason: reasons.DELAMAIN_BUNDLE_TARGET_UNREADABLE,
      expected: "readable Delamain primary file",
      actual: {
        code: statResult.error.code ?? null,
        message: statResult.error.message,
      },
    },
  );
}

function buildDelamainAssetTargetDiagnostic(
  moduleId: string,
  fileRel: string,
  fieldPath: string,
  authoredPath: string,
  statResult: SafeStatResult,
): CompilerDiagnostic {
  if (statResult.kind === "missing") {
    return diag(
      codes.DELAMAIN_FILE_INVALID,
      "error",
      "module_shape",
      fileRel,
      "Delamain prompt asset path could not be resolved",
      {
        module_id: moduleId,
        field: fieldPath,
        reason: reasons.DELAMAIN_ASSET_TARGET_MISSING,
        expected: "existing markdown prompt asset",
        actual: authoredPath,
      },
    );
  }

  return diag(
    codes.DELAMAIN_FILE_INVALID,
    "error",
    "module_shape",
    fileRel,
    "Could not read Delamain prompt asset",
    {
      module_id: moduleId,
      field: fieldPath,
      reason: reasons.DELAMAIN_ASSET_TARGET_UNREADABLE,
      expected: "readable markdown prompt asset",
      actual: {
        code: statResult.error.code ?? null,
        message: statResult.error.message,
      },
    },
  );
}

function isPathInsideRoot(rootAbs: string, candidateAbs: string): boolean {
  const relativePath = relative(rootAbs, candidateAbs).replace(/\\/g, "/");
  if (relativePath === "") return true;
  return relativePath !== ".." && !relativePath.startsWith("../") && !isAbsolute(relativePath);
}

function resolvePathInsideRoot(rootAbs: string, authoredPath: string): string | null {
  const resolvedPath = resolve(rootAbs, authoredPath);
  return isPathInsideRoot(rootAbs, resolvedPath) ? resolvedPath : null;
}

function safeStatResult(pathAbs: string): SafeStatResult {
  try {
    return {
      kind: "ok",
      stat: statSync(pathAbs),
    };
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === "ENOENT" || errorCode === "ENOTDIR") {
        return { kind: "missing" };
      }
      if (errorCode === "EACCES" || errorCode === "EPERM") {
        return {
          kind: "unreadable",
          error: error as NodeJS.ErrnoException,
        };
      }
    }

    throw error;
  }
}

function safeReadDir(pathAbs: string): { entries: Dirent[]; error: null } | { entries: null; error: NodeJS.ErrnoException } {
  try {
    return {
      entries: readdirSync(pathAbs, { withFileTypes: true }),
      error: null,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === "EACCES" || errorCode === "EPERM" || errorCode === "ENOENT" || errorCode === "ENOTDIR") {
        return {
          entries: null,
          error: error as NodeJS.ErrnoException,
        };
      }
    }

    throw error;
  }
}

function safeReadTextFile(pathAbs: string): { contents: string; error: null } | { contents: null; error: NodeJS.ErrnoException } {
  try {
    return {
      contents: readFileSync(pathAbs, "utf-8"),
      error: null,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === "EACCES" || errorCode === "EPERM" || errorCode === "ENOENT" || errorCode === "ENOTDIR" || errorCode === "EISDIR") {
        return {
          contents: null,
          error: error as NodeJS.ErrnoException,
        };
      }
    }

    throw error;
  }
}

function discoverRecordFiles(rootAbs: string, moduleId: string): RecordDiscoveryResult {
  const result: RecordDiscoveryResult = {
    record_file_paths: [],
    errored_file_paths: [],
    ignored_file_paths: [],
    diagnostics: [],
  };

  function walk(dir: string): void {
    const readDirResult = safeReadDir(dir);
    if (readDirResult.error) {
      result.diagnostics.push(
        diag(
          codes.PARSE_DISCOVERY_UNREADABLE_DIR,
          "error",
          "parse",
          toRepoRelative(dir),
          `Could not read directory during discovery`,
          {
            module_id: moduleId,
            expected: "readable directory",
            actual: {
              code: readDirResult.error.code ?? null,
              message: readDirResult.error.message,
            },
            hint: "Check directory permissions and rerun validation.",
          },
        ),
      );
      return;
    }

    const entries = readDirResult.entries;
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      if (isReservedAgentMarkdownFile(entry.name)) {
        result.ignored_file_paths.push(fullPath);
        continue;
      }

      const sourceFormat = detectRecordSourceFormat(entry.name);
      if (!sourceFormat) continue;

      if (sourceFormat === "markdown" && !hasCanonicalMarkdownExtension(entry.name)) {
        result.errored_file_paths.push(fullPath);
        result.diagnostics.push(
          diag(
            codes.PARSE_MARKDOWN_EXTENSION_CASE,
            "error",
            "parse",
            toRepoRelative(fullPath),
            `Non-reserved markdown files must use lowercase '.md' extension`,
            {
              module_id: moduleId,
              expected: "lowercase .md extension",
              actual: entry.name,
              hint: "Rename the file to use lowercase '.md', or use AGENTS.md/CLAUDE.md if it is an agent instruction file.",
            },
          ),
        );
        continue;
      }

      if (sourceFormat === "jsonl" && !hasCanonicalJsonlExtension(entry.name)) {
        result.errored_file_paths.push(fullPath);
        result.diagnostics.push(
          diag(
            codes.PARSE_JSONL_EXTENSION_CASE,
            "error",
            "parse",
            toRepoRelative(fullPath),
            "JSONL record files must use lowercase '.jsonl' extension",
            {
              module_id: moduleId,
              expected: "lowercase .jsonl extension",
              actual: entry.name,
              hint: "Rename the file to use lowercase '.jsonl'.",
            },
          ),
        );
        continue;
      }

      result.record_file_paths.push(fullPath);
    }
  }

  walk(rootAbs);
  result.errored_file_paths.sort();
  result.record_file_paths.sort();
  result.ignored_file_paths.sort();
  return result;
}

function detectRecordSourceFormat(fileName: string): "markdown" | "jsonl" | null {
  const lowerFileName = fileName.toLowerCase();
  if (lowerFileName.endsWith(".md")) return "markdown";
  if (lowerFileName.endsWith(".jsonl")) return "jsonl";
  return null;
}

function hasCanonicalMarkdownExtension(fileName: string): boolean {
  return fileName.endsWith(".md");
}

function hasCanonicalJsonlExtension(fileName: string): boolean {
  return fileName.endsWith(".jsonl");
}

function isReservedAgentMarkdownFile(fileName: string): boolean {
  const lowerFileName = fileName.toLowerCase();
  return lowerFileName === "agents.md" || lowerFileName === "claude.md";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAuthoredSourceFile<T>(
  fileAbs: string,
  exportName: "system" | "module" | "delamain",
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: ZodError } },
  phase: "system_config" | "module_shape",
  code: string,
  module_id: string | null,
): { success: true; data: T; diagnostics: CompilerDiagnostic[] } | { success: false; diagnostics: CompilerDiagnostic[] } {
  const fileRel = toRepoRelative(fileAbs);
  const loadedSource = loadAuthoredSourceExport(fileAbs, exportName, phase, code, module_id);
  if (!loadedSource.success) {
    return loadedSource;
  }

  const raw = loadedSource.data;

  const rawDiagnostics = phase === "module_shape"
    ? collectRemovedSourceSchemaDiagnostics(raw, phase, fileRel, module_id).concat(
      findLegacyRequiredIssues(raw).map((issue) =>
        diag(code, "error", phase, fileRel, issue.message, {
          module_id: module_id ?? undefined,
          field: issue.path.join(".") || null,
          reason: reasons.SHAPE_LEGACY_REQUIRED_KEY,
          expected: "field/section definition without legacy required key",
          actual: issue.path,
        }),
      ),
    )
    : collectRemovedSourceSchemaDiagnostics(raw, phase, fileRel, module_id).concat(
      collectRemovedSystemSkillDiagnostics(raw, fileRel),
    );
  const parsed = schema.safeParse(raw);
  if (parsed.success && rawDiagnostics.length === 0) {
    return {
      success: true,
      data: parsed.data,
      diagnostics: [],
    };
  }

  if (parsed.success) {
    return {
      success: false,
      diagnostics: rawDiagnostics,
    };
  }

  return {
    success: false,
    diagnostics: rawDiagnostics.concat(
      parsed.error.issues.map((issue) =>
        diag(resolveParseIssueCode(code, phase, issue), "error", phase, fileRel, resolveParseIssueMessage(phase, issue), {
          module_id: module_id ?? undefined,
          field: issue.path.join(".") || null,
          reason: resolveParseIssueReason(phase, issue),
          expected: issue.code,
          actual: issue.path,
        }),
      ),
    ),
  };
}

function parseFrontmatter(source: string) {
  try {
    return matter(source);
  } catch (error) {
    throw new FrontmatterProcessingError(
      `Failed to parse frontmatter: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function resolveParseIssueMessage(
  phase: "system_config" | "module_shape",
  issue: ZodError["issues"][number],
): string {
  if (
    phase === "system_config"
    && issue.path[0] === "modules"
    && typeof issue.path[1] === "string"
    && issue.path[2] === "description"
  ) {
    const moduleId = issue.path[1];
    if (issue.code === "invalid_type") {
      return `module ${moduleId} description is required and must be a trimmed single-line string no longer than ${SYSTEM_MODULE_DESCRIPTION_MAX_LENGTH} characters`;
    }

    if (typeof issue.message === "string") {
      if (issue.message === "module_description.blank") {
        return `module ${moduleId} description must be a non-empty trimmed single-line string no longer than ${SYSTEM_MODULE_DESCRIPTION_MAX_LENGTH} characters`;
      }

      if (issue.message === "module_description.trimmed") {
        return `module ${moduleId} description must not start or end with whitespace and must stay within ${SYSTEM_MODULE_DESCRIPTION_MAX_LENGTH} characters`;
      }

      if (issue.message === "module_description.single_line") {
        return `module ${moduleId} description must stay on a single line and within ${SYSTEM_MODULE_DESCRIPTION_MAX_LENGTH} characters`;
      }

      if (issue.message === "module_description.too_long") {
        return `module ${moduleId} description must be ${SYSTEM_MODULE_DESCRIPTION_MAX_LENGTH} characters or fewer`;
      }
    }

    return `module ${moduleId} description must be a trimmed single-line string no longer than ${SYSTEM_MODULE_DESCRIPTION_MAX_LENGTH} characters`;
  }

  return issue.message;
}

function resolveParseIssueCode(
  defaultCode: string,
  phase: "system_config" | "module_shape",
  issue: ZodError["issues"][number],
): string {
  if (phase === "system_config" && issue.path[0] === "als_version") {
    return codes.SYSTEM_ALS_VERSION_INVALID;
  }

  if (
    phase === "system_config"
    && issue.code === "custom"
    && issue.path[0] === "modules"
    && issue.path[2] === "path"
    && typeof issue.message === "string"
    && issue.message.includes("mount path")
  ) {
    return codes.SYSTEM_MODULE_PATH_CONFLICT;
  }

  return defaultCode;
}

function resolveParseIssueReason(
  phase: "system_config" | "module_shape",
  issue: ZodError["issues"][number],
): string | undefined {
  if (phase === "system_config" && issue.path[0] === "als_version") {
    return reasons.SYSTEM_ALS_VERSION_INVALID;
  }

  if (
    phase === "system_config"
    && issue.code === "custom"
    && issue.path[0] === "modules"
    && issue.path[2] === "description"
  ) {
    return reasons.SYSTEM_MODULE_DESCRIPTION_INVALID;
  }

  if (
    phase === "system_config"
    && issue.code === "invalid_type"
    && issue.path[0] === "modules"
    && issue.path[2] === "description"
  ) {
    return reasons.SYSTEM_MODULE_DESCRIPTION_INVALID;
  }

  if (
    phase === "system_config"
    && issue.code === "custom"
    && issue.path[0] === "modules"
    && issue.path[2] === "skills"
  ) {
    if (typeof issue.message === "string" && issue.message.includes("already used by module")) {
      return reasons.SYSTEM_SKILLS_GLOBAL_DUPLICATE;
    }
    return reasons.SYSTEM_SKILLS_DUPLICATE;
  }

  return undefined;
}

function getSelectedModuleIds(
  systemConfig: SystemConfig,
  moduleFilter: string | undefined,
  systemConfigPathAbs: string,
  systemDiagnostics: CompilerDiagnostic[],
): string[] {
  const moduleIds = Object.keys(systemConfig.modules).sort();
  if (!moduleFilter) return moduleIds;

  if (!systemConfig.modules[moduleFilter]) {
    systemDiagnostics.push(
      diag(codes.SYSTEM_FILTER_UNKNOWN, "error", "system_config", toRepoRelative(systemConfigPathAbs), `Unknown module filter '${moduleFilter}'`, {
        expected: moduleIds,
        actual: moduleFilter,
      }),
    );
    return [];
  }

  return [moduleFilter];
}

function collectFilteredContextDiagnostics(
  moduleFilter: string,
  reportingModuleIds: string[],
  moduleStates: ModuleWorkState[],
  systemConfigPathAbs: string,
): CompilerDiagnostic[] {
  const reportingModuleIdSet = new Set(reportingModuleIds);
  // Warnings do not currently affect record indexing or ref-resolution trust.
  const invalidContextStates = moduleStates
    .filter((state) => !reportingModuleIdSet.has(state.module_id) && computeStatus(state.diagnostics) === "fail");
  const invalidContextModuleIds = invalidContextStates.map((state) => state.module_id).sort();

  if (invalidContextModuleIds.length === 0) {
    return [];
  }

  const hasPossiblyTruncatedClosure = invalidContextStates.some((state) => state.context === null);
  const hint = hasPossiblyTruncatedClosure
    ? "Run full-system validation or fix the dependency modules before relying on filtered validation. Some dependency module shapes could not be loaded, so transitive dependencies beyond them may not have been loaded."
    : "Run full-system validation or fix the dependency modules before relying on filtered validation.";

  return [
    diag(
      codes.SYSTEM_FILTER_CONTEXT_INVALID,
      "error",
      "system_config",
      toRepoRelative(systemConfigPathAbs),
      `Filtered validation for module '${moduleFilter}' cannot produce trustworthy results because dependency context is invalid`,
      {
        field: "module_filter",
        reason: reasons.SYSTEM_FILTER_CONTEXT_INVALID,
        expected: "clean dependency closure",
        actual: invalidContextModuleIds,
        hint,
      },
    ),
  ];
}

function collectRemovedSourceSchemaDiagnostics(
  raw: unknown,
  phase: "system_config" | "module_shape",
  fileRel: string,
  module_id: string | null,
): CompilerDiagnostic[] {
  if (!isPlainObject(raw) || !Object.hasOwn(raw, "schema")) {
    return [];
  }

  const reason = phase === "system_config" ? reasons.SYSTEM_SCHEMA_REMOVED : reasons.MODULE_SHAPE_SCHEMA_REMOVED;
  const expected = phase === "system_config"
    ? "system config without top-level schema field"
    : "module shape without top-level schema field";

  return [
    diag(
      phase === "system_config" ? codes.SYSTEM_INVALID : codes.SHAPE_INVALID,
      "error",
      phase,
      fileRel,
      "Top-level source field 'schema' has been removed from ALS v1 authored source",
      {
        module_id: module_id ?? undefined,
        field: "schema",
        reason,
        expected,
        actual: raw.schema,
        hint: "Remove the top-level 'schema' field and rely on als_version plus file location instead.",
      },
    ),
  ];
}

function collectRemovedSystemSkillDiagnostics(
  raw: unknown,
  fileRel: string,
): CompilerDiagnostic[] {
  if (!isPlainObject(raw) || !isPlainObject(raw.modules)) {
    return [];
  }

  const diagnostics: CompilerDiagnostic[] = [];

  for (const [moduleId, moduleConfig] of Object.entries(raw.modules)) {
    if (!isPlainObject(moduleConfig) || !Object.hasOwn(moduleConfig, "skill")) {
      continue;
    }

    diagnostics.push(
      diag(codes.SYSTEM_INVALID, "error", "system_config", fileRel, "Module source field 'skill' has been removed from ALS v1 system configuration", {
        module_id: moduleId,
        field: `modules.${moduleId}.skill`,
        reason: reasons.SYSTEM_SKILL_REMOVED,
        expected: "module config using 'skills' array",
        actual: moduleConfig.skill,
        hint: "Replace 'skill' with 'skills: [<skill-id>]' and author the skill bundle under the active version directory.",
      }),
    );
  }

  return diagnostics;
}

function validateAlsVersionSupport(
  systemConfig: SystemConfig,
  systemConfigPathAbs: string,
): CompilerDiagnostic[] {
  if (isSupportedAlsVersion(systemConfig.als_version)) {
    return [];
  }

  return [
    diag(
      codes.SYSTEM_ALS_VERSION_UNSUPPORTED,
      "error",
      "system_config",
      toRepoRelative(systemConfigPathAbs),
      `ALS version '${systemConfig.als_version}' is not supported by this compiler`,
      {
        field: "als_version",
        reason: reasons.SYSTEM_ALS_VERSION_UNSUPPORTED,
        expected: [...SUPPORTED_ALS_VERSIONS],
        actual: systemConfig.als_version,
        hint: "Upgrade the compiler or rewrite the system to a supported ALS version before validating.",
      },
    ),
  ];
}

function buildModuleReport(
  moduleId: string,
  modulePathRel: string,
  moduleVersion: number,
  diagnostics: CompilerDiagnostic[],
  filesChecked: number,
  filesIgnored: number,
  fileErrorMap: Map<string, boolean>,
): ModuleValidationReport {
  // Directory discovery errors can still leave a module in status "fail" with files_failed: 0.
  // That is intentional: the file counters remain file-based and exclude unreadable directory paths.
  const summary: ModuleValidationSummary = {
    files_checked: filesChecked,
    files_passed: filesChecked - [...fileErrorMap.values()].filter(Boolean).length,
    files_failed: [...fileErrorMap.values()].filter(Boolean).length,
    files_ignored: filesIgnored,
    error_count: diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
    warning_count: diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
  };

  return {
    status: computeStatus(diagnostics),
    module_id: moduleId,
    module_path: modulePathRel,
    module_version: moduleVersion,
    diagnostics,
    summary,
  };
}

function buildSystemOutput(
  systemPathRel: string,
  systemDiagnostics: CompilerDiagnostic[],
  moduleReports: ModuleValidationReport[],
  alsVersion: number | null,
  moduleFilter: string | null,
): SystemValidationOutput {
  const diagnostics = systemDiagnostics.concat(moduleReports.flatMap((report) => report.diagnostics));
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;

  const filesChecked = moduleReports.reduce((sum, report) => sum + report.summary.files_checked, 0);
  const filesPassed = moduleReports.reduce((sum, report) => sum + report.summary.files_passed, 0);
  const filesFailed = moduleReports.reduce((sum, report) => sum + report.summary.files_failed, 0);
  const filesIgnored = moduleReports.reduce((sum, report) => sum + report.summary.files_ignored, 0);

  return {
    schema: VALIDATION_OUTPUT_SCHEMA_LITERAL,
    als_version: alsVersion,
    compiler_contract: {
      supported_als_versions: [...SUPPORTED_ALS_VERSIONS],
      upgrade_mode: ALS_UPGRADE_MODE,
      upgrade_assistance: ALS_UPGRADE_ASSISTANCE,
    },
    status: computeStatus(diagnostics),
    system_path: systemPathRel,
    generated_at: new Date().toISOString(),
    module_filter: moduleFilter,
    system_diagnostics: systemDiagnostics,
    modules: moduleReports,
    summary: {
      modules_checked: moduleReports.length,
      modules_failed: moduleReports.filter((report) => report.status === "fail").length,
      files_checked: filesChecked,
      files_passed: filesPassed,
      files_failed: filesFailed,
      files_ignored: filesIgnored,
      error_count: errorCount,
      warning_count: warningCount,
    },
  };
}

function markErroredFiles(fileErrorMap: Map<string, boolean>, diagnostics: CompilerDiagnostic[]): void {
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity !== "error") continue;
    if (!fileErrorMap.has(diagnostic.file)) continue;
    fileErrorMap.set(diagnostic.file, true);
  }
}

function findAdditionalMigrationArtifact(
  directoryAbs: string,
): { found: boolean; error: NodeJS.ErrnoException | null } {
  const readDirResult = safeReadDir(directoryAbs);
  if (readDirResult.error) {
    return { found: false, error: readDirResult.error };
  }

  for (const entry of readDirResult.entries) {
    const entryPathAbs = resolve(directoryAbs, entry.name);

    if (entry.isFile()) {
      if (entry.name !== "MANIFEST.md") {
        return { found: true, error: null };
      }
      continue;
    }

    if (!entry.isDirectory()) {
      continue;
    }

    const nested = findAdditionalMigrationArtifact(entryPathAbs);
    if (nested.error) {
      return nested;
    }
    if (nested.found) {
      return nested;
    }
  }

  return { found: false, error: null };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
