import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { loadAuthoredSourceExport } from "./authored-load.ts";
import { DEPLOY_OUTPUT_SCHEMA_LITERAL } from "./contracts.ts";
import type { DelamainAgentProvider, DelamainShape } from "./delamain.ts";
import { delamainShapeSchema } from "./delamain.ts";
import type { FieldShape, ModuleShape, SystemConfig } from "./schema.ts";
import { moduleShapeSchema } from "./schema.ts";
import {
  inferredModuleBundlePath,
  inferredModuleEntryPath,
  inferredSkillEntryPath,
  toRepoRelative,
  toSystemRelative,
} from "./system-paths.ts";
import type {
  ClaudeDelamainNameConflict,
  ClaudeDelamainProjectionCollision,
  ClaudeDelamainProjectionPlan,
  ClaudeSkillDeployOutput,
  ClaudeSkillDeployWarning,
  ClaudeSkillProjectionCollision,
  ClaudeSkillProjectionPlan,
  ClaudeSystemFilePlan,
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
  module_mount_path: string;
  entity_name: string;
  entity_path: string;
  status_field: string;
  discriminator_field: string | null;
  discriminator_value: string | null;
  submodules: string[];
  state_providers: Record<string, DelamainAgentProvider>;
  limits?: DelamainRuntimeLimits;
  rendered_delamain_yaml: string;
}

interface ClaudeSystemFileWorkPlan extends ClaudeSystemFilePlan {
  target_path_abs: string;
  contents: string;
}

type ClaudeSkillDeployProceedStatus = Exclude<ClaudeSkillDeployOutput["validation_status"], "fail">;

type DelamainBindingSelection =
  | { kind: "none" }
  | { kind: "single"; name: string; field_id: string }
  | { kind: "multiple"; bindings: Array<{ field_id: string; delamain_name: string }> };

interface DelamainProjectionBinding {
  delamain_name: string;
  entity_name: string;
  entity_path: string;
  status_field: string;
  discriminator_field: string | null;
  discriminator_value: string | null;
}

interface DelamainRuntimeLimits {
  maxTurns?: number;
  maxBudgetUsd?: number;
}

interface DelamainRuntimeManifestConfig {
  submodules: string[];
  limits?: DelamainRuntimeLimits;
}

const DELAMAIN_RUNTIME_MANIFEST_SCHEMA = "als-delamain-runtime-manifest@1";
const ALS_SYSTEM_CLAUDE_MD_TARGET_PATH = ".als/CLAUDE.md";
const DELAMAIN_RUNTIME_MANIFEST_CONFIG = "runtime-manifest.config.json";
const CANONICAL_DISPATCHER_TEMPLATE_DIR = resolve(
  import.meta.dir,
  "../../../skills/new/references/dispatcher",
);

