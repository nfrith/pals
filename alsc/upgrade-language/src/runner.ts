import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  LANGUAGE_UPGRADE_RECIPE_SCHEMA_LITERAL,
  type LanguageUpgradeCheckName,
} from "../../compiler/src/contracts.ts";
import type {
  LanguageUpgradeRecipeAgentTaskStep,
  LanguageUpgradeRecipeGateStep,
  LanguageUpgradeRecipeOperatorPromptStep,
  LanguageUpgradeRecipeScriptStep,
  LanguageUpgradeRecipeStep,
} from "../../compiler/src/types.ts";
import { runLanguageUpgradeCheck, type LanguageUpgradeSystemInspection } from "./checks/index.ts";
import type { PlannedLanguageUpgradeHop } from "./plan-chain.ts";
import type { LanguageUpgradeSelectionOptions } from "./preflight.ts";
import {
  createLanguageUpgradeCheckpointFingerprint,
  createLanguageUpgradeRuntimeState,
  readLanguageUpgradeRuntimeState,
  resolveLanguageUpgradeRuntimeStatePath,
  type LanguageUpgradeCheckpointFingerprint,
  type LanguageUpgradeRuntimeHopRecord,
  type LanguageUpgradeRuntimeState,
  type LanguageUpgradeRuntimeStepRecord,
  writeLanguageUpgradeRuntimeState,
} from "./runtime-state.ts";
import { createTelemetryEvent } from "./telemetry.ts";

const DEFAULT_LANGUAGE_UPGRADE_RUN_OWNER = "upgrade-language";

export type LanguageUpgradeCheckpointMode = "fresh" | "resumed" | "mismatch" | "invalid";

export interface LanguageUpgradePhaseStepTrace {
  step_id: string;
  type: LanguageUpgradeRecipeStep["type"];
  category: LanguageUpgradeRecipeStep["category"];
  status: LanguageUpgradeRuntimeStepRecord["status"];
  skipped_reason: string | null;
  error_code: string | null;
  diagnostic: string | null;
  mutated_paths: string[];
}

export interface LanguageUpgradePhaseHopTrace {
  hop_id: string;
  status: "pending" | "applied" | "failed" | "skipped";
  from_als_version: number;
  to_als_version: number;
  mutated_paths: string[];
  steps: LanguageUpgradePhaseStepTrace[];
}

export interface LanguageUpgradePhaseTrace {
  status: "completed" | "failed";
  checkpoint_mode: LanguageUpgradeCheckpointMode;
  target_als_version: number;
  hops: LanguageUpgradePhaseHopTrace[];
}

export interface LanguageUpgradeCheckpointMismatch {
  expected_system_root: string;
  actual_system_root: string | null;
  expected_fingerprint: LanguageUpgradeCheckpointFingerprint;
  actual_fingerprint: LanguageUpgradeCheckpointFingerprint | null;
  reasons: string[];
}

export interface LanguageUpgradeExecutionResult {
  success: boolean;
  error_code?: string | null;
  diagnostic?: string | null;
}

export interface LanguageUpgradeGateExecutionResult extends LanguageUpgradeExecutionResult {
  status: "pass" | "warn" | "fail";
}

export interface LanguageUpgradeRunnerServices {
  inspect_system(systemRoot: string): Promise<LanguageUpgradeSystemInspection> | LanguageUpgradeSystemInspection;
  execute_script?(
    input: LanguageUpgradeStepExecutionInput<LanguageUpgradeRecipeScriptStep>,
  ): Promise<LanguageUpgradeExecutionResult> | LanguageUpgradeExecutionResult;
  execute_gate?(
    input: LanguageUpgradeStepExecutionInput<LanguageUpgradeRecipeGateStep>,
  ): Promise<LanguageUpgradeGateExecutionResult> | LanguageUpgradeGateExecutionResult;
  execute_agent_task?(
    input: LanguageUpgradeStepExecutionInput<LanguageUpgradeRecipeAgentTaskStep>,
  ): Promise<LanguageUpgradeExecutionResult> | LanguageUpgradeExecutionResult;
  list_mutated_paths?(systemRoot: string): Promise<string[]> | string[];
}

export interface LanguageUpgradeExecuteOptions extends LanguageUpgradeSelectionOptions {
  state_path?: string;
  operator_responses?: Record<string, string>;
  run_owner?: string;
}

