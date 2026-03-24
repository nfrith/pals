import { basename, join, relative, resolve } from "node:path";
import { readFileSync, readdirSync, statSync, type Dirent } from "node:fs";
import matter from "gray-matter";
import { parse as parseYaml, YAMLParseError } from "yaml";
import { ZodError } from "zod";
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
  isPathPrefix,
  moduleShapeSchema,
  modulePathsOverlap,
  splitModuleMountPath,
  systemConfigSchema,
  type EntityShape,
  type FieldShape,
  type ModuleShape,
  type SectionDefinitionShape,
  type SectionShape,
  type TitleShape,
  type SystemConfig,
  type VariantEntityShape,
} from "./schema.ts";
import type { CompilerDiagnostic, ModuleValidationReport, ModuleValidationSummary, SystemValidationOutput } from "./types.ts";

interface LoadedModuleContext {
  system_id: string;
  module_id: string;
  module_path_abs: string;
  module_path_rel: string;
  shape_path_abs: string;
  shape_path_rel: string;
  module_version: number;
  shape: ModuleShape;
  templates: Map<string, ParsedPathTemplate>;
}

interface ParsedRecord {
  module_id: string;
  file_abs: string;
  file_rel: string;
  file_rel_within_module: string;
  entity_name: string;
  entity_shape: EntityShape;
  frontmatter: Record<string, unknown>;
  body: ParsedBody;
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

interface MarkdownDiscoveryResult {
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

export interface EffectiveEntityContractContext {
  module_id: string;
  entity_name: string;
  record_file: string;
  shape_file: string;
}

export function validateSystem(systemRootInput: string, moduleFilter?: string): SystemValidationOutput {
  const systemRootAbs = resolve(systemRootInput);
  const systemRootRel = toRepoRelative(systemRootAbs);
  const systemDiagnostics: CompilerDiagnostic[] = [];
  const moduleReports: ModuleValidationReport[] = [];

  const systemConfigPathAbs = resolve(systemRootAbs, ".als/system.yaml");
  const parsedSystem = parseYamlFile<SystemConfig>(systemConfigPathAbs, systemConfigSchema, "system_config", codes.SYSTEM_INVALID, null);

  if (!parsedSystem.success) {
    return buildSystemOutput(systemRootRel, systemDiagnostics.concat(parsedSystem.diagnostics), moduleReports, null);
  }

  const systemConfig = parsedSystem.data;
  const alsVersionDiagnostics = validateAlsVersionSupport(systemConfig, systemConfigPathAbs);
  if (alsVersionDiagnostics.length > 0) {
    return buildSystemOutput(systemRootRel, systemDiagnostics.concat(alsVersionDiagnostics), moduleReports, systemConfig.als_version);
  }

  const selectedModuleIds = getSelectedModuleIds(systemConfig, moduleFilter, systemConfigPathAbs, systemDiagnostics);
  if (selectedModuleIds.length === 0) {
    return buildSystemOutput(systemRootRel, systemDiagnostics, moduleReports, systemConfig.als_version);
  }

  const layoutDiagnostics = validateSystemLayout(systemRootAbs, systemConfig);
  if (layoutDiagnostics.length > 0) {
    return buildSystemOutput(systemRootRel, systemDiagnostics.concat(layoutDiagnostics), moduleReports, systemConfig.als_version);
  }

  const moduleStates = selectedModuleIds.map((moduleId) => loadModuleState(systemRootAbs, systemConfig, moduleId));
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
      const recordDiagnostics = validateRecord(record, state.context, recordIndex);
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

  return buildSystemOutput(systemRootRel, systemDiagnostics, moduleReports, systemConfig.als_version);
}

function loadModuleState(systemRootAbs: string, systemConfig: SystemConfig, moduleId: string): ModuleWorkState {
  const registryEntry = systemConfig.modules[moduleId];
  const modulePathAbs = resolveModulePath(systemRootAbs, registryEntry.path);
  const modulePathRel = toRepoRelative(modulePathAbs);
  const shapePathAbs = resolve(systemRootAbs, inferredShapePath(moduleId, registryEntry.version));
  const shapePathRel = toRepoRelative(shapePathAbs);

  const shapeResult = parseYamlFile<ModuleShape>(shapePathAbs, moduleShapeSchema, "module_shape", codes.SHAPE_INVALID, moduleId);
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

  const context: LoadedModuleContext = {
    system_id: systemConfig.system_id,
    module_id: moduleId,
    module_path_abs: modulePathAbs,
    module_path_rel: modulePathRel,
    shape_path_abs: shapePathAbs,
    shape_path_rel: shapePathRel,
    module_version: registryEntry.version,
    shape: shapeResult.data,
    templates: new Map(Object.entries(shapeResult.data.entities).map(([entityName, entity]) => [entityName, parsePathTemplate(entity.path, entityName)])),
  };

  const diagnostics: CompilerDiagnostic[] = [...shapeResult.diagnostics];
  diagnostics.push(...validateShapeContracts(context, systemConfig));

  const discovery = discoverMarkdownFiles(context.module_path_abs, context.module_id);
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

function validateRecord(
  record: ParsedRecord,
  context: LoadedModuleContext,
  recordIndex: Map<string, ParsedRecord>,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const effectiveContract = resolveEffectiveEntityContract(record.entity_shape, record.frontmatter, {
    module_id: context.module_id,
    entity_name: record.entity_name,
    record_file: record.file_rel,
    shape_file: context.shape_path_rel,
  });
  diagnostics.push(...validateFrontmatter(record, context, effectiveContract.fields, effectiveContract.known_field_names));
  diagnostics.push(...effectiveContract.diagnostics);
  diagnostics.push(...validateBody(record, effectiveContract.body, effectiveContract.body_diagnostics));
  diagnostics.push(...validateIdentity(record));
  diagnostics.push(...validateReferences(record, context, recordIndex, effectiveContract.fields));
  return diagnostics;
}

function validateFrontmatter(
  record: ParsedRecord,
  context: LoadedModuleContext,
  declaredFields: Record<string, FieldShape>,
  knownFieldNames: string[],
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  for (const fieldName of Object.keys(declaredFields)) {
    if (!(fieldName in record.frontmatter)) {
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

  for (const fieldName of Object.keys(record.frontmatter)) {
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
    if (!(fieldName in record.frontmatter)) continue;
    diagnostics.push(...validateFieldValue(record, context, fieldName, fieldShape, record.frontmatter[fieldName]));
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

    case "ref":
      diagnostics.push(...validateRefContract(record, context, fieldName, fieldShape, value));
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
          } else {
            diagnostics.push(...validateRefContract(record, context, `${fieldName}[${index}]`, { type: "ref", allow_null: false, target: fieldShape.items.target }, item));
          }
        });
      }
      break;
  }

