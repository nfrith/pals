import { basename, join, relative, resolve } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";
import { ZodError } from "zod";
import { codes, computeStatus, diag } from "./diagnostics.ts";
import { parseBodySections, validateSectionMarkdown, type ParsedBody } from "./markdown.ts";
import { parsePathTemplate, matchPath, type ParsedPathTemplate } from "./parser/path-template.ts";
import { parseRefUri, refTargetEntity } from "./refs.ts";
import { moduleShapeSchema, systemConfigSchema, type EntityShape, type FieldShape, type ModuleShape, type SectionShape, type SystemConfig } from "./schema.ts";
import type { CompilerDiagnostic, ModuleValidationReport, ModuleValidationSummary, SystemValidationOutput } from "./types.ts";

interface LoadedModuleContext {
  module_id: string;
  module_path_abs: string;
  module_path_rel: string;
  shape_path_abs: string;
  shape_path_rel: string;
  deployed_version: number;
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
  shape_schema: string | null;
  diagnostics: CompilerDiagnostic[];
  files_checked: number;
  file_error_map: Map<string, boolean>;
  parsed_records: ParsedRecord[];
  context: LoadedModuleContext | null;
}

export function validateSystem(systemRootInput: string, moduleFilter?: string): SystemValidationOutput {
  const systemRootAbs = resolve(systemRootInput);
  const systemRootRel = toRepoRelative(systemRootAbs);
  const systemDiagnostics: CompilerDiagnostic[] = [];
  const moduleReports: ModuleValidationReport[] = [];

  const systemConfigPathAbs = resolve(systemRootAbs, ".pals/system.yaml");
  const parsedSystem = parseYamlFile<SystemConfig>(systemConfigPathAbs, systemConfigSchema, "system_config", codes.SYSTEM_INVALID, null);

  if (!parsedSystem.success) {
    return buildSystemOutput(systemRootRel, systemDiagnostics.concat(parsedSystem.diagnostics), moduleReports);
  }

  const systemConfig = parsedSystem.data;
  const selectedModuleIds = getSelectedModuleIds(systemConfig, moduleFilter, systemConfigPathAbs, systemDiagnostics);
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
        state.shape_schema,
        state.diagnostics,
        state.files_checked,
        state.file_error_map,
      ),
    );
  }

  return buildSystemOutput(systemRootRel, systemDiagnostics, moduleReports);
}

