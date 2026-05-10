import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
import {
  getHarnessRuntimeSpec,
  type HarnessRuntimeSpec,
  type HarnessTarget,
} from "../../shared/harnesses.ts";
import type {
  HarnessDelamainNameConflict,
  HarnessDelamainProjectionCollision,
  HarnessDelamainProjectionPlan,
  HarnessDeployOutput,
  HarnessDeployWarning,
  HarnessSkillProjectionCollision,
  HarnessSkillProjectionPlan,
  HarnessSystemInstructionPlan,
} from "./types.ts";
import { loadSystemValidationContext, validateLoadedSystem } from "./validate.ts";

export interface HarnessDeployOptions {
  dry_run?: boolean;
  module_filter?: string;
  require_empty_targets?: boolean;
}

interface HarnessProjectionSpec extends HarnessRuntimeSpec {
  deploy_output_schema: string;
  system_instruction_kind: HarnessSystemInstructionPlan["kind"];
  system_instruction_contents: string;
  target_collision_roots_label: string;
  transform_projected_skill_text?: (value: string) => string;
  extra_system_file_plans?: (systemRootAbs: string) => HarnessSystemInstructionWorkPlan[];
}

interface HarnessSkillProjectionWorkPlan extends HarnessSkillProjectionPlan {
  source_dir_abs: string;
  target_dir_abs: string;
}

interface HarnessDelamainProjectionWorkPlan extends HarnessDelamainProjectionPlan {
  harness: HarnessTarget;
  source_dir_abs: string;
  dispatcher_source_dir_abs: string;
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

interface HarnessSystemInstructionWorkPlan extends HarnessSystemInstructionPlan {
  target_path_abs: string;
  contents: string;
}

type HarnessDeployProceedStatus = Exclude<HarnessDeployOutput["validation_status"], "fail">;

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
  maxBudgetUsdByProvider?: {
    anthropic?: number;
    openai?: number;
  };
}

interface DelamainRuntimeManifestConfig {
  submodules: string[];
  limits?: DelamainRuntimeLimits;
}

const DELAMAIN_RUNTIME_MANIFEST_SCHEMA = "als-delamain-runtime-manifest@1";
const DELAMAIN_RUNTIME_MANIFEST_CONFIG = "runtime-manifest.config.json";
const CANONICAL_DISPATCHER_TEMPLATE_DIR = resolve(
  import.meta.dir,
  "../../../delamain-dispatcher",
);
const ALS_PLUGIN_ROOT = resolve(import.meta.dir, "../../..");
const ALS_CODEX_HOOKS_DIR = resolve(ALS_PLUGIN_ROOT, "hooks");

export const ALS_CLAUDE_SYSTEM_INSTRUCTION_CONTENTS = `# .als Directory

This directory is managed by ALS. Its contents are generated and maintained by ALS skills and the compiler.

Do not manually add, edit, or remove files here. Make changes through ALS skills such as \`/new\`, \`/change\`, \`/migrate\`, and \`/validate\`.

This directory contains ALS definitions, including shapes, Delamain bundles, skill definitions, and migration bundles.

The compiler reads from \`.als/\` and projects runtime assets into \`.claude/\`.

Customize the system through ALS skills, not by editing \`.als/\` files directly.
`;

export const ALS_CODEX_SYSTEM_INSTRUCTION_CONTENTS = `# .als Directory

This directory is managed by ALS. Its contents are generated and maintained by ALS skills and the compiler.

Do not manually add, edit, or remove files here. Make changes through ALS skills such as \`$new\`, \`$change\`, \`$migrate\`, and \`$validate\`.

This directory contains ALS definitions, including shapes, Delamain bundles, skill definitions, and migration bundles.

The compiler reads from \`.als/\` and projects Codex runtime assets into \`.agents/\` and \`.codex/\`.

Customize the system through ALS skills, not by editing \`.als/\` files directly.
`;

const ALS_CODEX_CONFIG_TOML_CONTENTS = `[features]
codex_hooks = true
`;