  return diagnostics;
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

  diagnostics.push(
    ...validateBodyMarkdownSurface(record.body.markdown_surface, record.file_rel, record.module_id, record.entity_name),
  );

  if (record.body.titles.length > 1) {
    diagnostics.push(
      diag(codes.BODY_CONSTRAINT_VIOLATION, "error", "record_body", record.file_rel, "Multiple top-level h1 headings are not allowed", {
        module_id: record.module_id,
        entity: record.entity_name,
        field: "title",
        reason: reasons.BODY_TITLE_MULTIPLE_H1,
        expected: "exactly one top-level h1",
        actual: record.body.titles,
      }),
    );
  }

  if (declaredBody.title) {
    if (record.body.content_before_title.trim().length > 0) {
      diagnostics.push(
        diag(codes.BODY_CONSTRAINT_VIOLATION, "error", "record_body", record.file_rel, "Content before the declared h1 title is not allowed", {
          module_id: record.module_id,
          entity: record.entity_name,
          field: "title",
          reason: reasons.BODY_TITLE_CONTENT_BEFORE_DECLARED,
          expected: "h1 as first structural body region",
          actual: record.body.content_before_title.trim(),
        }),
      );
    }

    if (!record.body.title) {
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
      const expectedTitle = renderExpectedTitle(declaredBody.title, record.frontmatter);
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
      } else if (expectedTitle.kind === "expected" && record.body.title !== expectedTitle.value) {
        diagnostics.push(
          diag(codes.BODY_CONSTRAINT_VIOLATION, "error", "record_body", record.file_rel, "The h1 title does not match the declared title source", {
            module_id: record.module_id,
            entity: record.entity_name,
            field: "title",
            reason: reasons.BODY_TITLE_MISMATCH,
            expected: expectedTitle.value,
            actual: record.body.title,
          }),
        );
      }
    }
  } else if (record.body.titles.length > 0) {
    diagnostics.push(
      diag(codes.BODY_CONSTRAINT_VIOLATION, "error", "record_body", record.file_rel, "Undeclared h1 title content is not allowed", {
        module_id: record.module_id,
        entity: record.entity_name,
        field: "title",
        reason: reasons.BODY_TITLE_UNDECLARED,
        expected: "no top-level h1",
        actual: record.body.titles,
      }),
    );
  }