export interface LanguageUpgradeExecuteResult {
  status: "completed" | "failed";
  state: LanguageUpgradeRuntimeState;
  phase: LanguageUpgradePhaseTrace;
  error_code: string | null;
  diagnostic: string | null;
  checkpoint_mismatch: LanguageUpgradeCheckpointMismatch | null;
}

export interface LanguageUpgradeStepExecutionInput<TStep extends LanguageUpgradeRecipeStep> {
  hop: PlannedLanguageUpgradeHop;
  step: TStep;
  system_root: string;
  absolute_step_path: string;
}

interface RunnerContext {
  hops: PlannedLanguageUpgradeHop[];
  services: Required<LanguageUpgradeRunnerServices>;
  options: Required<Omit<LanguageUpgradeExecuteOptions, "state_path" | "run_owner">>;
  state_path: string;
  checkpoint_mode: Exclude<LanguageUpgradeCheckpointMode, "mismatch" | "invalid">;
  inspection_cache: LanguageUpgradeSystemInspection | null;
}

export async function executeLanguageUpgradeChain(input: {
  system_root: string;
  hops: PlannedLanguageUpgradeHop[];
  target_als_version: number;
  services: LanguageUpgradeRunnerServices;
  options?: LanguageUpgradeExecuteOptions;
}): Promise<LanguageUpgradeExecuteResult> {
  validateSupportedRecipeSchemas(input.hops);
  validateExecutablePromptContract(input.hops);

  const systemRoot = resolve(input.system_root);
  const runOwner = input.options?.run_owner ?? DEFAULT_LANGUAGE_UPGRADE_RUN_OWNER;
  const statePath = input.options?.state_path ?? resolveLanguageUpgradeRuntimeStatePath(systemRoot);
  const expectedFingerprint = createLanguageUpgradeCheckpointFingerprint({
    target_als_version: input.target_als_version,
    hops: input.hops,
    run_owner: runOwner,
  });
  const existingState = await readLanguageUpgradeRuntimeState(statePath);
  if (existingState) {
    const checkpointValidation = validateCheckpointState(existingState, {
      system_root: systemRoot,
      hops: input.hops,
      expected_fingerprint: expectedFingerprint,
    });
    if (!checkpointValidation.ok) {
      return {
        status: "failed",
        state: existingState,
        phase: buildLanguagePhaseTrace(
          existingState,
          input.target_als_version,
          "failed",
          checkpointValidation.checkpoint_mode,
        ),
        error_code: checkpointValidation.error_code,
        diagnostic: checkpointValidation.diagnostic,
        checkpoint_mismatch: checkpointValidation.checkpoint_mismatch,
      };
    }
  }

  const state = existingState ?? createLanguageUpgradeRuntimeState({
    system_root: systemRoot,
    target_als_version: input.target_als_version,
    hops: input.hops,
    run_owner: runOwner,
  });
  state.system_root = systemRoot;
  state.target_als_version = input.target_als_version;
  state.checkpoint_fingerprint = expectedFingerprint;

  const context: RunnerContext = {
    hops: input.hops,
    services: withDefaultServices(input.services),
    options: {
      enabled_optional_step_ids: [...(input.options?.enabled_optional_step_ids ?? [])],
      skipped_recommended_step_ids: [...(input.options?.skipped_recommended_step_ids ?? [])],
      operator_responses: { ...(input.options?.operator_responses ?? {}) },
    },
    state_path: statePath,
    checkpoint_mode: existingState ? "resumed" : "fresh",
    inspection_cache: null,
  };

  for (let hopIndex = state.current_hop_index; hopIndex < context.hops.length; hopIndex += 1) {
    const hopPlan = context.hops[hopIndex]!;
    const hopState = state.hops[hopIndex]!;
    state.current_hop_index = hopIndex;
    hopState.status = "running";
    appendTelemetry(state, createTelemetryEvent("hop_started", {
      hop_id: hopState.hop_id,
      message: `Starting ${hopState.hop_id}.`,
    }));
    await checkpoint(state, context.state_path);

    const orderedSteps = sortRecipeSteps(hopPlan.recipe.steps);
    while (true) {
      const pendingNormalSteps = orderedSteps.filter((step) => step.category !== "recovery")
        .filter((step) => !isResolved(findStepRecord(hopState, step.id).status));

      if (pendingNormalSteps.length === 0) {
        hopState.status = "completed";
        state.current_hop_index = hopIndex + 1;
        state.satisfied_checks = [];
        appendTelemetry(state, createTelemetryEvent("hop_completed", {
          hop_id: hopState.hop_id,
          message: `Completed ${hopState.hop_id}.`,
        }));
        await checkpoint(state, context.state_path);
        break;
      }

      let progress = false;
      for (const step of pendingNormalSteps) {
        if (!dependenciesSatisfied(hopState, step.depends_on)) {
          continue;
        }

        if (shouldSkipStep(step, context.options)) {
          const stepRecord = findStepRecord(hopState, step.id);
          stepRecord.status = "skipped";
          stepRecord.completed_at = new Date().toISOString();
          stepRecord.skipped_reason = step.category === "optional"
            ? "optional step not selected"
            : "recommended step explicitly skipped";
          appendTelemetry(state, createTelemetryEvent("step_skipped", {
            hop_id: hopState.hop_id,
            step_id: step.id,
            message: stepRecord.skipped_reason,
          }));
          await checkpoint(state, context.state_path);
          progress = true;
          continue;
        }

        const execution = await executeStep(step, hopPlan, hopState, state, context);
        if (execution.status === "failed") {
          return execution.result;
        }
        if (execution.status === "progress") {
          progress = true;
        }
      }

      if (!progress) {
        hopState.status = "failed";
        await checkpoint(state, context.state_path);
        return buildExecuteResult({
          status: "failed",
          state,
          target_als_version: input.target_als_version,
          checkpoint_mode: context.checkpoint_mode,
          error_code: "execution_blocked",
          diagnostic: `No executable step remained in ${hopState.hop_id}. Check dependency wiring and optional-step policy.`,
          checkpoint_mismatch: null,
        });
      }
    }
  }

  await checkpoint(state, context.state_path);
  return buildExecuteResult({
    status: "completed",
    state,
    target_als_version: input.target_als_version,
    checkpoint_mode: context.checkpoint_mode,
    error_code: null,
    diagnostic: null,
    checkpoint_mismatch: null,
  });
}