const HARNESS_PROJECTION_SPECS: Record<HarnessTarget, HarnessProjectionSpec> = {
  claude: {
    ...getHarnessRuntimeSpec("claude"),
    deploy_output_schema: DEPLOY_OUTPUT_SCHEMA_LITERAL,
    system_instruction_kind: "generated_claude_guidance",
    system_instruction_contents: ALS_CLAUDE_SYSTEM_INSTRUCTION_CONTENTS,
    target_collision_roots_label: ".claude/skills or .claude/delamains",
  },
  codex: {
    ...getHarnessRuntimeSpec("codex"),
    deploy_output_schema: "als-codex-deploy-output@1",
    system_instruction_kind: "generated_codex_guidance",
    system_instruction_contents: ALS_CODEX_SYSTEM_INSTRUCTION_CONTENTS,
    target_collision_roots_label: ".agents/skills or .codex/delamains",
    transform_projected_skill_text: rewriteCodexProjectedSkillText,
    extra_system_file_plans: buildCodexSystemFilePlans,
  },
};

export function deployClaudeSkills(systemRootInput: string, options: HarnessDeployOptions = {}): HarnessDeployOutput {
  return deployHarnessProjection("claude", systemRootInput, options);
}

export function deployCodexSkills(systemRootInput: string, options: HarnessDeployOptions = {}): HarnessDeployOutput {
  return deployHarnessProjection("codex", systemRootInput, options);
}

export function deployHarnessProjection(
  target: HarnessTarget,
  systemRootInput: string,
  options: HarnessDeployOptions = {},
): HarnessDeployOutput {
  const spec = HARNESS_PROJECTION_SPECS[target];
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
      `System validation failed. Fix validation errors before deploying ${spec.display_name} projections.`,
      spec,
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
      spec,
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
      spec,
    );
  }

  return deployHarnessProjectionFromConfig(target, systemRootAbs, systemConfig, initialValidation.status, options);
}

export function deployClaudeSkillsFromConfig(
  systemRootInput: string,
  systemConfig: SystemConfig,
  validationStatus: HarnessDeployProceedStatus,
  options: HarnessDeployOptions = {},
): HarnessDeployOutput {
  return deployHarnessProjectionFromConfig("claude", systemRootInput, systemConfig, validationStatus, options);
}

export function deployCodexSkillsFromConfig(
  systemRootInput: string,
  systemConfig: SystemConfig,
  validationStatus: HarnessDeployProceedStatus,
  options: HarnessDeployOptions = {},
): HarnessDeployOutput {
  return deployHarnessProjectionFromConfig("codex", systemRootInput, systemConfig, validationStatus, options);
}