export const ALS_SYSTEM_CLAUDE_MD_CONTENTS = `# .als Directory

This directory is managed by ALS. Its contents are generated and maintained by ALS skills and the compiler.

Do not manually add, edit, or remove files here. Make changes through ALS skills such as \`/new\`, \`/change\`, \`/migrate\`, and \`/validate\`.

This directory contains ALS definitions, including shapes, Delamain bundles, skill definitions, and migration bundles.

The compiler reads from \`.als/\` and projects runtime assets into \`.claude/\`.

Customize the system through ALS skills, not by editing \`.als/\` files directly.
`;

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

  const systemFilePlans = buildSystemFilePlans(systemRootAbs);
  const planning = buildProjectionPlans(systemRootAbs, systemConfig, moduleFilter);
  if (planning.error) {
    return buildDeployOutput({
      status: "fail",
      systemRootRel,
      validationStatus,
      moduleFilter,
      dryRun,
      requireEmptyTargets,
      systemFilePlans,
      writtenSystemFileCount: 0,
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
  const warnings = collectDelamainProjectionWarnings(delamainPlans);

  if (delamainNameConflicts.length > 0) {
    return buildDeployOutput({
      status: "fail",
      systemRootRel,
      validationStatus,
      moduleFilter,
      dryRun,
      requireEmptyTargets,
      systemFilePlans,
      writtenSystemFileCount: 0,
      skillPlans,
      writtenSkillCount: 0,
      existingSkillTargets,
      delamainPlans,
      writtenDelamainCount: 0,
      existingDelamainTargets,
      delamainNameConflicts,
      warnings,
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
      systemFilePlans,
      writtenSystemFileCount: 0,
      skillPlans,
      writtenSkillCount: 0,
      existingSkillTargets,
      delamainPlans,
      writtenDelamainCount: 0,
      existingDelamainTargets,
      delamainNameConflicts: [],
      warnings,
      error: "One or more target paths already exist under .claude/skills or .claude/delamains.",
    });
  }

  let writtenSystemFileCount = 0;
  let writtenSkillCount = 0;
  let writtenDelamainCount = 0;
  if (!dryRun) {
    for (const plan of systemFilePlans) {
      try {
        writeSystemFile(plan);
        writtenSystemFileCount += 1;
      } catch (error) {
        return buildDeployOutput({
          status: "fail",
          systemRootRel,
          validationStatus,
          moduleFilter,
          dryRun,
          requireEmptyTargets,
          systemFilePlans,
          writtenSystemFileCount,
          skillPlans,
          writtenSkillCount,
          existingSkillTargets,
          delamainPlans,
          writtenDelamainCount,
          existingDelamainTargets,
          delamainNameConflicts: [],
          warnings,
          error: `Could not write Claude system file '${plan.target_path}': ${formatError(error)}`,
        });
      }
    }

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
          systemFilePlans,
          writtenSystemFileCount,
          skillPlans,
          writtenSkillCount,
          existingSkillTargets,
          delamainPlans,
          writtenDelamainCount,
          existingDelamainTargets,
          delamainNameConflicts: [],
          warnings,
          error: `Could not write Claude skill projection '${plan.skill_id}' to '${plan.target_dir}': ${formatError(error)}`,
        });
      }
    }

    for (const plan of delamainPlans) {
      try {
        mergeProjectionDirectory(plan.source_dir_abs, plan.target_dir_abs);
        mergeCanonicalDispatcherDirectory(plan.target_dir_abs);
        removeProjectionOnlyDelamainFiles(plan.target_dir_abs);
        writeProjectedDelamainDefinition(plan);
        writeDelamainRuntimeManifest(plan);
        writtenDelamainCount += 1;
      } catch (error) {
        return buildDeployOutput({
          status: "fail",
          systemRootRel,
          validationStatus,
          moduleFilter,
          dryRun,
          requireEmptyTargets,
          systemFilePlans,
          writtenSystemFileCount,
          skillPlans,
          writtenSkillCount,
          existingSkillTargets,
          delamainPlans,
          writtenDelamainCount,
          existingDelamainTargets,
          delamainNameConflicts: [],
          warnings,
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
    systemFilePlans,
    writtenSystemFileCount: dryRun ? 0 : writtenSystemFileCount,
    skillPlans,
    writtenSkillCount: dryRun ? 0 : writtenSkillCount,
    existingSkillTargets,
    delamainPlans,
    writtenDelamainCount: dryRun ? 0 : writtenDelamainCount,
    existingDelamainTargets,
    delamainNameConflicts: [],
    warnings,
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
    const collectedBindings = collectProjectedDelamainBindings(loadedShape.shape);
    if (collectedBindings.error) {
      return {
        skill_plans: skillPlans,
        delamain_plans: delamainPlans,
        delamain_name_conflicts: collectDelamainNameConflicts(delamainPlans),
        error: collectedBindings.error,
      };
    }

    for (const binding of collectedBindings.bindings) {
      const delamainName = binding.delamain_name;
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
      const loadedDelamain = loadDelamainForProjection(moduleId, sourceEntryAbs);
      if (!loadedDelamain.shape) {
        return {
          skill_plans: skillPlans,
          delamain_plans: delamainPlans,
          delamain_name_conflicts: collectDelamainNameConflicts(delamainPlans),
          error: loadedDelamain.error,
        };
      }
      const runtimeManifestConfig = loadDelamainRuntimeManifestConfig(systemRootAbs, sourceDirAbs);
      if (runtimeManifestConfig.error) {
        return {
          skill_plans: skillPlans,
          delamain_plans: delamainPlans,
          delamain_name_conflicts: collectDelamainNameConflicts(delamainPlans),
          error: runtimeManifestConfig.error,
        };
      }

      delamainPlans.push({
        module_id: moduleId,
        module_version: moduleConfig.version,
        delamain_name: delamainName,
        source_dir: toSystemRelative(systemRootAbs, sourceDirAbs),
        source_dir_abs: sourceDirAbs,
        target_dir: toSystemRelative(systemRootAbs, targetDirAbs),
        target_dir_abs: targetDirAbs,
        module_mount_path: moduleConfig.path,
        entity_name: binding.entity_name,
        entity_path: binding.entity_path,
        status_field: binding.status_field,
        discriminator_field: binding.discriminator_field,
        discriminator_value: binding.discriminator_value,
        submodules: runtimeManifestConfig.config.submodules,
        state_providers: collectStateProviders(loadedDelamain.shape),
        limits: runtimeManifestConfig.config.limits,
        rendered_delamain_yaml: stringifyYaml(loadedDelamain.shape),
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

function buildSystemFilePlans(systemRootAbs: string): ClaudeSystemFileWorkPlan[] {
  const targetPathAbs = resolve(systemRootAbs, ALS_SYSTEM_CLAUDE_MD_TARGET_PATH);
  return [
    {
      kind: "generated_claude_guidance",
      target_path: toSystemRelative(systemRootAbs, targetPathAbs),
      target_path_abs: targetPathAbs,
      contents: ALS_SYSTEM_CLAUDE_MD_CONTENTS,
    },
  ];
}

function loadModuleShapeForProjection(
  systemRootAbs: string,
  moduleId: string,
  version: number,
): { shape: ModuleShape | null; error: string | null } {
  const shapePathAbs = resolve(systemRootAbs, inferredModuleEntryPath(moduleId, version));
  const loadedShape = loadAuthoredSourceExport(shapePathAbs, "module", "module_shape", "projection", moduleId);
  if (!loadedShape.success) {
    return {
      shape: null,
      error: `Could not load module.ts while planning Claude projection for module '${moduleId}': ${loadedShape.diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`,
    };
  }

  const parsedShape = moduleShapeSchema.safeParse(loadedShape.data);
  if (!parsedShape.success) {
    return {
      shape: null,
      error: `Could not validate module.ts while planning Claude projection for module '${moduleId}': ${formatZodIssues(parsedShape.error.issues)}`,
    };
  }

  return {
    shape: parsedShape.data,
    error: null,
  };
}

function loadDelamainForProjection(
  moduleId: string,
  entryPathAbs: string,
): { shape: DelamainShape | null; error: string | null } {
  const loadedDelamain = loadAuthoredSourceExport(entryPathAbs, "delamain", "module_shape", "projection", moduleId);
  if (!loadedDelamain.success) {
    return {
      shape: null,
      error: `Could not load delamain.ts while planning Claude projection for module '${moduleId}': ${loadedDelamain.diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`,
    };
  }

  const parsedDelamain = delamainShapeSchema.safeParse(loadedDelamain.data);
  if (!parsedDelamain.success) {
    return {
      shape: null,
      error: `Could not validate delamain.ts while planning Claude projection for module '${moduleId}': ${formatZodIssues(parsedDelamain.error.issues)}`,
    };
  }

  return {
    shape: parsedDelamain.data,
    error: null,
  };
}

function collectProjectedDelamainBindings(shape: ModuleShape): {
  bindings: DelamainProjectionBinding[];
  error: string | null;
} {
  const bindings: DelamainProjectionBinding[] = [];
  const bindingsByDelamain = new Map<string, DelamainProjectionBinding>();

  const addBinding = (
    binding: DelamainProjectionBinding,
    fieldId: string,
  ): { error: string | null } => {
    const existing = bindingsByDelamain.get(binding.delamain_name);
    if (existing) {
      return {
        error: describeRepeatedBindingError(existing, binding, fieldId),
      };
    }

    bindingsByDelamain.set(binding.delamain_name, binding);
    bindings.push(binding);
    return { error: null };
  };

  for (const [entityName, entityShape] of Object.entries(shape.entities)) {
    if (entityShape.source_format !== "markdown") continue;

    const rootBinding = selectSingleDelamainBinding(entityShape.fields);
    if (rootBinding.kind === "multiple") {
      return {
        bindings,
        error: describeMultipleBindingError(entityName, null, rootBinding.bindings),
      };
    }

    if (!("discriminator" in entityShape)) {
      if (rootBinding.kind === "single") {
        const addResult = addBinding(
          {
            delamain_name: rootBinding.name,
            entity_name: entityName,
            entity_path: entityShape.path,
            status_field: rootBinding.field_id,
            discriminator_field: null,
            discriminator_value: null,
          },
          rootBinding.field_id,
        );
        if (addResult.error) {
          return {
            bindings,
            error: addResult.error,
          };
        }
      }
      continue;
    }

    if (rootBinding.kind === "single") {
      const addResult = addBinding(
        {
          delamain_name: rootBinding.name,
          entity_name: entityName,
          entity_path: entityShape.path,
          status_field: rootBinding.field_id,
          discriminator_field: null,
          discriminator_value: null,
        },
        rootBinding.field_id,
      );
      if (addResult.error) {
        return {
          bindings,
          error: addResult.error,
        };
      }
    }

    for (const [variantName, variant] of Object.entries(entityShape.variants)) {
      const variantBinding = selectSingleDelamainBinding(variant.fields);
      if (variantBinding.kind === "multiple") {
        return {
          bindings,
          error: describeMultipleBindingError(entityName, variantName, variantBinding.bindings),
        };
      }
      if (rootBinding.kind === "single" && variantBinding.kind === "single") {
        return {
          bindings,
          error: `Could not plan Delamain projection because entity '${entityName}' declares base Delamain '${rootBinding.name}' and variant '${variantName}' also declares Delamain '${variantBinding.name}'.`,
        };
      }
      if (variantBinding.kind === "single") {
        const addResult = addBinding(
          {
            delamain_name: variantBinding.name,
            entity_name: entityName,
            entity_path: entityShape.path,
            status_field: variantBinding.field_id,
            discriminator_field: entityShape.discriminator,
            discriminator_value: variantName,
          },
          variantBinding.field_id,
        );
        if (addResult.error) {
          return {
            bindings,
            error: addResult.error,
          };
        }
      }
    }
  }

  return {
    bindings,
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
      field_id: bindings[0]!.field_id,
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

function collectDelamainProjectionWarnings(plans: ClaudeDelamainProjectionWorkPlan[]): ClaudeSkillDeployWarning[] {
  const warnings: ClaudeSkillDeployWarning[] = [];

  for (const plan of plans) {
    const targetStat = safeStat(plan.target_dir_abs);
    if (!targetStat || !targetStat.isDirectory()) {
      continue;
    }

    const dispatcherNodeModulesAbs = resolve(plan.target_dir_abs, "dispatcher", "node_modules");
    if (safeStat(dispatcherNodeModulesAbs)) {
      continue;
    }

    warnings.push({
      code: "delamain_dispatcher_node_modules_missing",
      message: `Delamain deploy target '${plan.target_dir}' has no existing dispatcher/node_modules to preserve. Projection will continue without installing dependencies.`,
      module_id: plan.module_id,
      delamain_name: plan.delamain_name,
      target_dir: plan.target_dir,
      target_path: `${plan.target_dir}/dispatcher/node_modules`,
    });
  }

  return warnings;
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

function toSystemFilePlan(plan: ClaudeSystemFileWorkPlan): ClaudeSystemFilePlan {
  return {
    kind: plan.kind,
    target_path: plan.target_path,
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

function mergeProjectionDirectory(sourceDirAbs: string, targetDirAbs: string): void {
  mkdirSync(dirname(targetDirAbs), { recursive: true });
  cpSync(sourceDirAbs, targetDirAbs, { recursive: true, force: true });
}

function mergeCanonicalDispatcherDirectory(targetDirAbs: string): void {
  const targetDispatcherDirAbs = resolve(targetDirAbs, "dispatcher");
  mkdirSync(dirname(targetDispatcherDirAbs), { recursive: true });
  cpSync(CANONICAL_DISPATCHER_TEMPLATE_DIR, targetDispatcherDirAbs, {
    recursive: true,
    force: true,
  });
}

function removeProjectionOnlyDelamainFiles(targetDirAbs: string): void {
  rmSync(resolve(targetDirAbs, DELAMAIN_RUNTIME_MANIFEST_CONFIG), { force: true });
}

function writeSystemFile(plan: ClaudeSystemFileWorkPlan): void {
  mkdirSync(dirname(plan.target_path_abs), { recursive: true });
  writeFileSync(plan.target_path_abs, plan.contents);
}

function writeProjectedDelamainDefinition(plan: ClaudeDelamainProjectionWorkPlan): void {
  writeFileSync(resolve(plan.target_dir_abs, "delamain.yaml"), plan.rendered_delamain_yaml);
}

function writeDelamainRuntimeManifest(plan: ClaudeDelamainProjectionWorkPlan): void {
  const manifest = {
    schema: DELAMAIN_RUNTIME_MANIFEST_SCHEMA,
    delamain_name: plan.delamain_name,
    module_id: plan.module_id,
    module_version: plan.module_version,
    module_mount_path: plan.module_mount_path,
    entity_name: plan.entity_name,
    entity_path: plan.entity_path,
    status_field: plan.status_field,
    discriminator_field: plan.discriminator_field,
    discriminator_value: plan.discriminator_value,
    submodules: plan.submodules,
    state_providers: plan.state_providers,
    ...(plan.limits ? { limits: plan.limits } : {}),
  };

  writeFileSync(
    resolve(plan.target_dir_abs, "runtime-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

function collectStateProviders(delamain: DelamainShape): Record<string, DelamainAgentProvider> {
  return Object.fromEntries(
    Object.entries(delamain.states)
      .filter(([, state]) => state.actor === "agent" && state.provider)
      .map(([stateName, state]) => [stateName, state.provider!]),
  );
}

function loadDelamainRuntimeManifestConfig(
  systemRootAbs: string,
  sourceDirAbs: string,
): { config: DelamainRuntimeManifestConfig; error: string | null } {
  const configPathAbs = resolve(sourceDirAbs, DELAMAIN_RUNTIME_MANIFEST_CONFIG);
  const configStat = safeStat(configPathAbs);
  if (!configStat) {
    return {
      config: { submodules: [] },
      error: null,
    };
  }

  if (!configStat.isFile()) {
    return {
      config: { submodules: [] },
      error: `Could not load ${DELAMAIN_RUNTIME_MANIFEST_CONFIG} for '${toSystemRelative(systemRootAbs, sourceDirAbs)}': expected a file.`,
    };
  }

  try {
    const raw = readFileSync(configPathAbs, "utf-8");
    const parsed = JSON.parse(raw) as {
      submodules?: unknown;
      limits?: unknown;
      [key: string]: unknown;
    };
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        config: { submodules: [] },
        error: `Could not load ${DELAMAIN_RUNTIME_MANIFEST_CONFIG} for '${toSystemRelative(systemRootAbs, sourceDirAbs)}': expected a JSON object.`,
      };
    }

    for (const key of Object.keys(parsed)) {
      if (key === "submodules" || key === "limits") {
        continue;
      }
      return {
        config: { submodules: [] },
        error: `Could not load ${DELAMAIN_RUNTIME_MANIFEST_CONFIG} for '${toSystemRelative(systemRootAbs, sourceDirAbs)}': '${key}' is not a supported field.`,
      };
    }

    const submodules = parsed.submodules === undefined
      ? []
      : normalizeDelamainRuntimeSubmodules(systemRootAbs, parsed.submodules);
    const limits = parsed.limits === undefined
      ? undefined
      : normalizeDelamainRuntimeLimits(parsed.limits);

    return {
      config: limits ? { submodules, limits } : { submodules },
      error: null,
    };
  } catch (error) {
    return {
      config: { submodules: [] },
      error: `Could not load ${DELAMAIN_RUNTIME_MANIFEST_CONFIG} for '${toSystemRelative(systemRootAbs, sourceDirAbs)}': ${formatError(error)}`,
    };
  }
}

function normalizeDelamainRuntimeSubmodules(
  systemRootAbs: string,
  submodules: unknown,
): string[] {
  if (!Array.isArray(submodules)) {
    throw new Error("'submodules' must be an array of repo-relative paths");
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of submodules) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error("'submodules' entries must be non-empty strings");
    }

    const candidateAbs = resolve(systemRootAbs, value);
    const candidateRel = toSystemRelative(systemRootAbs, candidateAbs);
    if (candidateRel === "." || candidateRel.startsWith("..")) {
      throw new Error(`submodule path '${value}' must stay within the system root`);
    }

    if (seen.has(candidateRel)) continue;
    seen.add(candidateRel);
    normalized.push(candidateRel);
  }

  return normalized;
}

function normalizeDelamainRuntimeLimits(value: unknown): DelamainRuntimeLimits {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("'limits' must be an object");
  }

  const parsed = value as Record<string, unknown>;
  const normalized: DelamainRuntimeLimits = {};

  for (const key of Object.keys(parsed)) {
    if (key === "maxTurns" || key === "maxBudgetUsd") {
      continue;
    }
    if (key === "agents") {
      throw new Error("'limits.agents' is reserved for a future ALS release and is not supported yet");
    }
    throw new Error(`'limits.${key}' is not a supported field`);
  }

  if (parsed.maxTurns !== undefined) {
    if (
      typeof parsed.maxTurns !== "number"
      || !Number.isInteger(parsed.maxTurns)
      || parsed.maxTurns <= 0
    ) {
      throw new Error("'limits.maxTurns' must be a positive integer");
    }
    normalized.maxTurns = parsed.maxTurns;
  }

  if (parsed.maxBudgetUsd !== undefined) {
    if (
      typeof parsed.maxBudgetUsd !== "number"
      || !Number.isFinite(parsed.maxBudgetUsd)
      || parsed.maxBudgetUsd <= 0
    ) {
      throw new Error("'limits.maxBudgetUsd' must be a positive number");
    }
    normalized.maxBudgetUsd = parsed.maxBudgetUsd;
  }

  return normalized;
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

function describeRepeatedBindingError(
  existing: DelamainProjectionBinding,
  incoming: DelamainProjectionBinding,
  incomingFieldId: string,
): string {
  const describeScope = (binding: DelamainProjectionBinding, fieldId: string): string => {
    const variantScope = binding.discriminator_value
      ? ` variant '${binding.discriminator_value}'`
      : "";
    return `entity '${binding.entity_name}'${variantScope} field '${fieldId}'`;
  };

  return (
    `Could not plan Delamain projection because Delamain '${incoming.delamain_name}' is bound more than once `
    + `in effective schemas: ${describeScope(existing, existing.status_field)}; `
    + `${describeScope(incoming, incomingFieldId)}.`
  );
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
    systemFilePlans: [],
    writtenSystemFileCount: 0,
    skillPlans: [],
    writtenSkillCount: 0,
    existingSkillTargets: [],
    delamainPlans: [],
    writtenDelamainCount: 0,
    existingDelamainTargets: [],
    delamainNameConflicts: [],
    warnings: [],
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
  systemFilePlans: ClaudeSystemFileWorkPlan[];
  writtenSystemFileCount: number;
  skillPlans: ClaudeSkillProjectionWorkPlan[];
  writtenSkillCount: number;
  existingSkillTargets: ClaudeSkillProjectionCollision[];
  delamainPlans: ClaudeDelamainProjectionWorkPlan[];
  writtenDelamainCount: number;
  existingDelamainTargets: ClaudeDelamainProjectionCollision[];
  delamainNameConflicts: ClaudeDelamainNameConflict[];
  warnings: ClaudeSkillDeployWarning[];
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
    planned_system_file_count: params.systemFilePlans.length,
    written_system_file_count: params.writtenSystemFileCount,
    planned_system_files: params.systemFilePlans.map(toSystemFilePlan),
    planned_skill_count: params.skillPlans.length,
    written_skill_count: params.writtenSkillCount,
    planned_skills: params.skillPlans.map(toSkillProjectionPlan),
    existing_skill_targets: params.existingSkillTargets,
    planned_delamain_count: params.delamainPlans.length,
    written_delamain_count: params.writtenDelamainCount,
    planned_delamains: params.delamainPlans.map(toDelamainProjectionPlan),
    existing_delamain_targets: params.existingDelamainTargets,
    delamain_name_conflicts: params.delamainNameConflicts,
    warnings: params.warnings,
    error: params.error,
  };
}
