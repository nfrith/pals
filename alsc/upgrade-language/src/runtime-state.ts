import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
  LanguageUpgradeCheckName,
  LanguageUpgradeOperatorPromptIntent,
  LanguageUpgradeRecipeCategory,
  LanguageUpgradeRecipeStepType,
} from "../../compiler/src/contracts.ts";
import type { LanguageUpgradeTelemetryEvent } from "./telemetry.ts";
import type { PlannedLanguageUpgradeHop } from "./plan-chain.ts";

export const LANGUAGE_UPGRADE_RUNTIME_STATE_SCHEMA = "als-language-upgrade-runtime-state@1";

export type LanguageUpgradeRuntimeHopStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "paused";

export type LanguageUpgradeRuntimeStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "paused"
  | "recovered";

export interface LanguageUpgradeRuntimeStepRecord {
  step_id: string;
  type: LanguageUpgradeRecipeStepType;
  category: LanguageUpgradeRecipeCategory;
  status: LanguageUpgradeRuntimeStepStatus;
  attempt_count: number;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  diagnostic: string | null;
  provided_checks: LanguageUpgradeCheckName[];
  skipped_reason: string | null;
  operator_response: string | null;
}

export interface LanguageUpgradeRuntimeHopRecord {
  hop_id: string;
  recipe_path: string;
  bundle_root: string;
  from_als_version: number;
  to_als_version: number;
  summary: string;
  status: LanguageUpgradeRuntimeHopStatus;
  steps: LanguageUpgradeRuntimeStepRecord[];
}

export interface LanguageUpgradePendingOperatorPrompt {
  hop_id: string;
  step_id: string;
  intent: LanguageUpgradeOperatorPromptIntent;
  prompt_path: string;
  markdown: string;
}

export interface LanguageUpgradeRuntimeState {
  schema: typeof LANGUAGE_UPGRADE_RUNTIME_STATE_SCHEMA;
  system_root: string;
  target_als_version: number;
  current_hop_index: number;
  hops: LanguageUpgradeRuntimeHopRecord[];
  satisfied_checks: LanguageUpgradeCheckName[];
  pending_operator_prompt: LanguageUpgradePendingOperatorPrompt | null;
  telemetry: LanguageUpgradeTelemetryEvent[];
  updated_at: string;
}

export function resolveLanguageUpgradeRuntimeStatePath(systemRoot: string): string {
  return join(resolve(systemRoot), ".als", "runtime", "language-upgrades", "state.json");
}

export function createLanguageUpgradeRuntimeState(input: {
  system_root: string;
  target_als_version: number;
  hops: PlannedLanguageUpgradeHop[];
}): LanguageUpgradeRuntimeState {
  return {
    schema: LANGUAGE_UPGRADE_RUNTIME_STATE_SCHEMA,
    system_root: resolve(input.system_root),
    target_als_version: input.target_als_version,
    current_hop_index: 0,
    hops: input.hops.map((hop) => ({
      hop_id: hop.hop_id,
      recipe_path: hop.recipe_path,
      bundle_root: hop.bundle_root,
      from_als_version: hop.recipe.from.als_version,
      to_als_version: hop.recipe.to.als_version,
      summary: hop.recipe.summary,
      status: "pending",
      steps: hop.recipe.steps.map((step) => ({
        step_id: step.id,
        type: step.type,
        category: step.category,
        status: "pending",
        attempt_count: 0,
        started_at: null,
        completed_at: null,
        error_code: null,
        diagnostic: null,
        provided_checks: [],
        skipped_reason: null,
        operator_response: null,
      })),
    })),
    satisfied_checks: [],
    pending_operator_prompt: null,
    telemetry: [],
    updated_at: new Date().toISOString(),
  };
}

export async function readLanguageUpgradeRuntimeState(
  statePath: string,
): Promise<LanguageUpgradeRuntimeState | null> {
  let raw: string;
  try {
    raw = await readFile(statePath, "utf-8");
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }

  const parsed = JSON.parse(raw) as Partial<LanguageUpgradeRuntimeState>;
  if (parsed.schema !== LANGUAGE_UPGRADE_RUNTIME_STATE_SCHEMA) {
    throw new Error(
      `Unsupported language upgrade runtime state schema '${parsed.schema ?? "<missing>"}'.`,
    );
  }

  return normalizeLanguageUpgradeRuntimeState(parsed);
}