export function deployHarnessProjectionFromConfig(
  target: HarnessTarget,
  systemRootInput: string,
  systemConfig: SystemConfig,
  validationStatus: HarnessDeployProceedStatus,
  options: HarnessDeployOptions = {},
): HarnessDeployOutput {
  const spec = HARNESS_PROJECTION_SPECS[target];
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
      spec,
    );
  }

  const systemFilePlans = buildSystemFilePlans(systemRootAbs, spec);
  const planning = buildProjectionPlans(systemRootAbs, systemConfig, moduleFilter, spec);
  if (planning.error) {
    return buildDeployOutput({
      spec,
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
      warnings: [],
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
      spec,
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
      error: `One or more Delamain names would collide under ${spec.delamain_runtime_root}.`,
    });
  }

  if (requireEmptyTargets && (existingSkillTargets.length > 0 || existingDelamainTargets.length > 0)) {
    return buildDeployOutput({
      spec,
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
      error: `One or more target paths already exist under ${spec.target_collision_roots_label}.`,
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
          spec,
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
          error: `Could not write ${spec.display_name} system file '${plan.target_path}': ${formatError(error)}`,
        });
      }
    }

    for (const plan of skillPlans) {
      try {
        overwriteSkillProjectionDirectory(plan.source_dir_abs, plan.target_dir_abs, spec);
        writtenSkillCount += 1;
      } catch (error) {
        return buildDeployOutput({
          spec,
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
          error: `Could not write ${spec.display_name} skill projection '${plan.skill_id}' to '${plan.target_dir}': ${formatError(error)}`,
        });
      }
    }

    for (const plan of delamainPlans) {
      try {
        mergeProjectionDirectory(plan.source_dir_abs, plan.target_dir_abs);
        mergeDispatcherDirectory(plan.dispatcher_source_dir_abs, plan.target_dir_abs);
        removeProjectionOnlyDelamainFiles(plan.target_dir_abs);
        writeProjectedDelamainDefinition(plan);
        writeDelamainRuntimeManifest(plan);
        writtenDelamainCount += 1;
      } catch (error) {
        return buildDeployOutput({
          spec,
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
          error: `Could not write ${spec.display_name} Delamain projection '${plan.delamain_name}' to '${plan.target_dir}': ${formatError(error)}`,
        });
      }
    }
  }

  return buildDeployOutput({
    spec,
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
  spec: HarnessProjectionSpec,
): {
  skill_plans: HarnessSkillProjectionWorkPlan[];
  delamain_plans: HarnessDelamainProjectionWorkPlan[];
  delamain_name_conflicts: HarnessDelamainNameConflict[];
  error: string | null;
} {
  const moduleIds = moduleFilter ? [moduleFilter] : Object.keys(systemConfig.modules).sort();
  const skillPlans: HarnessSkillProjectionWorkPlan[] = [];
  const delamainPlans: HarnessDelamainProjectionWorkPlan[] = [];

  for (const moduleId of moduleIds) {
    const moduleConfig = systemConfig.modules[moduleId];

    for (const skillId of [...moduleConfig.skills].sort()) {
      const sourceEntryAbs = resolve(systemRootAbs, inferredSkillEntryPath(moduleId, moduleConfig.version, skillId));
      const sourceDirAbs = dirname(sourceEntryAbs);
      const targetDirAbs = resolve(systemRootAbs, spec.generated_skill_root, skillId);

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

    const loadedShape = loadModuleShapeForProjection(systemRootAbs, moduleId, moduleConfig.version, spec);
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
      const targetDirAbs = resolve(systemRootAbs, spec.delamain_runtime_root, delamainName);
      const loadedDelamain = loadDelamainForProjection(moduleId, sourceEntryAbs, spec);
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
      const dispatcherSource = resolveDispatcherProjectionSource(
        systemRootAbs,
        systemConfig.als_version,
        delamainName,
      );
      if (dispatcherSource.error) {
        return {
          skill_plans: skillPlans,
          delamain_plans: delamainPlans,
          delamain_name_conflicts: collectDelamainNameConflicts(delamainPlans),
          error: dispatcherSource.error,
        };
      }
      const projectedDelamainShape = projectDelamainShapeForHarness(loadedDelamain.shape, spec.target);

      delamainPlans.push({
        harness: spec.target,
        module_id: moduleId,
        module_version: moduleConfig.version,
        delamain_name: delamainName,
        source_dir: toSystemRelative(systemRootAbs, sourceDirAbs),
        source_dir_abs: sourceDirAbs,
        dispatcher_source_dir_abs: dispatcherSource.source_dir_abs,
        target_dir: toSystemRelative(systemRootAbs, targetDirAbs),
        target_dir_abs: targetDirAbs,
        module_mount_path: moduleConfig.path,
        entity_name: binding.entity_name,
        entity_path: binding.entity_path,
        status_field: binding.status_field,
        discriminator_field: binding.discriminator_field,
        discriminator_value: binding.discriminator_value,
        submodules: runtimeManifestConfig.config.submodules,
        state_providers: collectStateProviders(projectedDelamainShape),
        limits: runtimeManifestConfig.config.limits,
        rendered_delamain_yaml: stringifyYaml(projectedDelamainShape),
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

function buildSystemFilePlans(systemRootAbs: string, spec: HarnessProjectionSpec): HarnessSystemInstructionWorkPlan[] {
  const targetPathAbs = resolve(systemRootAbs, spec.system_instruction_path);
  return [
    {
      kind: spec.system_instruction_kind,
      target_path: toSystemRelative(systemRootAbs, targetPathAbs),
      target_path_abs: targetPathAbs,
      contents: spec.system_instruction_contents,
    },
    ...(spec.extra_system_file_plans?.(systemRootAbs) ?? []),
  ];
}

function buildCodexSystemFilePlans(systemRootAbs: string): HarnessSystemInstructionWorkPlan[] {
  const hooksPathAbs = resolve(systemRootAbs, ".codex/hooks.json");
  const configPathAbs = resolve(systemRootAbs, ".codex/config.toml");
  const configExists = existsSync(configPathAbs);
  const currentConfigContents = configExists ? readFileSync(configPathAbs, "utf-8") : null;
  const configContents = currentConfigContents !== null
    ? mergeCodexHooksFeature(currentConfigContents)
    : ALS_CODEX_CONFIG_TOML_CONTENTS;
  const plans: HarnessSystemInstructionWorkPlan[] = [
    {
      kind: "generated_codex_hooks",
      target_path: toSystemRelative(systemRootAbs, hooksPathAbs),
      target_path_abs: hooksPathAbs,
      contents: buildCodexHooksJson(),
    },
  ];

  if (!configExists || configContents !== currentConfigContents) {
    plans.push({
      kind: configExists ? "merged_codex_config" : "generated_codex_config",
      target_path: toSystemRelative(systemRootAbs, configPathAbs),
      target_path_abs: configPathAbs,
      contents: configContents,
    });
  }

  return plans;
}

function mergeCodexHooksFeature(current: string): string {
  const hadTrailingNewline = current.endsWith("\n");
  const lines = current.length === 0 ? [] : current.split(/\r?\n/);
  if (hadTrailingNewline && lines.length > 0) {
    lines.pop();
  }

  let featuresStart = -1;
  let featuresEnd = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*\[features\]\s*(?:#.*)?$/.test(lines[i])) {
      featuresStart = i;
      continue;
    }
    if (featuresStart >= 0 && i > featuresStart && /^\s*\[.*\]\s*(?:#.*)?$/.test(lines[i])) {
      featuresEnd = i;
      break;
    }
  }

  if (featuresStart < 0) {
    const next = [...lines];
    if (next.length > 0 && next[next.length - 1] !== "") {
      next.push("");
    }
    next.push("[features]", "codex_hooks = true");
    return next.join("\n") + "\n";
  }

  for (let i = featuresStart + 1; i < featuresEnd; i += 1) {
    const codexHooksMatch = lines[i].match(/^(\s*)codex_hooks\s*=\s*(true|false)\b(.*)$/);
    if (codexHooksMatch) {
      if (codexHooksMatch[2] === "true") {
        return current;
      }
      const next = [...lines];
      next[i] = `${codexHooksMatch[1]}codex_hooks = true${codexHooksMatch[3]}`;
      return next.join("\n") + (hadTrailingNewline ? "\n" : "");
    }
  }

  let insertionIndex = featuresEnd;
  while (insertionIndex > featuresStart + 1 && lines[insertionIndex - 1].trim() === "") {
    insertionIndex -= 1;
  }

  const next = [...lines];
  next.splice(insertionIndex, 0, "codex_hooks = true");
  return next.join("\n") + (hadTrailingNewline ? "\n" : "");
}

function buildCodexHooksJson(): string {
  const command = (scriptName: string): string => (
    `ALS_PLUGIN_ROOT=${shellQuote(ALS_PLUGIN_ROOT)} bash ${shellQuote(resolve(ALS_CODEX_HOOKS_DIR, scriptName))}`
  );

  return JSON.stringify(
    {
      hooks: {
        SessionStart: [
          {
            matcher: "startup|resume|clear",
            hooks: [
              {
                type: "command",
                command: command("codex-session-start-operator.sh"),
                timeout: 10,
                statusMessage: "Loading ALS operator profile",
              },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: "apply_patch|Edit|Write",
            hooks: [
              {
                type: "command",
                command: command("codex-post-edit-breadcrumb.sh"),
                timeout: 5,
                statusMessage: "Recording ALS edit",
              },
              {
                type: "command",
                command: command("codex-post-edit-validate.sh"),
                timeout: 15,
                statusMessage: "Validating ALS edit",
              },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: command("codex-stop-gate.sh"),
                timeout: 30,
                statusMessage: "Checking ALS validation gate",
              },
            ],
          },
        ],
      },
    },
    null,
    2,
  ) + "\n";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function loadModuleShapeForProjection(
  systemRootAbs: string,
  moduleId: string,
  version: number,
  spec: HarnessProjectionSpec,
): { shape: ModuleShape | null; error: string | null } {
  const shapePathAbs = resolve(systemRootAbs, inferredModuleEntryPath(moduleId, version));
  const loadedShape = loadAuthoredSourceExport(shapePathAbs, "module", "module_shape", "projection", moduleId);
  if (!loadedShape.success) {
    return {
      shape: null,
      error: `Could not load module.ts while planning ${spec.display_name} projection for module '${moduleId}': ${loadedShape.diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`,
    };
  }

  const parsedShape = moduleShapeSchema.safeParse(loadedShape.data);
  if (!parsedShape.success) {
    return {
      shape: null,
      error: `Could not validate module.ts while planning ${spec.display_name} projection for module '${moduleId}': ${formatZodIssues(parsedShape.error.issues)}`,
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
  spec: HarnessProjectionSpec,
): { shape: DelamainShape | null; error: string | null } {
  const loadedDelamain = loadAuthoredSourceExport(entryPathAbs, "delamain", "module_shape", "projection", moduleId);
  if (!loadedDelamain.success) {
    return {
      shape: null,
      error: `Could not load delamain.ts while planning ${spec.display_name} projection for module '${moduleId}': ${loadedDelamain.diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`,
    };
  }

  const parsedDelamain = delamainShapeSchema.safeParse(loadedDelamain.data);
  if (!parsedDelamain.success) {
    return {
      shape: null,
      error: `Could not validate delamain.ts while planning ${spec.display_name} projection for module '${moduleId}': ${formatZodIssues(parsedDelamain.error.issues)}`,
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

function collectDelamainNameConflicts(plans: HarnessDelamainProjectionWorkPlan[]): HarnessDelamainNameConflict[] {
  const grouped = new Map<string, HarnessDelamainProjectionWorkPlan[]>();

  for (const plan of plans) {
    const existing = grouped.get(plan.delamain_name);
    if (existing) {
      existing.push(plan);
      continue;
    }
    grouped.set(plan.delamain_name, [plan]);
  }

  const conflicts: HarnessDelamainNameConflict[] = [];

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

function collectExistingSkillTargets(plans: HarnessSkillProjectionWorkPlan[]): HarnessSkillProjectionCollision[] {
  const collisions: HarnessSkillProjectionCollision[] = [];

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

function collectExistingDelamainTargets(plans: HarnessDelamainProjectionWorkPlan[]): HarnessDelamainProjectionCollision[] {
  const collisions: HarnessDelamainProjectionCollision[] = [];

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

function collectDelamainProjectionWarnings(plans: HarnessDelamainProjectionWorkPlan[]): HarnessDeployWarning[] {
  const warnings: HarnessDeployWarning[] = [];

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

function toSkillProjectionPlan(plan: HarnessSkillProjectionWorkPlan): HarnessSkillProjectionPlan {
  return {
    module_id: plan.module_id,
    module_version: plan.module_version,
    skill_id: plan.skill_id,
    source_dir: plan.source_dir,
    target_dir: plan.target_dir,
  };
}

function toDelamainProjectionPlan(plan: HarnessDelamainProjectionWorkPlan): HarnessDelamainProjectionPlan {
  return {
    module_id: plan.module_id,
    module_version: plan.module_version,
    delamain_name: plan.delamain_name,
    source_dir: plan.source_dir,
    target_dir: plan.target_dir,
  };
}

function toSystemFilePlan(plan: HarnessSystemInstructionWorkPlan): HarnessSystemInstructionPlan {
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

function overwriteSkillProjectionDirectory(
  sourceDirAbs: string,
  targetDirAbs: string,
  spec: HarnessProjectionSpec,
): void {
  overwriteProjectionDirectory(sourceDirAbs, targetDirAbs);
  if (!spec.transform_projected_skill_text) {
    return;
  }

  rewriteProjectedSkillDirectory(targetDirAbs, spec.transform_projected_skill_text);
}

function rewriteProjectedSkillDirectory(
  dirAbs: string,
  transform: (value: string) => string,
): void {
  for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
    const pathAbs = resolve(dirAbs, entry.name);
    if (entry.isDirectory()) {
      rewriteProjectedSkillDirectory(pathAbs, transform);
      continue;
    }

    if (!entry.isFile() || entry.name !== "SKILL.md") {
      continue;
    }

    const current = readFileSync(pathAbs, "utf-8");
    const rewritten = transform(current);
    if (rewritten !== current) {
      writeFileSync(pathAbs, rewritten, "utf-8");
    }
  }
}

function rewriteCodexProjectedSkillText(value: string): string {
  return value
    .replaceAll("${CLAUDE_PLUGIN_ROOT}", "${ALS_PLUGIN_ROOT}")
    .replaceAll("$CLAUDE_PLUGIN_ROOT", "$ALS_PLUGIN_ROOT")
    .replaceAll("CLAUDE_PLUGIN_ROOT", "ALS_PLUGIN_ROOT")
    .replaceAll("Claude Code", "Codex")
    .replaceAll("Claude", "Codex")
    .replaceAll("`/install`", "`$install`")
    .replaceAll("`/new`", "`$new`")
    .replaceAll("`/validate`", "`$validate`")
    .replaceAll("`/change`", "`$change`")
    .replaceAll("`/migrate`", "`$migrate`")
    .replaceAll("`/update`", "`$update`");
}

function mergeProjectionDirectory(sourceDirAbs: string, targetDirAbs: string): void {
  mkdirSync(dirname(targetDirAbs), { recursive: true });
  cpSync(sourceDirAbs, targetDirAbs, { recursive: true, force: true });
}

function mergeDispatcherDirectory(sourceDirAbs: string, targetDirAbs: string): void {
  const targetDispatcherDirAbs = resolve(targetDirAbs, "dispatcher");
  mkdirSync(dirname(targetDispatcherDirAbs), { recursive: true });
  cpSync(sourceDirAbs, targetDispatcherDirAbs, {
    recursive: true,
    force: true,
  });
}

function resolveDispatcherProjectionSource(
  systemRootAbs: string,
  alsVersion: number,
  delamainName: string,
): { source_dir_abs: string; error: string | null } {
  const installedDispatcherDirAbs = resolve(
    systemRootAbs,
    ".als/constructs/delamain-dispatcher",
    delamainName,
  );
  const installedDispatcherStat = safeStat(installedDispatcherDirAbs);
  if (installedDispatcherStat?.isDirectory()) {
    return {
      source_dir_abs: installedDispatcherDirAbs,
      error: null,
    };
  }

  if (installedDispatcherStat && !installedDispatcherStat.isDirectory()) {
    return {
      source_dir_abs: installedDispatcherDirAbs,
      error: `Construct-managed dispatcher source for Delamain '${delamainName}' must be a directory at '${toSystemRelative(systemRootAbs, installedDispatcherDirAbs)}'.`,
    };
  }

  if (alsVersion >= 2) {
    return {
      source_dir_abs: installedDispatcherDirAbs,
      error: `ALS v${alsVersion} Delamain '${delamainName}' is missing construct-managed dispatcher source at '${toSystemRelative(systemRootAbs, installedDispatcherDirAbs)}'. Run the language upgrade or /update before deploy.`,
    };
  }

  return {
    source_dir_abs: CANONICAL_DISPATCHER_TEMPLATE_DIR,
    error: null,
  };
}

function removeProjectionOnlyDelamainFiles(targetDirAbs: string): void {
  rmSync(resolve(targetDirAbs, DELAMAIN_RUNTIME_MANIFEST_CONFIG), { force: true });
}

function writeSystemFile(plan: HarnessSystemInstructionWorkPlan): void {
  mkdirSync(dirname(plan.target_path_abs), { recursive: true });
  writeFileSync(plan.target_path_abs, plan.contents);
}

function writeProjectedDelamainDefinition(plan: HarnessDelamainProjectionWorkPlan): void {
  writeFileSync(resolve(plan.target_dir_abs, "delamain.yaml"), plan.rendered_delamain_yaml);
}

function writeDelamainRuntimeManifest(plan: HarnessDelamainProjectionWorkPlan): void {
  const manifest = {
    schema: DELAMAIN_RUNTIME_MANIFEST_SCHEMA,
    harness: plan.harness,
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

function projectDelamainShapeForHarness(delamain: DelamainShape, target: HarnessTarget): DelamainShape {
  if (target !== "codex") {
    return delamain;
  }

  return {
    ...delamain,
    states: Object.fromEntries(
      Object.entries(delamain.states).map(([stateName, state]) => {
        if (state.actor !== "agent") {
          return [stateName, state];
        }

        const { "sub-agent": _subAgent, ...projectedState } = state;
        return [
          stateName,
          {
            ...projectedState,
            provider: "openai",
          },
        ];
      }),
    ),
  };
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
    if (key === "maxTurns" || key === "maxBudgetUsd" || key === "maxBudgetUsdByProvider") {
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

  if (parsed.maxBudgetUsdByProvider !== undefined) {
    if (
      !parsed.maxBudgetUsdByProvider
      || typeof parsed.maxBudgetUsdByProvider !== "object"
      || Array.isArray(parsed.maxBudgetUsdByProvider)
    ) {
      throw new Error("'limits.maxBudgetUsdByProvider' must be an object");
    }

    const providerLimits = parsed.maxBudgetUsdByProvider as Record<string, unknown>;
    const normalizedProviderLimits: NonNullable<DelamainRuntimeLimits["maxBudgetUsdByProvider"]> = {};

    for (const [provider, value] of Object.entries(providerLimits)) {
      if (provider !== "anthropic" && provider !== "openai") {
        throw new Error(`'limits.maxBudgetUsdByProvider.${provider}' is not a supported field`);
      }
      if (
        typeof value !== "number"
        || !Number.isFinite(value)
        || value <= 0
      ) {
        throw new Error(`'limits.maxBudgetUsdByProvider.${provider}' must be a positive number`);
      }

      normalizedProviderLimits[provider] = value;
    }

    normalized.maxBudgetUsdByProvider = normalizedProviderLimits;
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
  validationStatus: HarnessDeployOutput["validation_status"],
  moduleFilter: string | null,
  dryRun: boolean,
  requireEmptyTargets: boolean,
  error: string,
  spec: HarnessProjectionSpec,
): HarnessDeployOutput {
  return buildDeployOutput({
    spec,
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
  spec: HarnessProjectionSpec;
  status: HarnessDeployOutput["status"];
  systemRootRel: string;
  validationStatus: HarnessDeployOutput["validation_status"];
  moduleFilter: string | null;
  dryRun: boolean;
  requireEmptyTargets: boolean;
  systemFilePlans: HarnessSystemInstructionWorkPlan[];
  writtenSystemFileCount: number;
  skillPlans: HarnessSkillProjectionWorkPlan[];
  writtenSkillCount: number;
  existingSkillTargets: HarnessSkillProjectionCollision[];
  delamainPlans: HarnessDelamainProjectionWorkPlan[];
  writtenDelamainCount: number;
  existingDelamainTargets: HarnessDelamainProjectionCollision[];
  delamainNameConflicts: HarnessDelamainNameConflict[];
  warnings: HarnessDeployWarning[];
  error: string | null;
}): HarnessDeployOutput {
  return {
    schema: params.spec.deploy_output_schema,
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