function buildExecuteResult(input: {
  status: "completed" | "failed";
  state: LanguageUpgradeRuntimeState;
  target_als_version: number;
  checkpoint_mode: LanguageUpgradeCheckpointMode;
  error_code: string | null;
  diagnostic: string | null;
  checkpoint_mismatch: LanguageUpgradeCheckpointMismatch | null;
}): LanguageUpgradeExecuteResult {
  return {
    status: input.status,
    state: input.state,
    phase: buildLanguagePhaseTrace(
      input.state,
      input.target_als_version,
      input.status,
      input.checkpoint_mode,
    ),
    error_code: input.error_code,
    diagnostic: input.diagnostic,
    checkpoint_mismatch: input.checkpoint_mismatch,
  };
}

function buildLanguagePhaseTrace(
  state: LanguageUpgradeRuntimeState,
  targetAlsVersion: number,
  status: "completed" | "failed",
  checkpointMode: LanguageUpgradeCheckpointMode,
): LanguageUpgradePhaseTrace {
  return {
    status,
    checkpoint_mode: checkpointMode,
    target_als_version: targetAlsVersion,
    hops: state.hops.map((hop) => {
      const steps = hop.steps.map((step) => ({
        step_id: step.step_id,
        type: step.type,
        category: step.category,
        status: step.status,
        skipped_reason: step.skipped_reason,
        error_code: step.error_code,
        diagnostic: step.diagnostic,
        mutated_paths: [...step.mutated_paths],
      }));
      return {
        hop_id: hop.hop_id,
        status: deriveHopTraceStatus(hop),
        from_als_version: hop.from_als_version,
        to_als_version: hop.to_als_version,
        mutated_paths: uniqueStrings(steps.flatMap((step) => step.mutated_paths)),
        steps,
      };
    }),
  };
}

function deriveHopTraceStatus(
  hop: LanguageUpgradeRuntimeHopRecord,
): LanguageUpgradePhaseHopTrace["status"] {
  if (hop.status === "failed") {
    return "failed";
  }

  const normalSteps = hop.steps.filter((step) => step.category !== "recovery");
  if (
    hop.status === "completed"
    && normalSteps.length > 0
    && normalSteps.every((step) => step.status === "skipped")
  ) {
    return "skipped";
  }

  if (hop.status === "completed") {
    return "applied";
  }

  return "pending";
}

