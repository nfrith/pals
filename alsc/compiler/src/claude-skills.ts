import { cpSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { DEPLOY_OUTPUT_SCHEMA_LITERAL } from "./contracts.ts";
import type { FieldShape, ModuleShape, SystemConfig } from "./schema.ts";
import { moduleShapeSchema } from "./schema.ts";
import {
  inferredModuleBundlePath,
  inferredShapePath,
  inferredSkillEntryPath,
  toRepoRelative,
  toSystemRelative,
} from "./system-paths.ts";
import type {
  ClaudeDelamainNameConflict,
  ClaudeDelamainProjectionCollision,
  ClaudeDelamainProjectionPlan,
  ClaudeSkillDeployOutput,
  ClaudeSkillProjectionCollision,
  ClaudeSkillProjectionPlan,
} from "./types.ts";
import { loadSystemValidationContext, validateLoadedSystem } from "./validate.ts";

export interface ClaudeSkillDeployOptions {
  dry_run?: boolean;
  module_filter?: string;
  require_empty_targets?: boolean;
}

interface ClaudeSkillProjectionWorkPlan extends ClaudeSkillProjectionPlan {
  source_dir_abs: string;
  target_dir_abs: string;
}

interface ClaudeDelamainProjectionWorkPlan extends ClaudeDelamainProjectionPlan {
  source_dir_abs: string;
  target_dir_abs: string;
}

type ClaudeSkillDeployProceedStatus = Exclude<ClaudeSkillDeployOutput["validation_status"], "fail">;

type DelamainBindingSelection =
  | { kind: "none" }
  | { kind: "single"; name: string }
  | { kind: "multiple"; bindings: Array<{ field_id: string; delamain_name: string }> };

export function deployClaudeSkills(systemRootInput: string, options: ClaudeSkillDeployOptions = {}): ClaudeSkillDeployOutput {
  const systemRootAbs = resolve(systemRootInput);
  const validationContext = loadSystemValidationContext(systemRootAbs);
  const systemRootRel = validationContext.system_root_rel;
  const dryRun = options.dry_run ?? false;
  const moduleFilter = options.module_filter ?? null;
  const requireEmptyTargets = options.require_empty_targets ?? false;
  const initialValidation = validateLoadedSystem(validationContext);

  if (initialValidation.status === "fail") {
    return buildFailureOutput(
      systemRootRel,
      initialValidation.status,
      moduleFilter,
      dryRun,
      requireEmptyTargets,
      "System validation failed. Fix validation errors before deploying Claude projections.",
    );
  }

  const systemConfig = validationContext.system_config;
  if (!systemConfig) {
    return buildFailureOutput(
      systemRootRel,
      "fail",
      moduleFilter,
      dryRun,
      requireEmptyTargets,
      "System validation did not produce a deployable system configuration.",
    );
  }

  if (moduleFilter && !systemConfig.modules[moduleFilter]) {
    return buildFailureOutput(
      systemRootRel,
      "fail",
      moduleFilter,
      dryRun,
      requireEmptyTargets,
      `Unknown module filter '${moduleFilter}'.`,
    );
  }

  return deployClaudeSkillsFromConfig(systemRootAbs, systemConfig, initialValidation.status, options);
}

export function deployClaudeSkillsFromConfig(
  systemRootInput: string,
  systemConfig: SystemConfig,
  validationStatus: ClaudeSkillDeployProceedStatus,
  options: ClaudeSkillDeployOptions = {},
): ClaudeSkillDeployOutput {
  const systemRootAbs = resolve(systemRootInput);
  const systemRootRel = toRepoRelative(systemRootAbs);
  const dryRun = options.dry_run ?? false;
  const moduleFilter = options.module_filter ?? null;
  const requireEmptyTargets = options.require_empty_targets ?? false;

  if (moduleFilter && !systemConfig.modules[moduleFilter]) {
    return buildFailureOutput(
      systemRootRel,
      "fail",
      moduleFilter,
      dryRun,
      requireEmptyTargets,
      `Unknown module filter '${moduleFilter}'.`,
    );
  }

  const planning = buildProjectionPlans(systemRootAbs, systemConfig, moduleFilter);
  if (planning.error) {
    return buildDeployOutput({
      status: "fail",
      systemRootRel,
      validationStatus,
      moduleFilter,
      dryRun,
      requireEmptyTargets,
      skillPlans: planning.skill_plans,
      writtenSkillCount: 0,
      existingSkillTargets: collectExistingSkillTargets(planning.skill_plans),
      delamainPlans: planning.delamain_plans,
      writtenDelamainCount: 0,
      existingDelamainTargets: collectExistingDelamainTargets(planning.delamain_plans),
      delamainNameConflicts: planning.delamain_name_conflicts,
      error: planning.error,
    });
  }

  const skillPlans = planning.skill_plans;
  const delamainPlans = planning.delamain_plans;
  const delamainNameConflicts = planning.delamain_name_conflicts;
  const existingSkillTargets = collectExistingSkillTargets(skillPlans);
  const existingDelamainTargets = collectExistingDelamainTargets(delamainPlans);

  if (delamainNameConflicts.length > 0) {
    return buildDeployOutput({
      status: "fail",
      systemRootRel,
      validationStatus,
      moduleFilter,
      dryRun,
      requireEmptyTargets,
      skillPlans,
      writtenSkillCount: 0,
      existingSkillTargets,
      delamainPlans,
      writtenDelamainCount: 0,
      existingDelamainTargets,
      delamainNameConflicts,
      error: "One or more Delamain names would collide under .claude/delamains.",
    });
  }

  if (requireEmptyTargets && (existingSkillTargets.length > 0 || existingDelamainTargets.length > 0)) {
    return buildDeployOutput({
      status: "fail",
      systemRootRel,
      validationStatus,
      moduleFilter,
      dryRun,
      requireEmptyTargets,
      skillPlans,
      writtenSkillCount: 0,
      existingSkillTargets,
      delamainPlans,
      writtenDelamainCount: 0,
      existingDelamainTargets,
      delamainNameConflicts: [],
      error: "One or more target paths already exist under .claude/skills or .claude/delamains.",
    });
  }

  let writtenSkillCount = 0;
  let writtenDelamainCount = 0;
  if (!dryRun) {
    for (const plan of skillPlans) {
      try {
        overwriteProjectionDirectory(plan.source_dir_abs, plan.target_dir_abs);
        writtenSkillCount += 1;
      } catch (error) {
        return buildDeployOutput({
          status: "fail",
          systemRootRel,
          validationStatus,
          moduleFilter,
          dryRun,
          requireEmptyTargets,
          skillPlans,
          writtenSkillCount,
          existingSkillTargets,
          delamainPlans,
          writtenDelamainCount,
          existingDelamainTargets,
          delamainNameConflicts: [],
          error: `Could not write Claude skill projection '${plan.skill_id}' to '${plan.target_dir}': ${formatError(error)}`,
        });
      }
    }

    for (const plan of delamainPlans) {
      try {
        overwriteProjectionDirectory(plan.source_dir_abs, plan.target_dir_abs);
        writtenDelamainCount += 1;
      } catch (error) {
        return buildDeployOutput({
          status: "fail",
          systemRootRel,
          validationStatus,
          moduleFilter,
          dryRun,
          requireEmptyTargets,
          skillPlans,
          writtenSkillCount,
          existingSkillTargets,
          delamainPlans,
          writtenDelamainCount,
          existingDelamainTargets,
          delamainNameConflicts: [],
          error: `Could not write Claude Delamain projection '${plan.delamain_name}' to '${plan.target_dir}': ${formatError(error)}`,
        });
      }
    }
  }

  return buildDeployOutput({
    status: "pass",
    systemRootRel,
    validationStatus,
    moduleFilter,
    dryRun,
    requireEmptyTargets,
    skillPlans,
    writtenSkillCount: dryRun ? 0 : writtenSkillCount,
    existingSkillTargets,
    delamainPlans,
    writtenDelamainCount: dryRun ? 0 : writtenDelamainCount,
    existingDelamainTargets,
    delamainNameConflicts: [],
    error: null,
  });
}

function buildProjectionPlans(
  systemRootAbs: string,
  systemConfig: SystemConfig,
  moduleFilter: string | null,
): {
  skill_plans: ClaudeSkillProjectionWorkPlan[];
  delamain_plans: ClaudeDelamainProjectionWorkPlan[];
  delamain_name_conflicts: ClaudeDelamainNameConflict[];
  error: string | null;
} {
  const moduleIds = moduleFilter ? [moduleFilter] : Object.keys(systemConfig.modules).sort();
  const skillPlans: ClaudeSkillProjectionWorkPlan[] = [];
  const delamainPlans: ClaudeDelamainProjectionWorkPlan[] = [];

  for (const moduleId of moduleIds) {
    const moduleConfig = systemConfig.modules[moduleId];

    for (const skillId of [...moduleConfig.skills].sort()) {
      const sourceEntryAbs = resolve(systemRootAbs, inferredSkillEntryPath(moduleId, moduleConfig.version, skillId));
      const sourceDirAbs = dirname(sourceEntryAbs);
      const targetDirAbs = resolve(systemRootAbs, ".claude/skills", skillId);

      skillPlans.push({
        module_id: moduleId,
        module_version: moduleConfig.version,
        skill_id: skillId,
        source_dir: toSystemRelative(systemRootAbs, sourceDirAbs),
        source_dir_abs: sourceDirAbs,
        target_dir: toSystemRelative(systemRootAbs, targetDirAbs),
        target_dir_abs: targetDirAbs,
      });
    }

    const loadedShape = loadModuleShapeForProjection(systemRootAbs, moduleId, moduleConfig.version);
    if (!loadedShape.shape) {
      return {
        skill_plans: skillPlans,
        delamain_plans: delamainPlans,
        delamain_name_conflicts: collectDelamainNameConflicts(delamainPlans),
        error: loadedShape.error,
      };
    }

    const moduleBundleAbs = resolve(systemRootAbs, inferredModuleBundlePath(moduleId, moduleConfig.version));
    const collectedNames = collectProjectedDelamainNames(loadedShape.shape);
    if (collectedNames.error) {
      return {
        skill_plans: skillPlans,
        delamain_plans: delamainPlans,
        delamain_name_conflicts: collectDelamainNameConflicts(delamainPlans),
        error: collectedNames.error,
      };
    }

    for (const delamainName of collectedNames.delamain_names) {
      const registryEntry = loadedShape.shape.delamains?.[delamainName];
      if (!registryEntry) {
        return {
          skill_plans: skillPlans,
          delamain_plans: delamainPlans,
          delamain_name_conflicts: collectDelamainNameConflicts(delamainPlans),
          error: `Could not plan Delamain projection because module '${moduleId}' does not declare registry entry '${delamainName}'.`,
        };
      }

      const sourceEntryAbs = resolve(moduleBundleAbs, registryEntry.path);
      const sourceDirAbs = dirname(sourceEntryAbs);
      const targetDirAbs = resolve(systemRootAbs, ".claude/delamains", delamainName);

      delamainPlans.push({
        module_id: moduleId,
        module_version: moduleConfig.version,
        delamain_name: delamainName,
        source_dir: toSystemRelative(systemRootAbs, sourceDirAbs),
        source_dir_abs: sourceDirAbs,
        target_dir: toSystemRelative(systemRootAbs, targetDirAbs),
        target_dir_abs: targetDirAbs,
      });
    }
  }

  return {
    skill_plans: skillPlans,
    delamain_plans: delamainPlans,
    delamain_name_conflicts: collectDelamainNameConflicts(delamainPlans),
    error: null,
  };
}

function loadModuleShapeForProjection(
  systemRootAbs: string,
  moduleId: string,
  version: number,
): { shape: ModuleShape | null; error: string | null } {
  const shapePathAbs = resolve(systemRootAbs, inferredShapePath(moduleId, version));
  let rawShape: string;
  try {
    rawShape = readFileSync(shapePathAbs, "utf-8");
  } catch (error) {
    return {
      shape: null,
      error: `Could not read shape.yaml while planning Claude projection for module '${moduleId}': ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let parsedYamlShape: unknown;
  try {
    parsedYamlShape = parseYaml(rawShape);
  } catch (error) {
    return {
      shape: null,
      error: `Could not parse shape.yaml while planning Claude projection for module '${moduleId}': ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const parsedShape = moduleShapeSchema.safeParse(parsedYamlShape);
  if (!parsedShape.success) {
    return {
      shape: null,
      error: `Could not validate shape.yaml while planning Claude projection for module '${moduleId}': ${formatZodIssues(parsedShape.error.issues)}`,
    };
  }

  return {
    shape: parsedShape.data,
    error: null,
  };
}

function collectProjectedDelamainNames(shape: ModuleShape): {
  delamain_names: string[];
  error: string | null;
} {
  const delamainNames = new Set<string>();

  for (const [entityName, entityShape] of Object.entries(shape.entities)) {
    if (entityShape.source_format !== "markdown") continue;

    const rootBinding = selectSingleDelamainBinding(entityShape.fields);
    if (rootBinding.kind === "multiple") {
      return {
        delamain_names: [...delamainNames].sort(),
        error: describeMultipleBindingError(entityName, null, rootBinding.bindings),
      };
    }

    if (!("discriminator" in entityShape)) {
      if (rootBinding.kind === "single") {
        delamainNames.add(rootBinding.name);
      }
      continue;
    }

    if (rootBinding.kind === "single") {
      delamainNames.add(rootBinding.name);
    }

    for (const [variantName, variant] of Object.entries(entityShape.variants)) {
      const variantBinding = selectSingleDelamainBinding(variant.fields);
      if (variantBinding.kind === "multiple") {
        return {
          delamain_names: [...delamainNames].sort(),
          error: describeMultipleBindingError(entityName, variantName, variantBinding.bindings),
        };
      }
      if (rootBinding.kind === "single" && variantBinding.kind === "single") {
        return {
          delamain_names: [...delamainNames].sort(),
          error: `Could not plan Delamain projection because entity '${entityName}' declares base Delamain '${rootBinding.name}' and variant '${variantName}' also declares Delamain '${variantBinding.name}'.`,
        };
      }
      if (variantBinding.kind === "single") {
        // Multiple variants may intentionally bind the same Delamain. Projection only needs
        // the distinct bundle names that are active in some effective schema.
        delamainNames.add(variantBinding.name);
      }
    }
  }

  return {
    delamain_names: [...delamainNames].sort(),
    error: null,
  };
}

function selectSingleDelamainBinding(fields: Record<string, FieldShape>): DelamainBindingSelection {
  const bindings: Array<{ field_id: string; delamain_name: string }> = [];

  for (const [fieldId, fieldShape] of Object.entries(fields)) {
    if (fieldShape.type !== "delamain") continue;
    bindings.push({
      field_id: fieldId,
      delamain_name: fieldShape.delamain,
    });
  }

  if (bindings.length === 0) {
    return { kind: "none" };
  }
  if (bindings.length === 1) {
    return {
      kind: "single",
      name: bindings[0]!.delamain_name,
    };
  }
  return {
    kind: "multiple",
    bindings,
  };
}

function collectDelamainNameConflicts(plans: ClaudeDelamainProjectionWorkPlan[]): ClaudeDelamainNameConflict[] {
  const grouped = new Map<string, ClaudeDelamainProjectionWorkPlan[]>();

  for (const plan of plans) {
    const existing = grouped.get(plan.delamain_name);
    if (existing) {
      existing.push(plan);
      continue;
    }
    grouped.set(plan.delamain_name, [plan]);
  }

  const conflicts: ClaudeDelamainNameConflict[] = [];

  for (const [delamainName, conflictPlans] of grouped) {
    const distinctModules = [...new Set(conflictPlans.map((plan) => plan.module_id))].sort();
    if (distinctModules.length <= 1) continue;

    conflicts.push({
      delamain_name: delamainName,
      module_ids: distinctModules,
      target_dir: conflictPlans[0]!.target_dir,
    });
  }

  return conflicts.sort((left, right) => left.delamain_name.localeCompare(right.delamain_name));
}

function collectExistingSkillTargets(plans: ClaudeSkillProjectionWorkPlan[]): ClaudeSkillProjectionCollision[] {
  const collisions: ClaudeSkillProjectionCollision[] = [];

  for (const plan of plans) {
    const stat = safeStat(plan.target_dir_abs);
    if (!stat) continue;

    collisions.push({
      module_id: plan.module_id,
      skill_id: plan.skill_id,
      source_dir: plan.source_dir,
      target_dir: plan.target_dir,
      target_kind: stat.isDirectory() ? "directory" : "file",
    });
  }

  return collisions;
}

function collectExistingDelamainTargets(plans: ClaudeDelamainProjectionWorkPlan[]): ClaudeDelamainProjectionCollision[] {
  const collisions: ClaudeDelamainProjectionCollision[] = [];

  for (const plan of plans) {
    const stat = safeStat(plan.target_dir_abs);
    if (!stat) continue;

    collisions.push({
      module_id: plan.module_id,
      delamain_name: plan.delamain_name,
      source_dir: plan.source_dir,
      target_dir: plan.target_dir,
      target_kind: stat.isDirectory() ? "directory" : "file",
    });
  }

  return collisions;
}

function toSkillProjectionPlan(plan: ClaudeSkillProjectionWorkPlan): ClaudeSkillProjectionPlan {
  return {
    module_id: plan.module_id,
    module_version: plan.module_version,
    skill_id: plan.skill_id,
    source_dir: plan.source_dir,
    target_dir: plan.target_dir,
  };
}

function toDelamainProjectionPlan(plan: ClaudeDelamainProjectionWorkPlan): ClaudeDelamainProjectionPlan {
  return {
    module_id: plan.module_id,
    module_version: plan.module_version,
    delamain_name: plan.delamain_name,
    source_dir: plan.source_dir,
    target_dir: plan.target_dir,
  };
}

function safeStat(pathAbs: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(pathAbs);
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT",
  );
}

function overwriteProjectionDirectory(sourceDirAbs: string, targetDirAbs: string): void {
  rmSync(targetDirAbs, { recursive: true, force: true });
  mkdirSync(dirname(targetDirAbs), { recursive: true });
  cpSync(sourceDirAbs, targetDirAbs, { recursive: true });
}

function describeMultipleBindingError(
  entityName: string,
  variantName: string | null,
  bindings: Array<{ field_id: string; delamain_name: string }>,
): string {
  const scope = variantName
    ? `entity '${entityName}' variant '${variantName}'`
    : `entity '${entityName}'`;
  const details = bindings
    .map((binding) => `'${binding.field_id}' -> '${binding.delamain_name}'`)
    .join(", ");
  return `Could not plan Delamain projection because ${scope} declares multiple Delamain bindings: ${details}.`;
}

function formatZodIssues(
  issues: Array<{ path: Array<string | number>; message: string }>,
): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildFailureOutput(
  systemRootRel: string,
  validationStatus: ClaudeSkillDeployOutput["validation_status"],
  moduleFilter: string | null,
  dryRun: boolean,
  requireEmptyTargets: boolean,
  error: string,
): ClaudeSkillDeployOutput {
  return buildDeployOutput({
    status: "fail",
    systemRootRel,
    validationStatus,
    moduleFilter,
    dryRun,
    requireEmptyTargets,
    skillPlans: [],
    writtenSkillCount: 0,
    existingSkillTargets: [],
    delamainPlans: [],
    writtenDelamainCount: 0,
    existingDelamainTargets: [],
    delamainNameConflicts: [],
    error,
  });
}

function buildDeployOutput(params: {
  status: ClaudeSkillDeployOutput["status"];
  systemRootRel: string;
  validationStatus: ClaudeSkillDeployOutput["validation_status"];
  moduleFilter: string | null;
  dryRun: boolean;
  requireEmptyTargets: boolean;
  skillPlans: ClaudeSkillProjectionWorkPlan[];
  writtenSkillCount: number;
  existingSkillTargets: ClaudeSkillProjectionCollision[];
  delamainPlans: ClaudeDelamainProjectionWorkPlan[];
  writtenDelamainCount: number;
  existingDelamainTargets: ClaudeDelamainProjectionCollision[];
  delamainNameConflicts: ClaudeDelamainNameConflict[];
  error: string | null;
}): ClaudeSkillDeployOutput {
  return {
    schema: DEPLOY_OUTPUT_SCHEMA_LITERAL,
    status: params.status,
    system_path: params.systemRootRel,
    generated_at: new Date().toISOString(),
    validation_status: params.validationStatus,
    module_filter: params.moduleFilter,
    dry_run: params.dryRun,
    require_empty_targets: params.requireEmptyTargets,
    planned_skill_count: params.skillPlans.length,
    written_skill_count: params.writtenSkillCount,
    planned_skills: params.skillPlans.map(toSkillProjectionPlan),
    existing_skill_targets: params.existingSkillTargets,
    planned_delamain_count: params.delamainPlans.length,
    written_delamain_count: params.writtenDelamainCount,
    planned_delamains: params.delamainPlans.map(toDelamainProjectionPlan),
    existing_delamain_targets: params.existingDelamainTargets,
    delamain_name_conflicts: params.delamainNameConflicts,
    error: params.error,
  };
}