  if (declaredBody.preamble) {
    diagnostics.push(
      ...validateRegionMarkdown("preamble", declaredBody.preamble, record.body.preamble, record.file_rel, record.module_id, record.entity_name, 2),
    );
  } else if (record.body.preamble.trim().length > 0) {
    diagnostics.push(
      diag(codes.BODY_CONSTRAINT_VIOLATION, "error", "record_body", record.file_rel, "Undeclared top-level preamble content is not allowed", {
        module_id: record.module_id,
        entity: record.entity_name,
        field: "preamble",
        reason: reasons.BODY_PREAMBLE_UNDECLARED,
        expected: "no top-level preamble",
        actual: record.body.preamble.trim(),
      }),
    );
  }

  const duplicateSectionNames = Array.from(new Set(record.body.duplicate_section_names));
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
    if (!record.body.by_name.has(section.name)) {
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

  for (const section of record.body.ordered) {
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
  const actualKnownOrder = record.body.ordered
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
    const content = record.body.by_name.get(section.name);
    if (content === undefined) continue;
    diagnostics.push(...validateSectionMarkdown(section, content, record.file_rel, record.module_id, record.entity_name));
  }

  return diagnostics;
}

function validateIdentity(record: ParsedRecord): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const idValue = record.frontmatter.id;
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

function validateReferences(
  record: ParsedRecord,
  context: LoadedModuleContext,
  recordIndex: Map<string, ParsedRecord>,
  declaredFields: Record<string, FieldShape>,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  for (const [fieldName, fieldShape] of Object.entries(declaredFields)) {
    if (!(fieldName in record.frontmatter)) continue;
    const value = record.frontmatter[fieldName];

    if (fieldShape.type === "ref") {
      diagnostics.push(...validateResolvedRef(record, context, fieldName, fieldShape, value, recordIndex));
    } else if (fieldShape.type === "list" && fieldShape.items.type === "ref" && Array.isArray(value)) {
      value.forEach((item, index) => {
        diagnostics.push(
          ...validateResolvedRef(record, context, `${fieldName}[${index}]`, { type: "ref", allow_null: false, target: fieldShape.items.target }, item, recordIndex),
        );
      });
    }
  }

  const parentConfig = record.entity_shape.identity.parent;
  if (parentConfig && record.canonical_uri) {
    const parentFieldValue = record.frontmatter[parentConfig.ref_field];
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
  entityShape: EntityShape,
  frontmatter: Record<string, unknown>,
  meta: EffectiveEntityContractContext,
): EffectiveEntityContract {
  if (!isVariantEntityShape(entityShape)) {
    return {
      fields: entityShape.fields,
      known_field_names: Object.keys(entityShape.fields).sort(),
      body: {
        title: entityShape.body.title,
        preamble: entityShape.body.preamble,
        sections: entityShape.body.sections,
      },
      diagnostics: [],
      body_diagnostics: [],
    };
  }

  const discriminatorField = entityShape.discriminator;
  const expectedVariants = Object.keys(entityShape.variants).sort();
  const knownFieldNames = collectKnownFieldNames(entityShape);

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
    fields,
    known_field_names: Object.keys(fields).sort(),
    body: diagnostics.length > 0
      ? null
      : {
          title: entityShape.body?.title,
          preamble: entityShape.body?.preamble,
          sections,
        },
    diagnostics,
    body_diagnostics: [],
  };
}

function isVariantEntityShape(entityShape: EntityShape): entityShape is VariantEntityShape {
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

function collectKnownFieldNames(entityShape: VariantEntityShape): string[] {
  const knownFieldNames = new Set(Object.keys(entityShape.fields));

  for (const variant of Object.values(entityShape.variants)) {
    for (const fieldName of Object.keys(variant.fields)) {
      knownFieldNames.add(fieldName);
    }
  }

  return Array.from(knownFieldNames).sort();
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
  const fileRead = safeReadTextFile(fileAbs);
  if (fileRead.error) {
    diagnostics.push(
      diag(codes.PARSE_FRONTMATTER, "error", "parse", fileRel, "Could not read record file", {
        module_id: context.module_id,
        expected: "readable markdown file",
        actual: {
          code: fileRead.error.code ?? null,
          message: fileRead.error.message,
        },
        hint: "Check file permissions and rerun validation.",
      }),
    );
    return { record: null, diagnostics };
  }

  const fileContents = fileRead.contents;

  let parsedMatter;
  try {
    parsedMatter = parseFrontmatter(fileContents);
  } catch (error) {
    if (!(error instanceof FrontmatterProcessingError)) {
      throw error;
    }

    diagnostics.push(
      diag(codes.PARSE_FRONTMATTER, "error", "parse", fileRel, `Failed to parse frontmatter`, {
        module_id: context.module_id,
        actual: error instanceof Error ? error.message : String(error),
      }),
    );
    return { record: null, diagnostics };
  }

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
  const frontmatter = parsedMatter.data as Record<string, unknown>;
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
  const canonicalUri = buildCanonicalUri(context, entityMatch.entity_name, frontmatter.id, entityMatch.bindings);

  const record: ParsedRecord = {
    module_id: context.module_id,
    file_abs: fileAbs,
    file_rel: fileRel,
    file_rel_within_module: fileRelWithinModule,
    entity_name: entityMatch.entity_name,
    entity_shape: entityShape,
    frontmatter,
    body,
    bindings: entityMatch.bindings,
    canonical_uri: canonicalUri,
  };

  return { record, diagnostics };
}

function inferEntity(
  relativePath: string,
  context: LoadedModuleContext,
): { entity_name: string; bindings: Map<string, string> } | null {
  const matches: Array<{ entity_name: string; bindings: Map<string, string> }> = [];

  for (const [entityName, template] of context.templates) {
    const bindings = matchPath(relativePath, template);
    if (bindings) {
      matches.push({ entity_name: entityName, bindings });
    }
  }

  if (matches.length !== 1) return null;
  return matches[0];
}

function buildCanonicalUri(
  context: LoadedModuleContext,
  entityName: string,
  idValue: unknown,
  bindings: Map<string, string>,
): string | null {
  if (typeof idValue !== "string" || idValue.length === 0) return null;

  const segments: string[] = [];
  const lineage: string[] = [];

  let currentEntityName: string | undefined = entityName;
  while (currentEntityName) {
    lineage.unshift(currentEntityName);
    currentEntityName = context.shape.entities[currentEntityName].identity.parent?.entity;
  }

  for (const lineageEntity of lineage) {
    const entityId = lineageEntity === entityName ? idValue : bindings.get(lineageEntity);
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
        diag(codes.SHAPE_CONTRACT_INVALID, "error", "module_shape", context.shape_path_rel, `Dependency '${dependency.module}' is not declared in system.yaml`, {
          module_id: context.module_id,
          field: "dependencies",
          expected: Object.keys(systemConfig.modules).sort(),
          actual: dependency.module,
        }),
      );
    }
  }