function validateCheckpointState(
  state: LanguageUpgradeRuntimeState,
  input: {
    system_root: string;
    hops: PlannedLanguageUpgradeHop[];
    expected_fingerprint: LanguageUpgradeCheckpointFingerprint;
  },
):
  | { ok: true }
  | {
    ok: false;
    checkpoint_mode: "mismatch" | "invalid";
    error_code: "checkpoint-mismatch" | "checkpoint-invalid";
    diagnostic: string;
    checkpoint_mismatch: LanguageUpgradeCheckpointMismatch | null;
  } {
  const mismatchReasons: string[] = [];
  if (state.system_root !== input.system_root) {
    mismatchReasons.push(
      `state system root '${state.system_root}' does not match requested system root '${input.system_root}'`,
    );
  }

  const actualFingerprint = state.checkpoint_fingerprint;
  if (!actualFingerprint) {
    mismatchReasons.push("checkpoint fingerprint is missing");
  } else {
    if (actualFingerprint.target_als_version !== input.expected_fingerprint.target_als_version) {
      mismatchReasons.push(
        `checkpoint target ALS version ${actualFingerprint.target_als_version} does not match requested ${input.expected_fingerprint.target_als_version}`,
      );
    }
    if (actualFingerprint.run_owner !== input.expected_fingerprint.run_owner) {
      mismatchReasons.push(
        `checkpoint run owner '${actualFingerprint.run_owner}' does not match requested '${input.expected_fingerprint.run_owner}'`,
      );
    }
    if (actualFingerprint.hops.length !== input.expected_fingerprint.hops.length) {
      mismatchReasons.push(
        `checkpoint hop count ${actualFingerprint.hops.length} does not match requested ${input.expected_fingerprint.hops.length}`,
      );
    } else {
      for (let index = 0; index < actualFingerprint.hops.length; index += 1) {
        const actualHop = actualFingerprint.hops[index]!;
        const expectedHop = input.expected_fingerprint.hops[index]!;
        if (actualHop.hop_id !== expectedHop.hop_id) {
          mismatchReasons.push(
            `checkpoint hop ${index} id '${actualHop.hop_id}' does not match requested '${expectedHop.hop_id}'`,
          );
        }
        if (actualHop.from_als_version !== expectedHop.from_als_version) {
          mismatchReasons.push(
            `checkpoint hop ${actualHop.hop_id} from-version ${actualHop.from_als_version} does not match requested ${expectedHop.from_als_version}`,
          );
        }
        if (actualHop.to_als_version !== expectedHop.to_als_version) {
          mismatchReasons.push(
            `checkpoint hop ${actualHop.hop_id} to-version ${actualHop.to_als_version} does not match requested ${expectedHop.to_als_version}`,
          );
        }
        if (actualHop.recipe_identity !== expectedHop.recipe_identity) {
          mismatchReasons.push(
            `checkpoint hop ${actualHop.hop_id} recipe identity '${actualHop.recipe_identity}' does not match requested '${expectedHop.recipe_identity}'`,
          );
        }
      }
    }
  }

  if (mismatchReasons.length > 0) {
    return {
      ok: false,
      checkpoint_mode: "mismatch",
      error_code: "checkpoint-mismatch",
      diagnostic: `Checkpoint fingerprint does not match requested target ALS version or hop chain: ${mismatchReasons.join("; ")}.`,
      checkpoint_mismatch: {
        expected_system_root: input.system_root,
        actual_system_root: state.system_root,
        expected_fingerprint: input.expected_fingerprint,
        actual_fingerprint: actualFingerprint,
        reasons: mismatchReasons,
      },
    };
  }

  if (!Number.isInteger(state.current_hop_index) || state.current_hop_index < 0 || state.current_hop_index > state.hops.length) {
    return {
      ok: false,
      checkpoint_mode: "invalid",
      error_code: "checkpoint-invalid",
      diagnostic: `Checkpoint current_hop_index ${state.current_hop_index} is outside the valid range 0..${state.hops.length}.`,
      checkpoint_mismatch: null,
    };
  }

  if (state.hops.length !== input.hops.length) {
    return {
      ok: false,
      checkpoint_mode: "invalid",
      error_code: "checkpoint-invalid",
      diagnostic: `Checkpoint hop record count ${state.hops.length} does not match requested ${input.hops.length}.`,
      checkpoint_mismatch: null,
    };
  }

  for (let hopIndex = 0; hopIndex < input.hops.length; hopIndex += 1) {
    const hopPlan = input.hops[hopIndex]!;
    const hopState = state.hops[hopIndex];
    if (!hopState) {
      return {
        ok: false,
        checkpoint_mode: "invalid",
        error_code: "checkpoint-invalid",
        diagnostic: `Checkpoint is missing runtime state for hop '${hopPlan.hop_id}'.`,
        checkpoint_mismatch: null,
      };
    }

    const expectedStepIds = hopPlan.recipe.steps.map((step) => step.id);
    const actualStepIds = hopState.steps.map((step) => step.step_id);
    if (expectedStepIds.length !== actualStepIds.length) {
      return {
        ok: false,
        checkpoint_mode: "invalid",
        error_code: "checkpoint-invalid",
        diagnostic: `Checkpoint step count for hop '${hopPlan.hop_id}' does not match the requested recipe.`,
        checkpoint_mismatch: null,
      };
    }
    for (let stepIndex = 0; stepIndex < expectedStepIds.length; stepIndex += 1) {
      if (expectedStepIds[stepIndex] !== actualStepIds[stepIndex]) {
        return {
          ok: false,
          checkpoint_mode: "invalid",
          error_code: "checkpoint-invalid",
          diagnostic: `Checkpoint step order for hop '${hopPlan.hop_id}' does not match the requested recipe.`,
          checkpoint_mismatch: null,
        };
      }
    }
  }

  return { ok: true };
}

