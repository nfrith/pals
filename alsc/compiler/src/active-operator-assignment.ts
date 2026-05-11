import { dirname, resolve } from "node:path";
import { loadAuthoredSourceExport } from "./authored-load.ts";
import {
  delamainShapeSchema,
  type DelamainActiveOperatorAssignmentMode,
  type DelamainShape,
} from "./delamain.ts";
import {
  findAlsSystemRoot,
  inspectOperatorConfig,
  renderOperatorConfigRemediation,
} from "./operator-config.ts";
import {
  moduleShapeSchema,
  systemConfigSchema,
  type FieldShape,
  type MarkdownEntityShape,
  type ModuleShape,
} from "./schema.ts";
import { inferredModuleEntryPath, inferredSystemPath } from "./system-paths.ts";

export const ACTIVE_OPERATOR_ASSIGNMENT_INSPECTION_SCHEMA = "als-active-operator-assignment-inspection@1";

export interface ActiveOperatorAssignmentInspection {
  schema: typeof ACTIVE_OPERATOR_ASSIGNMENT_INSPECTION_SCHEMA;
  status: "pass" | "fail";
  system_root: string;
  module_id: string;
  entity_name: string;
  discriminator_value: string | null;
  delamain_name: string | null;
  assignment_required: boolean;
  assignment: {
    field: string;
    mode: DelamainActiveOperatorAssignmentMode;
    operator_id: string;
  } | null;
  error: string | null;
}

interface DelamainBinding {
  field_id: string;
  delamain_name: string;
}

interface EffectiveEntityBindingResolution {
  binding: DelamainBinding | null;
  fields: Record<string, FieldShape>;
  error: string | null;
}