  for (const [entityName, entityShape] of Object.entries(context.shape.entities)) {
    for (const [fieldName, fieldShape] of Object.entries(entityShape.fields)) {
      diagnostics.push(...validateFieldDependencyContract(context, dependencySet, entityName, fieldName, fieldShape));
    }

    if (isVariantEntityShape(entityShape)) {
      for (const [variantName, variant] of Object.entries(entityShape.variants)) {
        for (const [fieldName, fieldShape] of Object.entries(variant.fields)) {
          diagnostics.push(
            ...validateFieldDependencyContract(context, dependencySet, entityName, `${variantName}.${fieldName}`, fieldShape),
          );
        }
      }
    }
  }

  return diagnostics;
}

function validateFieldDependencyContract(
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

function inferredShapePath(moduleId: string, version: number): string {
  return `${inferredModuleBundlePath(moduleId, version)}/shape.yaml`;
}

function inferredModuleBundlePath(moduleId: string, version: number): string {
  return `.als/modules/${moduleId}/v${version}`;
}

function inferredSkillsPath(moduleId: string, version: number): string {
  return `${inferredModuleBundlePath(moduleId, version)}/skills`;
}

function inferredSkillEntryPath(moduleId: string, version: number, skillId: string): string {
  return `${inferredSkillsPath(moduleId, version)}/${skillId}/SKILL.md`;
}

function inferredMigrationsPath(moduleId: string, version: number): string {
  return `${inferredModuleBundlePath(moduleId, version)}/migrations`;
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
          hint: "Store each module version as a directory bundle containing shape.yaml and related assets.",
        }),
      );
      continue;
    }

    diagnostics.push(...validateShapeFilePresence(systemRootAbs, moduleId, version));

    if (version > 1) {
      diagnostics.push(...validateMigrationAssets(systemRootAbs, moduleId, version));
    }
  }

  return diagnostics;
}