function validateSupportedRecipeSchemas(hops: PlannedLanguageUpgradeHop[]): void {
  for (const hop of hops) {
    if (hop.recipe.schema !== LANGUAGE_UPGRADE_RECIPE_SCHEMA_LITERAL) {
      throw new Error(
        `Unsupported language-upgrade-recipe schema '${hop.recipe.schema}'. Fail closed.`,
      );
    }
  }
}

async function executeStep(
  step: LanguageUpgradeRecipeStep,
  hopPlan: PlannedLanguageUpgradeHop,
  hopState: LanguageUpgradeRuntimeHopRecord,
  state: LanguageUpgradeRuntimeState,
  context: RunnerContext,
): Promise<
  | { status: "progress" }
  | { status: "failed"; result: LanguageUpgradeExecuteResult }
> {
  const stepRecord = findStepRecord(hopState, step.id);
  const now = new Date().toISOString();
  stepRecord.status = "running";
  stepRecord.attempt_count += 1;
  stepRecord.started_at = stepRecord.started_at ?? now;
  stepRecord.completed_at = null;
  stepRecord.error_code = null;
  stepRecord.diagnostic = null;
  stepRecord.skipped_reason = null;
  stepRecord.mutated_paths = [];
  appendTelemetry(state, createTelemetryEvent("step_started", {
    hop_id: hopState.hop_id,
    step_id: step.id,
    message: `Starting step '${step.id}'.`,
  }));
  await checkpoint(state, context.state_path);

  const preconditions = await runChecks(step.preconditions, hopPlan, context, state);
  if (!preconditions.ok) {
    return handleFailedStep(step, hopPlan, hopState, state, context, {
      success: false,
      error_code: "precondition_failed",
      diagnostic: preconditions.diagnostic,
    });
  }

  if (step.type === "operator-prompt") {
    const response = context.options.operator_responses[step.id];
    if (!response) {
      return handleFailedStep(step, hopPlan, hopState, state, context, {
        success: false,
        error_code: "operator_response_missing",
        diagnostic: `Missing operator response for '${step.id}' in ${hopPlan.hop_id}.`,
      });
    }

    stepRecord.status = "completed";
    stepRecord.completed_at = new Date().toISOString();
    stepRecord.operator_response = response;
    appendTelemetry(state, createTelemetryEvent("step_completed", {
      hop_id: hopState.hop_id,
      step_id: step.id,
      message: "Operator prompt completed.",
    }));
    await checkpoint(state, context.state_path);
    return { status: "progress" };
  }

  const absoluteStepPath = resolve(hopPlan.bundle_root, step.path);
  const beforeMutations = isMutatingStep(step)
    ? new Set(await context.services.list_mutated_paths(state.system_root))
    : null;

  const execution = await executeConcreteStep(step, hopPlan, absoluteStepPath, state.system_root, context.services);
  if (!execution.success) {
    return handleFailedStep(step, hopPlan, hopState, state, context, execution);
  }

  if (isMutatingStep(step)) {
    const boundary = await enforceDotAlsMutationBoundary(state.system_root, beforeMutations!, context.services);
    if (!boundary.ok) {
      return handleFailedStep(step, hopPlan, hopState, state, context, {
        success: false,
        error_code: "mutation_boundary_violation",
        diagnostic: boundary.diagnostic,
      });
    }
    stepRecord.mutated_paths = boundary.mutated_paths;
    state.satisfied_checks = [];
    context.inspection_cache = null;
  }

  if (step.type === "gate") {
    const gateExecution = execution as LanguageUpgradeGateExecutionResult;
    if (!step.accept_statuses.includes(gateExecution.status)) {
      return handleFailedStep(step, hopPlan, hopState, state, context, {
        success: false,
        error_code: "gate_status_rejected",
        diagnostic: `Gate '${step.id}' returned status '${gateExecution.status}', which is outside ${step.accept_statuses.join(", ")}.`,
      });
    }

    mergeSatisfiedChecks(state, step.provides);
    stepRecord.provided_checks = [...step.provides];
  }

  const postconditions = await runChecks(step.postconditions, hopPlan, context, state);
  if (!postconditions.ok) {
    return handleFailedStep(step, hopPlan, hopState, state, context, {
      success: false,
      error_code: "postcondition_failed",
      diagnostic: postconditions.diagnostic,
    });
  }

  stepRecord.status = "completed";
  stepRecord.completed_at = new Date().toISOString();
  appendTelemetry(state, createTelemetryEvent("step_completed", {
    hop_id: hopState.hop_id,
    step_id: step.id,
    message: `Completed step '${step.id}'.`,
  }));
  await checkpoint(state, context.state_path);
  return { status: "progress" };
}