function loadModuleState(systemRootAbs: string, systemConfig: SystemConfig, moduleId: string): ModuleWorkState {
  const registryEntry = systemConfig.modules[moduleId];
  const mountEntry = systemConfig.roots[registryEntry.mount];
  const modulePathAbs = resolve(systemRootAbs, mountEntry.path, registryEntry.path);
  const modulePathRel = toRepoRelative(modulePathAbs);
  const shapePathAbs = resolve(systemRootAbs, registryEntry.shape);
  const shapePathRel = toRepoRelative(shapePathAbs);

  const shapeResult = parseYamlFile<ModuleShape>(shapePathAbs, moduleShapeSchema, "module_shape", codes.SHAPE_INVALID, moduleId);
  if (!shapeResult.success) {
    return {
      module_id: moduleId,
      module_path_rel: modulePathRel,
      module_version: registryEntry.deployed_version,
      shape_schema: null,
      diagnostics: shapeResult.diagnostics,
      files_checked: 0,
      file_error_map: new Map<string, boolean>(),
      parsed_records: [],
      context: null,
    };
  }

  const context: LoadedModuleContext = {
    module_id: moduleId,
    module_path_abs: modulePathAbs,
    module_path_rel: modulePathRel,
    shape_path_abs: shapePathAbs,
    shape_path_rel: shapePathRel,
    deployed_version: registryEntry.deployed_version,
    shape: shapeResult.data,
    templates: new Map(Object.entries(shapeResult.data.entities).map(([entityName, entity]) => [entityName, parsePathTemplate(entity.path, entityName)])),
  };

  const diagnostics: CompilerDiagnostic[] = [...shapeResult.diagnostics];
  diagnostics.push(...validateRegistryAlignment(context, registryEntry));

  const filePaths = discoverMarkdownFiles(context.module_path_abs);
  const fileErrorMap = new Map<string, boolean>();
  for (const fileAbs of filePaths) {
    fileErrorMap.set(toRepoRelative(fileAbs), false);
  }

  const parsedRecords: ParsedRecord[] = [];

  for (const fileAbs of filePaths) {
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
    module_version: context.shape.module.version,
    shape_schema: context.shape.schema,
    diagnostics,
    files_checked: filePaths.length,
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
  diagnostics.push(...validateFrontmatter(record, context));
  diagnostics.push(...validateBody(record, context));
  diagnostics.push(...validateIdentity(record));
  diagnostics.push(...validateReferences(record, context, recordIndex));
  return diagnostics;
}

function validateFrontmatter(record: ParsedRecord, context: LoadedModuleContext): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const declaredFields = record.entity_shape.fields;

  for (const [fieldName, fieldShape] of Object.entries(declaredFields)) {
    if (fieldShape.required && !(fieldName in record.frontmatter)) {
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
    if (!(fieldName in declaredFields)) {
      diagnostics.push(
        diag(codes.FM_UNKNOWN_FIELD, "error", "record_frontmatter", record.file_rel, `Unknown frontmatter field '${fieldName}'`, {
          module_id: record.module_id,
          entity: record.entity_name,
          field: fieldName,
          expected: Object.keys(declaredFields),
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
      if (typeof value !== "string") {
        diagnostics.push(
          diag(codes.FM_TYPE_MISMATCH, "error", "record_frontmatter", record.file_rel, `Field '${fieldName}' must be a string`, {
            module_id: record.module_id,
            entity: record.entity_name,
            field: fieldName,
            expected: "string",
            actual: typeof value,
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
      diagnostics.push(...validateRefContract(record, fieldName, fieldShape, value));
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
            diagnostics.push(...validateRefContract(record, `${fieldName}[${index}]`, { type: "ref", required: true, allow_null: false, target: fieldShape.items.target }, item));
          }
        });
      }
      break;
  }

  return diagnostics;
}

function validateBody(record: ParsedRecord, context: LoadedModuleContext): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const declaredSections = record.entity_shape.sections;

  for (const section of declaredSections) {
    if (section.required && !record.body.by_name.has(section.name)) {
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
    if (!declaredSections.find((declared) => declared.name === section.name)) {
      diagnostics.push(
        diag(codes.BODY_UNKNOWN_SECTION, "error", "record_body", record.file_rel, `Unknown section '## ${section.name}'`, {
          module_id: record.module_id,
          entity: record.entity_name,
          field: section.name,
          expected: declaredSections.map((declared) => declared.name),
          actual: section.name,
        }),
      );
    }
  }

  const actualKnownOrder = record.body.ordered
    .map((section) => section.name)
    .filter((sectionName) => declaredSections.some((declared) => declared.name === sectionName));
  const expectedOrder = declaredSections.map((section) => section.name);
  if (actualKnownOrder.join("||") !== expectedOrder.join("||")) {
    diagnostics.push(
      diag(codes.BODY_ORDER_MISMATCH, "error", "record_body", record.file_rel, "Section order does not match shape definition", {
        module_id: record.module_id,
        entity: record.entity_name,
        expected: expectedOrder,
        actual: actualKnownOrder,
      }),
    );
  }

  for (const section of declaredSections) {
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
  _context: LoadedModuleContext,
  recordIndex: Map<string, ParsedRecord>,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  for (const [fieldName, fieldShape] of Object.entries(record.entity_shape.fields)) {
    if (!(fieldName in record.frontmatter)) continue;
    const value = record.frontmatter[fieldName];

    if (fieldShape.type === "ref") {
      diagnostics.push(...validateResolvedRef(record, fieldName, fieldShape, value, recordIndex));
    } else if (fieldShape.type === "list" && fieldShape.items.type === "ref" && Array.isArray(value)) {
      value.forEach((item, index) => {
        diagnostics.push(
          ...validateResolvedRef(record, `${fieldName}[${index}]`, { type: "ref", required: true, allow_null: false, target: fieldShape.items.target }, item, recordIndex),
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

function validateRefContract(
  record: ParsedRecord,
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
        expected: "[label](pals://...)",
        actual: typeof value,
      }),
    );
    return diagnostics;
  }

  const parsedRef = parseRefUri(value);
  if (!parsedRef) {
    diagnostics.push(
      diag(codes.FM_REF_FORMAT, "error", "record_frontmatter", record.file_rel, `Field '${fieldName}' is not a valid PALS ref`, {
        module_id: record.module_id,
        entity: record.entity_name,
        field: fieldName,
        expected: "[label](pals://namespace/module/entity/id)",
        actual: value,
      }),
    );
    return diagnostics;
  }

  if (parsedRef.namespace !== fieldShape.target.namespace || parsedRef.module !== fieldShape.target.module) {
    diagnostics.push(
      diag(codes.REF_CONTRACT_MISMATCH, "error", "reference", record.file_rel, `Field '${fieldName}' points to the wrong namespace/module`, {
        module_id: record.module_id,
        entity: record.entity_name,
        field: fieldName,
        expected: fieldShape.target,
        actual: {
          namespace: parsedRef.namespace,
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
  fieldName: string,
  _fieldShape: Extract<FieldShape, { type: "ref" }>,
  value: unknown,
  recordIndex: Map<string, ParsedRecord>,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  if (typeof value !== "string") return diagnostics;

  const parsedRef = parseRefUri(value);
  if (!parsedRef) return diagnostics;

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

  let parsedMatter;
  try {
    parsedMatter = matter(readFileSync(fileAbs, "utf-8"));
  } catch (error) {
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
  const body = parseBodySections(parsedMatter.content);
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

  return `pals://${context.shape.module.namespace}/${context.shape.module.id}/${segments.join("/")}`;
}

function validateRegistryAlignment(
  context: LoadedModuleContext,
  registryEntry: SystemConfig["modules"][string],
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  if (context.shape.module.id !== context.module_id) {
    diagnostics.push(
      diag(codes.SHAPE_REGISTRY_MISMATCH, "error", "module_shape", context.shape_path_rel, "Shape module.id does not match system registry key", {
        module_id: context.module_id,
        expected: context.module_id,
        actual: context.shape.module.id,
      }),
    );
  }

  if (context.shape.module.mount !== registryEntry.mount) {
    diagnostics.push(
      diag(codes.SHAPE_REGISTRY_MISMATCH, "error", "module_shape", context.shape_path_rel, "Shape module.mount does not match system registry", {
        module_id: context.module_id,
        expected: registryEntry.mount,
        actual: context.shape.module.mount,
      }),
    );
  }

  if (context.shape.module.path !== registryEntry.path) {
    diagnostics.push(
      diag(codes.SHAPE_REGISTRY_MISMATCH, "error", "module_shape", context.shape_path_rel, "Shape module.path does not match system registry", {
        module_id: context.module_id,
        expected: registryEntry.path,
        actual: context.shape.module.path,
      }),
    );
  }

  if (context.shape.module.version !== registryEntry.deployed_version) {
    diagnostics.push(
      diag(codes.SHAPE_REGISTRY_MISMATCH, "error", "module_shape", context.shape_path_rel, "Shape module.version does not match deployed_version", {
        module_id: context.module_id,
        expected: registryEntry.deployed_version,
        actual: context.shape.module.version,
      }),
    );
  }

  return diagnostics;
}

function discoverMarkdownFiles(rootAbs: string): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        walk(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(fullPath);
      }
    }
  }

  walk(rootAbs);
  return results.sort();
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

  try {
    raw = parseYaml(readFileSync(fileAbs, "utf-8"));
  } catch (error) {
    return {
      success: false,
      diagnostics: [
        diag(code, "error", phase, fileRel, "Failed to parse YAML", {
          module_id: module_id ?? undefined,
          actual: error instanceof Error ? error.message : String(error),
        }),
      ],
    };
  }

  const parsed = schema.safeParse(raw);
  if (parsed.success) {
    return {
      success: true,
      data: parsed.data,
      diagnostics: [],
    };
  }

  return {
    success: false,
    diagnostics: parsed.error.issues.map((issue) =>
      diag(code, "error", phase, fileRel, issue.message, {
        module_id: module_id ?? undefined,
        field: issue.path.join(".") || null,
        expected: issue.code,
        actual: issue.path,
      }),
    ),
  };
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

function buildModuleReport(
  moduleId: string,
  modulePathRel: string,
  moduleVersion: number,
  shapeSchema: string | null,
  diagnostics: CompilerDiagnostic[],
  filesChecked: number,
  fileErrorMap: Map<string, boolean>,
): ModuleValidationReport {
  const summary: ModuleValidationSummary = {
    files_checked: filesChecked,
    files_passed: filesChecked - [...fileErrorMap.values()].filter(Boolean).length,
    files_failed: [...fileErrorMap.values()].filter(Boolean).length,
    error_count: diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
    warning_count: diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
  };

  return {
    status: computeStatus(diagnostics),
    module_id: moduleId,
    module_path: modulePathRel,
    module_version: moduleVersion,
    shape_schema: shapeSchema,
    diagnostics,
    summary,
  };
}

function buildSystemOutput(
  systemPathRel: string,
  systemDiagnostics: CompilerDiagnostic[],
  moduleReports: ModuleValidationReport[],
): SystemValidationOutput {
  const diagnostics = systemDiagnostics.concat(moduleReports.flatMap((report) => report.diagnostics));
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;

  const filesChecked = moduleReports.reduce((sum, report) => sum + report.summary.files_checked, 0);
  const filesPassed = moduleReports.reduce((sum, report) => sum + report.summary.files_passed, 0);
  const filesFailed = moduleReports.reduce((sum, report) => sum + report.summary.files_failed, 0);

  return {
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

function toRepoRelative(pathAbs: string): string {
  return relative(process.cwd(), pathAbs).replace(/\\/g, "/") || ".";
}