export async function writeLanguageUpgradeRuntimeState(
  statePath: string,
  state: LanguageUpgradeRuntimeState,
): Promise<void> {
  const resolvedPath = resolve(statePath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  const nextState = {
    ...state,
    schema: LANGUAGE_UPGRADE_RUNTIME_STATE_SCHEMA,
    updated_at: new Date().toISOString(),
  } satisfies LanguageUpgradeRuntimeState;
  const tempPath = `${resolvedPath}.tmp`;
  await writeFile(tempPath, JSON.stringify(nextState, null, 2) + "\n", "utf-8");
  await rename(tempPath, resolvedPath);
}

function normalizeLanguageUpgradeRuntimeState(
  input: Partial<LanguageUpgradeRuntimeState>,
): LanguageUpgradeRuntimeState {
  return {
    schema: LANGUAGE_UPGRADE_RUNTIME_STATE_SCHEMA,
    system_root: typeof input.system_root === "string" ? input.system_root : process.cwd(),
    target_als_version: typeof input.target_als_version === "number" ? input.target_als_version : 0,
    current_hop_index: typeof input.current_hop_index === "number" ? input.current_hop_index : 0,
    hops: Array.isArray(input.hops) ? input.hops.map(normalizeHopRecord) : [],
    satisfied_checks: Array.isArray(input.satisfied_checks)
      ? input.satisfied_checks.filter((entry): entry is LanguageUpgradeCheckName => typeof entry === "string")
      : [],
    pending_operator_prompt: normalizePendingPrompt(input.pending_operator_prompt),
    telemetry: Array.isArray(input.telemetry)
      ? input.telemetry.filter((entry): entry is LanguageUpgradeTelemetryEvent => !!entry && typeof entry === "object")
      : [],
    updated_at: typeof input.updated_at === "string" ? input.updated_at : new Date().toISOString(),
  };
}

function normalizeHopRecord(input: unknown): LanguageUpgradeRuntimeHopRecord {
  const value = input && typeof input === "object" ? input as Partial<LanguageUpgradeRuntimeHopRecord> : {};
  return {
    hop_id: typeof value.hop_id === "string" ? value.hop_id : "unknown-hop",
    recipe_path: typeof value.recipe_path === "string" ? value.recipe_path : "",
    bundle_root: typeof value.bundle_root === "string" ? value.bundle_root : "",
    from_als_version: typeof value.from_als_version === "number" ? value.from_als_version : 0,
    to_als_version: typeof value.to_als_version === "number" ? value.to_als_version : 0,
    summary: typeof value.summary === "string" ? value.summary : "",
    status: normalizeHopStatus(value.status),
    steps: Array.isArray(value.steps) ? value.steps.map(normalizeStepRecord) : [],
  };
}

function normalizeStepRecord(input: unknown): LanguageUpgradeRuntimeStepRecord {
  const value = input && typeof input === "object" ? input as Partial<LanguageUpgradeRuntimeStepRecord> : {};
  return {
    step_id: typeof value.step_id === "string" ? value.step_id : "unknown-step",
    type: normalizeStepType(value.type),
    category: normalizeStepCategory(value.category),
    status: normalizeStepStatus(value.status),
    attempt_count: typeof value.attempt_count === "number" ? value.attempt_count : 0,
    started_at: typeof value.started_at === "string" ? value.started_at : null,
    completed_at: typeof value.completed_at === "string" ? value.completed_at : null,
    error_code: typeof value.error_code === "string" ? value.error_code : null,
    diagnostic: typeof value.diagnostic === "string" ? value.diagnostic : null,
    provided_checks: Array.isArray(value.provided_checks)
      ? value.provided_checks.filter((entry): entry is LanguageUpgradeCheckName => typeof entry === "string")
      : [],
    skipped_reason: typeof value.skipped_reason === "string" ? value.skipped_reason : null,
    operator_response: typeof value.operator_response === "string" ? value.operator_response : null,
  };
}

function normalizePendingPrompt(input: unknown): LanguageUpgradePendingOperatorPrompt | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const value = input as Partial<LanguageUpgradePendingOperatorPrompt>;
  if (
    typeof value.hop_id !== "string"
    || typeof value.step_id !== "string"
    || typeof value.intent !== "string"
    || typeof value.prompt_path !== "string"
    || typeof value.markdown !== "string"
  ) {
    return null;
  }

  return {
    hop_id: value.hop_id,
    step_id: value.step_id,
    intent: value.intent as LanguageUpgradeOperatorPromptIntent,
    prompt_path: value.prompt_path,
    markdown: value.markdown,
  };
}

function normalizeHopStatus(value: unknown): LanguageUpgradeRuntimeHopStatus {
  switch (value) {
    case "running":
    case "completed":
    case "failed":
    case "paused":
      return value;
    default:
      return "pending";
  }
}

function normalizeStepStatus(value: unknown): LanguageUpgradeRuntimeStepStatus {
  switch (value) {
    case "running":
    case "completed":
    case "failed":
    case "skipped":
    case "paused":
    case "recovered":
      return value;
    default:
      return "pending";
  }
}

function normalizeStepType(value: unknown): LanguageUpgradeRecipeStepType {
  switch (value) {
    case "agent-task":
    case "gate":
    case "operator-prompt":
      return value;
    default:
      return "script";
  }
}

function normalizeStepCategory(value: unknown): LanguageUpgradeRecipeCategory {
  switch (value) {
    case "recommended":
    case "optional":
    case "recovery":
      return value;
    default:
      return "must-run";
  }
}

function isMissing(error: unknown): boolean {
  return !!error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: string }).code === "ENOENT";
}