async function handleFailedStep(
  step: LanguageUpgradeRecipeStep,
  hopPlan: PlannedLanguageUpgradeHop,
  hopState: LanguageUpgradeRuntimeHopRecord,
  state: LanguageUpgradeRuntimeState,
  context: RunnerContext,
  execution: LanguageUpgradeExecutionResult,
): Promise<
  | { status: "progress" }
  | { status: "failed"; result: LanguageUpgradeExecuteResult }
> {
  const stepRecord = findStepRecord(hopState, step.id);
  stepRecord.status = "failed";
  stepRecord.completed_at = new Date().toISOString();
  stepRecord.error_code = execution.error_code ?? "step_failed";
  stepRecord.diagnostic = execution.diagnostic ?? "Step execution failed.";
  appendTelemetry(state, createTelemetryEvent("step_failed", {
    hop_id: hopState.hop_id,
    step_id: step.id,
    error_code: stepRecord.error_code,
    message: stepRecord.diagnostic,
  }));
  await checkpoint(state, context.state_path);

  const recoverySteps = hopPlan.recipe.steps.filter((candidate) =>
    candidate.category === "recovery"
    && candidate.recovers?.step_ids.includes(step.id)
    && (
      !candidate.recovers.error_codes
      || candidate.recovers.error_codes.length === 0
      || candidate.recovers.error_codes.includes(stepRecord.error_code ?? "")
    ),
  );

  if (recoverySteps.length === 0) {
    hopState.status = "failed";
    await checkpoint(state, context.state_path);
    return {
      status: "failed",
      result: {
        ...buildExecuteResult({
          status: "failed",
          state,
          target_als_version: state.target_als_version,
          checkpoint_mode: context.checkpoint_mode,
          error_code: stepRecord.error_code,
          diagnostic: stepRecord.diagnostic,
          checkpoint_mismatch: null,
        }),
      },
    };
  }

  appendTelemetry(state, createTelemetryEvent("recovery_triggered", {
    hop_id: hopState.hop_id,
    step_id: step.id,
    error_code: stepRecord.error_code,
    message: `Triggering recovery for '${step.id}'.`,
  }));

  for (const recoveryStep of recoverySteps) {
    if (!dependenciesSatisfied(hopState, recoveryStep.depends_on)) {
      hopState.status = "failed";
      await checkpoint(state, context.state_path);
      return {
        status: "failed",
        result: {
          ...buildExecuteResult({
            status: "failed",
            state,
            target_als_version: state.target_als_version,
            checkpoint_mode: context.checkpoint_mode,
            error_code: "recovery_blocked",
            diagnostic: `Recovery step '${recoveryStep.id}' is not dependency-ready.`,
            checkpoint_mismatch: null,
          }),
        },
      };
    }

    const recoveryExecution = await executeStep(recoveryStep, hopPlan, hopState, state, context);
    if (recoveryExecution.status === "failed") {
      return recoveryExecution;
    }
  }

  stepRecord.status = "recovered";
  stepRecord.error_code = null;
  stepRecord.diagnostic = "Recovered via declared recovery step.";
  stepRecord.completed_at = new Date().toISOString();
  await checkpoint(state, context.state_path);
  return { status: "progress" };
}