function validateShapeFilePresence(systemRootAbs: string, moduleId: string, version: number): CompilerDiagnostic[] {
  const shapePath = inferredShapePath(moduleId, version);
  const shapePathAbs = resolve(systemRootAbs, shapePath);
  const shapePathRel = toRepoRelative(shapePathAbs);
  const shapeStat = safeStat(shapePathAbs);

  if (!shapeStat) {
    return [
      diag(codes.SHAPE_FILE_MISSING, "error", "module_shape", shapePathRel, `Inferred shape file for module '${moduleId}' does not exist`, {
        module_id: moduleId,
        reason: reasons.SYSTEM_SHAPE_FILE_MISSING,
        expected: shapePath,
        actual: "missing",
        hint: "Add shape.yaml to the required module version bundle.",
      }),
    ];
  }

  if (!shapeStat.isFile()) {
    return [
      diag(codes.SHAPE_FILE_MISSING, "error", "module_shape", shapePathRel, `Inferred shape path for module '${moduleId}' is not a file`, {
        module_id: moduleId,
        reason: reasons.SYSTEM_SHAPE_FILE_NOT_FILE,
        expected: "file",
        actual: "directory",
        hint: "Store the module shape at shape.yaml inside the version bundle.",
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
          hint: "List the skill in .als/system.yaml or remove it from the active bundle.",
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

function discoverMarkdownFiles(rootAbs: string, moduleId: string): MarkdownDiscoveryResult {
  const result: MarkdownDiscoveryResult = {
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

      if (!isMarkdownFileName(entry.name)) continue;

      if (!hasCanonicalMarkdownExtension(entry.name)) {
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

      result.record_file_paths.push(fullPath);
    }
  }

  walk(rootAbs);
  result.errored_file_paths.sort();
  result.record_file_paths.sort();
  result.ignored_file_paths.sort();
  return result;
}

function isMarkdownFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".md");
}

function hasCanonicalMarkdownExtension(fileName: string): boolean {
  return fileName.endsWith(".md");
}

function isReservedAgentMarkdownFile(fileName: string): boolean {
  const lowerFileName = fileName.toLowerCase();
  return lowerFileName === "agents.md" || lowerFileName === "claude.md";
}

function parseYamlFile<T>(
  fileAbs: string,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: ZodError } },
  phase: "system_config" | "module_shape",
  code: string,
  module_id: string | null,
): { success: true; data: T; diagnostics: CompilerDiagnostic[] } | { success: false; diagnostics: CompilerDiagnostic[] } {
  let raw: unknown;
  const fileRel = toRepoRelative(fileAbs);
  const fileRead = safeReadTextFile(fileAbs);
  if (fileRead.error) {
    return {
      success: false,
      diagnostics: [
        diag(code, "error", phase, fileRel, "Could not read YAML file", {
          module_id: module_id ?? undefined,
          reason: reasons.YAML_READ_FAILED,
          expected: "readable YAML file",
          actual: {
            code: fileRead.error.code ?? null,
            message: fileRead.error.message,
          },
          hint: "Check file permissions and rerun validation.",
        }),
      ],
    };
  }

  const fileContents = fileRead.contents;

  try {
    raw = parseYaml(fileContents);
  } catch (error) {
    if (!(error instanceof YAMLParseError)) {
      throw error;
    }

    return {
      success: false,
      diagnostics: [
        diag(code, "error", phase, fileRel, "Failed to parse YAML", {
          module_id: module_id ?? undefined,
          reason: reasons.YAML_PARSE_FAILED,
          actual: error instanceof Error ? error.message : String(error),
        }),
      ],
    };
  }

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
        diag(resolveParseIssueCode(code, phase, issue), "error", phase, fileRel, issue.message, {
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
    && issue.path[2] === "skills"
  ) {
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
      "Top-level source field 'schema' has been removed from ALS v1 authored YAML",
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

function toRepoRelative(pathAbs: string): string {
  return relative(process.cwd(), pathAbs).replace(/\\/g, "/") || ".";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