export function inspectActiveOperatorAssignment(
  startPath: string,
  moduleId: string,
  entityName: string,
  discriminatorValue?: string,
): ActiveOperatorAssignmentInspection | null {
  const systemRoot = findAlsSystemRoot(startPath);
  if (!systemRoot) {
    return null;
  }

  const systemPath = resolve(systemRoot, inferredSystemPath());
  const loadedSystem = loadAuthoredSourceExport(systemPath, "system", "system_config", "operator_assignment", moduleId);
  if (!loadedSystem.success) {
    return buildFailure(systemRoot, moduleId, entityName, discriminatorValue, null, `Could not load ${systemPath}: ${loadedSystem.diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`);
  }

  const parsedSystem = systemConfigSchema.safeParse(loadedSystem.data);
  if (!parsedSystem.success) {
    return buildFailure(systemRoot, moduleId, entityName, discriminatorValue, null, `Could not validate ${systemPath}: ${parsedSystem.error.issues.map((issue) => issue.message).join("; ")}`);
  }

  const moduleConfig = parsedSystem.data.modules[moduleId];
  if (!moduleConfig) {
    return buildFailure(systemRoot, moduleId, entityName, discriminatorValue, null, `Module '${moduleId}' is not declared in .als/system.ts.`);
  }

  const modulePath = resolve(systemRoot, inferredModuleEntryPath(moduleId, moduleConfig.version));
  const loadedModule = loadAuthoredSourceExport(modulePath, "module", "module_shape", "operator_assignment", moduleId);
  if (!loadedModule.success) {
    return buildFailure(systemRoot, moduleId, entityName, discriminatorValue, null, `Could not load ${modulePath}: ${loadedModule.diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`);
  }

  const parsedModule = moduleShapeSchema.safeParse(loadedModule.data);
  if (!parsedModule.success) {
    return buildFailure(systemRoot, moduleId, entityName, discriminatorValue, null, `Could not validate ${modulePath}: ${parsedModule.error.issues.map((issue) => issue.message).join("; ")}`);
  }

  const entityShape = parsedModule.data.entities[entityName];
  if (!entityShape) {
    return buildFailure(systemRoot, moduleId, entityName, discriminatorValue, null, `Entity '${entityName}' is not declared in module '${moduleId}'.`);
  }
  if (entityShape.source_format !== "markdown") {
    return buildFailure(systemRoot, moduleId, entityName, discriminatorValue, null, `Entity '${entityName}' does not use markdown frontmatter and cannot carry operator-ref assignments.`);
  }

  const effectiveBinding = resolveEffectiveEntityBinding(entityShape, discriminatorValue);
  if (effectiveBinding.error) {
    return buildFailure(systemRoot, moduleId, entityName, discriminatorValue, null, effectiveBinding.error);
  }
  if (!effectiveBinding.binding) {
    return {
      schema: ACTIVE_OPERATOR_ASSIGNMENT_INSPECTION_SCHEMA,
      status: "pass",
      system_root: systemRoot,
      module_id: moduleId,
      entity_name: entityName,
      discriminator_value: discriminatorValue ?? null,
      delamain_name: null,
      assignment_required: false,
      assignment: null,
      error: null,
    };
  }

  const delamainEntry = parsedModule.data.delamains?.[effectiveBinding.binding.delamain_name];
  if (!delamainEntry) {
    return buildFailure(
      systemRoot,
      moduleId,
      entityName,
      discriminatorValue,
      effectiveBinding.binding.delamain_name,
      `Delamain '${effectiveBinding.binding.delamain_name}' is not declared in module '${moduleId}'.`,
    );
  }

  const delamainPath = resolve(dirname(modulePath), delamainEntry.path);
  const loadedDelamain = loadAuthoredSourceExport(delamainPath, "delamain", "module_shape", "operator_assignment", moduleId);
  if (!loadedDelamain.success) {
    return buildFailure(
      systemRoot,
      moduleId,
      entityName,
      discriminatorValue,
      effectiveBinding.binding.delamain_name,
      `Could not load ${delamainPath}: ${loadedDelamain.diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`,
    );
  }

  const parsedDelamain = delamainShapeSchema.safeParse(loadedDelamain.data);
  if (!parsedDelamain.success) {
    return buildFailure(
      systemRoot,
      moduleId,
      entityName,
      discriminatorValue,
      effectiveBinding.binding.delamain_name,
      `Could not validate ${delamainPath}: ${parsedDelamain.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }

  const assignment = parsedDelamain.data.requires_active_operator;
  if (!assignment) {
    return {
      schema: ACTIVE_OPERATOR_ASSIGNMENT_INSPECTION_SCHEMA,
      status: "pass",
      system_root: systemRoot,
      module_id: moduleId,
      entity_name: entityName,
      discriminator_value: discriminatorValue ?? null,
      delamain_name: effectiveBinding.binding.delamain_name,
      assignment_required: false,
      assignment: null,
      error: null,
    };
  }

  const assignmentField = effectiveBinding.fields[assignment.field];
  if (!assignmentField) {
    return buildFailure(
      systemRoot,
      moduleId,
      entityName,
      discriminatorValue,
      effectiveBinding.binding.delamain_name,
      `Delamain '${effectiveBinding.binding.delamain_name}' requires assignment field '${assignment.field}', but that field is not present on the effective entity schema.`,
    );
  }

  if (assignmentField.type !== "operator-ref") {
    return buildFailure(
      systemRoot,
      moduleId,
      entityName,
      discriminatorValue,
      effectiveBinding.binding.delamain_name,
      `Delamain '${effectiveBinding.binding.delamain_name}' requires '${assignment.field}' to use field type 'operator-ref', but the effective schema declares '${assignmentField.type}'.`,
    );
  }

  if (assignment.mode === "strict" && assignmentField.allow_null) {
    return buildFailure(
      systemRoot,
      moduleId,
      entityName,
      discriminatorValue,
      effectiveBinding.binding.delamain_name,
      `Delamain '${effectiveBinding.binding.delamain_name}' strict operator assignment requires '${assignment.field}' to declare allow_null: false.`,
    );
  }

  const operatorInspection = inspectOperatorConfig(systemRoot);
  if (!operatorInspection || operatorInspection.status !== "pass" || !operatorInspection.config) {
    return buildFailure(
      systemRoot,
      moduleId,
      entityName,
      discriminatorValue,
      effectiveBinding.binding.delamain_name,
      operatorInspection
        ? renderOperatorConfigRemediation(operatorInspection)
        : "Unable to resolve the ALS system root for operator-config inspection.",
    );
  }

  return {
    schema: ACTIVE_OPERATOR_ASSIGNMENT_INSPECTION_SCHEMA,
    status: "pass",
    system_root: systemRoot,
    module_id: moduleId,
    entity_name: entityName,
    discriminator_value: discriminatorValue ?? null,
    delamain_name: effectiveBinding.binding.delamain_name,
    assignment_required: true,
    assignment: {
      field: assignment.field,
      mode: assignment.mode,
      operator_id: operatorInspection.config.id,
    },
    error: null,
  };
}

function buildFailure(
  systemRoot: string,
  moduleId: string,
  entityName: string,
  discriminatorValue: string | undefined,
  delamainName: string | null,
  error: string,
): ActiveOperatorAssignmentInspection {
  return {
    schema: ACTIVE_OPERATOR_ASSIGNMENT_INSPECTION_SCHEMA,
    status: "fail",
    system_root: systemRoot,
    module_id: moduleId,
    entity_name: entityName,
    discriminator_value: discriminatorValue ?? null,
    delamain_name: delamainName,
    assignment_required: delamainName !== null,
    assignment: null,
    error,
  };
}

function resolveEffectiveEntityBinding(
  entityShape: MarkdownEntityShape,
  discriminatorValue?: string,
): EffectiveEntityBindingResolution {
  const rootBinding = selectSingleDelamainBinding(entityShape.fields);
  if (rootBinding === "multiple") {
    return {
      binding: null,
      fields: entityShape.fields,
      error: "Entity declares more than one Delamain-bound field in its root field set.",
    };
  }

  if (!("discriminator" in entityShape)) {
    return {
      binding: rootBinding,
      fields: entityShape.fields,
      error: null,
    };
  }

  if (!discriminatorValue) {
    return {
      binding: rootBinding,
      fields: entityShape.fields,
      error: rootBinding ? null : `Variant entity requires discriminator value '${entityShape.discriminator}' to resolve the active Delamain binding.`,
    };
  }

  const variant = entityShape.variants[discriminatorValue];
  if (!variant) {
    return {
      binding: null,
      fields: entityShape.fields,
      error: `Variant entity discriminator '${entityShape.discriminator}' has unknown value '${discriminatorValue}'.`,
    };
  }

  const variantBinding = selectSingleDelamainBinding(variant.fields);
  if (variantBinding === "multiple") {
    return {
      binding: null,
      fields: {
        ...entityShape.fields,
        ...variant.fields,
      },
      error: `Variant '${discriminatorValue}' declares more than one Delamain-bound field.`,
    };
  }

  if (rootBinding && variantBinding) {
    return {
      binding: null,
      fields: {
        ...entityShape.fields,
        ...variant.fields,
      },
      error: `Variant '${discriminatorValue}' declares a Delamain-bound field even though the entity root already declares one.`,
    };
  }

  return {
    binding: rootBinding ?? variantBinding,
    fields: {
      ...entityShape.fields,
      ...variant.fields,
    },
    error: null,
  };
}

function selectSingleDelamainBinding(
  fields: Record<string, FieldShape>,
): DelamainBinding | null | "multiple" {
  const bindings: DelamainBinding[] = [];

  for (const [fieldId, fieldShape] of Object.entries(fields)) {
    if (fieldShape.type !== "delamain") continue;
    bindings.push({
      field_id: fieldId,
      delamain_name: fieldShape.delamain,
    });
  }

  if (bindings.length === 0) {
    return null;
  }

  if (bindings.length === 1) {
    return bindings[0]!;
  }

  return "multiple";
}