async function runChecks(
  checks: LanguageUpgradeCheckName[],
  hopPlan: PlannedLanguageUpgradeHop,
  context: RunnerContext,
  state: LanguageUpgradeRuntimeState,
): Promise<{ ok: true } | { ok: false; diagnostic: string }> {
  for (const checkName of checks) {
    if (state.satisfied_checks.includes(checkName)) {
      continue;
    }

    const result = await runLanguageUpgradeCheck(checkName, {
      recipe: hopPlan.recipe,
      get_system_inspection: async () => {
        if (!context.inspection_cache) {
          context.inspection_cache = await context.services.inspect_system(state.system_root);
        }
        return context.inspection_cache;
      },
    });
    if (!result.ok) {
      return {
        ok: false,
        diagnostic: result.diagnostic ?? `Check '${checkName}' failed.`,
      };
    }
  }

  return { ok: true };
}

async function executeConcreteStep(
  step: Exclude<LanguageUpgradeRecipeStep, LanguageUpgradeRecipeOperatorPromptStep>,
  hopPlan: PlannedLanguageUpgradeHop,
  absoluteStepPath: string,
  systemRoot: string,
  services: Required<LanguageUpgradeRunnerServices>,
): Promise<LanguageUpgradeExecutionResult> {
  const input = {
    hop: hopPlan,
    step,
    system_root: systemRoot,
    absolute_step_path: absoluteStepPath,
  } as LanguageUpgradeStepExecutionInput<typeof step>;

  if (step.type === "script") {
    return services.execute_script(input as LanguageUpgradeStepExecutionInput<LanguageUpgradeRecipeScriptStep>);
  }

  if (step.type === "agent-task") {
    return services.execute_agent_task(input as LanguageUpgradeStepExecutionInput<LanguageUpgradeRecipeAgentTaskStep>);
  }

  return services.execute_gate(input as LanguageUpgradeStepExecutionInput<LanguageUpgradeRecipeGateStep>);
}

function dependenciesSatisfied(
  hopState: LanguageUpgradeRuntimeHopRecord,
  dependencyIds: string[],
): boolean {
  return dependencyIds.every((dependencyId) => {
    const dependency = findStepRecord(hopState, dependencyId);
    return dependency.status === "completed" || dependency.status === "recovered";
  });
}

function shouldSkipStep(
  step: LanguageUpgradeRecipeStep,
  options: Required<Omit<LanguageUpgradeExecuteOptions, "state_path">>,
): boolean {
  if (step.category === "optional") {
    return !options.enabled_optional_step_ids.includes(step.id);
  }

  if (step.category === "recommended") {
    return options.skipped_recommended_step_ids.includes(step.id);
  }

  return false;
}

function isResolved(status: LanguageUpgradeRuntimeStepRecord["status"]): boolean {
  return status === "completed" || status === "skipped" || status === "recovered";
}

function isMutatingStep(step: LanguageUpgradeRecipeStep): boolean {
  return step.type === "script" || step.type === "agent-task";
}

function findStepRecord(
  hopState: LanguageUpgradeRuntimeHopRecord,
  stepId: string,
): LanguageUpgradeRuntimeStepRecord {
  const record = hopState.steps.find((entry) => entry.step_id === stepId);
  if (!record) {
    throw new Error(`Missing runtime state record for step '${stepId}'.`);
  }
  return record;
}

function sortRecipeSteps(steps: LanguageUpgradeRecipeStep[]): LanguageUpgradeRecipeStep[] {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const step of steps) {
    inDegree.set(step.id, 0);
    adjacency.set(step.id, []);
  }

  for (const step of steps) {
    for (const dependency of step.depends_on) {
      if (!byId.has(dependency)) {
        continue;
      }
      adjacency.get(dependency)!.push(step.id);
      inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
    }
  }

  const queue = steps.filter((step) => (inDegree.get(step.id) ?? 0) === 0).map((step) => step.id);
  const ordered: LanguageUpgradeRecipeStep[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    ordered.push(byId.get(current)!);
    for (const next of adjacency.get(current) ?? []) {
      const nextInDegree = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, nextInDegree);
      if (nextInDegree === 0) {
        queue.push(next);
      }
    }
  }

  return ordered.length === steps.length ? ordered : [...steps];
}

function mergeSatisfiedChecks(
  state: LanguageUpgradeRuntimeState,
  checks: LanguageUpgradeCheckName[],
): void {
  const merged = new Set(state.satisfied_checks);
  for (const check of checks) {
    merged.add(check);
  }
  state.satisfied_checks = [...merged];
}

async function enforceDotAlsMutationBoundary(
  systemRoot: string,
  beforePaths: Set<string>,
  services: Required<LanguageUpgradeRunnerServices>,
) : Promise<
  | { ok: true; mutated_paths: string[] }
  | { ok: false; diagnostic: string }
> {
  const afterPaths = uniqueStrings(await services.list_mutated_paths(systemRoot));
  const newPaths = afterPaths.filter((entry) => !beforePaths.has(entry));
  const invalidPath = newPaths.find((entry) => entry !== ".als" && !entry.startsWith(".als/"));
  if (!invalidPath) {
    return {
      ok: true,
      mutated_paths: newPaths.filter((entry) => entry !== ".als").sort(),
    };
  }

  return {
    ok: false,
    diagnostic: `Step changed '${invalidPath}', but language-upgrade-recipes may mutate only .als/.`,
  };
}

async function checkpoint(
  state: LanguageUpgradeRuntimeState,
  statePath: string,
): Promise<void> {
  await writeLanguageUpgradeRuntimeState(statePath, state);
}

function appendTelemetry(
  state: LanguageUpgradeRuntimeState,
  event: ReturnType<typeof createTelemetryEvent>,
): void {
  state.telemetry.push(event);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function withDefaultServices(
  services: LanguageUpgradeRunnerServices,
): Required<LanguageUpgradeRunnerServices> {
  return {
    inspect_system: services.inspect_system,
    execute_script: services.execute_script ?? defaultExecuteScript,
    execute_gate: services.execute_gate ?? defaultExecuteGate,
    execute_agent_task: services.execute_agent_task ?? defaultExecuteAgentTask,
    list_mutated_paths: services.list_mutated_paths ?? defaultListMutatedPaths,
  };
}

function defaultExecuteScript(
  input: LanguageUpgradeStepExecutionInput<LanguageUpgradeRecipeScriptStep>,
): LanguageUpgradeExecutionResult {
  const result = spawnSync("bash", [input.absolute_step_path, ...input.step.args], {
    cwd: input.system_root,
    encoding: "utf-8",
  });

  if (result.status === 0) {
    return { success: true };
  }

  return {
    success: false,
    error_code: "script_failed",
    diagnostic: result.stderr.trim() || result.stdout.trim() || `Script '${input.step.id}' failed.`,
  };
}

function defaultExecuteGate(
  input: LanguageUpgradeStepExecutionInput<LanguageUpgradeRecipeGateStep>,
): LanguageUpgradeGateExecutionResult {
  const result = spawnSync("bash", [input.absolute_step_path], {
    cwd: input.system_root,
    encoding: "utf-8",
  });
  const stdout = result.stdout.trim();
  if (stdout.startsWith("{")) {
    try {
      const parsed = JSON.parse(stdout) as Partial<LanguageUpgradeGateExecutionResult>;
      return {
        success: parsed.status === "pass" || parsed.status === "warn",
        status: parsed.status === "warn" ? "warn" : parsed.status === "fail" ? "fail" : "pass",
        error_code: parsed.error_code ?? null,
        diagnostic: parsed.diagnostic ?? null,
      };
    } catch {
      // Fall through to exit-code handling.
    }
  }

  if (result.status === 0) {
    return {
      success: true,
      status: "pass",
    };
  }

  return {
    success: false,
    status: "fail",
    error_code: "gate_failed",
    diagnostic: result.stderr.trim() || result.stdout.trim() || `Gate '${input.step.id}' failed.`,
  };
}

function defaultExecuteAgentTask(
  input: LanguageUpgradeStepExecutionInput<LanguageUpgradeRecipeAgentTaskStep>,
): LanguageUpgradeExecutionResult {
  return {
    success: false,
    error_code: "agent_executor_missing",
    diagnostic: `No agent-task executor is configured for '${input.step.id}'.`,
  };
}

function defaultListMutatedPaths(systemRoot: string): string[] {
  const result = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: systemRoot,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Could not read git status for mutation-boundary enforcement.");
  }

  return result.stdout
    .split("\n")
    .map((entry) => entry.trimEnd())
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.slice(3));
}

function validateExecutablePromptContract(hops: PlannedLanguageUpgradeHop[]): void {
  for (const hop of hops) {
    for (const step of hop.recipe.steps) {
      if (step.type === "operator-prompt" && step.category === "recovery") {
        throw new Error(
          `Language upgrade hop '${hop.hop_id}' step '${step.id}' may not use operator-prompt with category 'recovery'.`,
        );
      }
    }
  }
}
