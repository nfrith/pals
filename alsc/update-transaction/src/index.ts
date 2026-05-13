import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deployClaudeSkills } from "../../compiler/src/claude-skills.ts";
import type { ConstructFailureState } from "../../compiler/src/construct-contracts.ts";
import type { ConstructActionManifest } from "../../compiler/src/construct-upgrade.ts";
import {
  applyTransientRuntimeCleanup,
  isTransientRuntimePath,
} from "../../shared/transient-runtime.ts";
import {
  inspectOperatorConfig,
  selectSingletonActiveOperator,
} from "../../compiler/src/operator-config.ts";
import { validateSystem } from "../../compiler/src/validate.ts";
import {
  createDashboardProcessDefinition,
  executeDelamainConstructUpgrade,
  executeProcessConstructUpgrade,
  executeStatuslineConstructUpgrade,
  preflightDelamainConstructUpgrade,
  preflightProcessConstructUpgrade,
  preflightStatuslineConstructUpgrade,
  runConstructActionManifest,
  type ConstructActionRunnerResult,
  type ConstructUpgradeExecuteResult,
  type ConstructUpgradePreflightResult,
  type ConstructUpgradePrompt,
} from "../../upgrade-construct/src/index.ts";
import {
  preflightLanguageUpgradeChain,
  type LanguageUpgradePreflightPrompt,
  type LanguageUpgradePreflightResult,
  type LanguageUpgradeSelectionOptions,
} from "../../upgrade-language/src/preflight.ts";
import {
  executeLanguageUpgradeChain,
  type LanguageUpgradeCheckpointMismatch,
  type LanguageUpgradePhaseHopTrace,
  type LanguageUpgradePhaseTrace,
} from "../../upgrade-language/src/runner.ts";
import type { PlannedLanguageUpgradeHop } from "../../upgrade-language/src/plan-chain.ts";

const UPDATE_STAGING_WORKTREE_PREFIX = ".als-update-staging-";
const UPDATE_TRANSACTION_LANGUAGE_RUN_OWNER = "update-transaction";
const TRANSIENT_RUNTIME_HYGIENE_CHECKPOINT_COMMIT_MESSAGE =
  "chore: checkpoint transient runtime hygiene before /update";
const CONSTRUCT_ORDER = ["dispatcher", "statusline", "dashboard"] as const;

type ConstructName = (typeof CONSTRUCT_ORDER)[number];

export interface UpdateTransactionLanguagePlan {
  current_als_version: number;
  target_als_version: number;
  hops: PlannedLanguageUpgradeHop[];
  options?: LanguageUpgradeSelectionOptions;
}

export interface UpdateTransactionPromptOption {
  value: string;
  label: string;
  description: string;
}

export interface UpdateTransactionPrompt {
  key: string;
  source: "language" | "construct";
  intent: string;
  markdown: string;
  options: UpdateTransactionPromptOption[];
  hop_id: string | null;
  step_id: string | null;
  construct: string | null;
  instance_id: string | null;
  display_name: string | null;
}

export interface UpdateTransactionBlockedResult {
  status: "blocked";
  reason: "dirty-live-tree" | "live-validation-failed" | "language-plan-mismatch";
  diagnostic: string;
}

export interface PreparedUpdateTransaction {
  status: "ready";
  repo_root: string;
  system_root: string;
  plugin_root: string;
  language: {
    plan: UpdateTransactionLanguagePlan;
    preflight: LanguageUpgradePreflightResult;
  } | null;
  constructs: Record<ConstructName, ConstructUpgradePreflightResult>;
  prompts: UpdateTransactionPrompt[];
  requires_changes: boolean;
  manual_follow_up_note: string | null;
}

export type UpdateTransactionPrepareResult =
  | UpdateTransactionBlockedResult
  | PreparedUpdateTransaction;

export interface UpdateTransactionPostcondition {
  code: string;
  phase: "language" | ConstructName;
  status: "satisfied" | "unresolved";
  severity: "required" | "warning";
  why: string;
  command_to_run: string | null;
  operator_input_required: boolean;
}

export interface UpdateTransactionServices {
  validate_system?(systemRoot: string): ReturnType<typeof validateSystem>;
  deploy_claude?(systemRoot: string): ReturnType<typeof deployClaudeSkills>;
  run_action_manifest?(
    manifest: ConstructActionManifest,
    input: {
      system_root: string;
      plugin_root: string;
    },
  ): Promise<ConstructActionRunnerResult> | ConstructActionRunnerResult;
  after_staging_created?(input: {
    live_repo_root: string;
    staging_repo_root: string;
    staging_system_root: string;
  }): Promise<void> | void;
  before_writeback?(input: {
    live_repo_root: string;
    staging_repo_root: string;
    staging_system_root: string;
    staging_commit_oid: string;
  }): Promise<void> | void;
}

export interface UpdateTransactionCompletedResult {
  status: "completed";
  commit_oid: string | null;
  commit_message: string | null;
  action_count: number;
  postconditions: UpdateTransactionPostcondition[];
  manual_follow_up_note: string | null;
  language_phase: LanguageUpgradePhaseTrace | null;
  language_error_code: string | null;
  language_checkpoint_mismatch: LanguageUpgradeCheckpointMismatch | null;
  construct_phase: UpdateTransactionConstructPhaseTrace;
}

export interface UpdateTransactionRequiresPostconditionInputResult {
  status: "requires_postcondition_input";
  commit_oid: string | null;
  commit_message: string | null;
  action_count: number;
  postconditions: UpdateTransactionPostcondition[];
  manual_follow_up_note: string | null;
  language_phase: LanguageUpgradePhaseTrace | null;
  language_error_code: string | null;
  language_checkpoint_mismatch: LanguageUpgradeCheckpointMismatch | null;
  construct_phase: UpdateTransactionConstructPhaseTrace;
}

export interface UpdateTransactionFailedResult {
  status: "failed";
  failure_surface: "validation-deploy-failed" | "commit-failed" | "lifecycle-failed";
  diagnostic: string;
  staging_worktree_path: string | null;
  commit_oid: string | null;
  lifecycle_failure_state: ConstructFailureState | null;
  precise_lifecycle_failure_state: Exclude<ConstructFailureState, "lifecycle-partial"> | null;
  postconditions: UpdateTransactionPostcondition[];
  manual_follow_up_note: string | null;
  language_phase: LanguageUpgradePhaseTrace | null;
  language_error_code: string | null;
  language_checkpoint_mismatch: LanguageUpgradeCheckpointMismatch | null;
  construct_phase: UpdateTransactionConstructPhaseTrace;
}

export type UpdateTransactionExecuteResult =
  | UpdateTransactionCompletedResult
  | UpdateTransactionRequiresPostconditionInputResult
  | UpdateTransactionFailedResult;

export interface UpdateTransactionConstructPhaseTrace {
  applied_constructs: string[];
  deltas: string[];
}

export async function prepareUpdateTransaction(input: {
  repo_root: string;
  system_root?: string;
  plugin_root: string;
  language_plan?: UpdateTransactionLanguagePlan | null;
}): Promise<UpdateTransactionPrepareResult> {
  const repoRoot = canonicalizeExistingPath(resolveGitRepoRoot(input.repo_root));
  const systemRoot = canonicalizeExistingPath(resolve(input.system_root ?? repoRoot));
  const pluginRoot = resolve(input.plugin_root);
  assertSystemRootWithinRepo(repoRoot, systemRoot);

  const initialDirtyPaths = readTrackedDirtyPaths(repoRoot);
  if (shouldCheckpointTransientRuntimePaths(initialDirtyPaths)) {
    applyTransientRuntimeCleanup({
      system_root: systemRoot,
      commit_message: TRANSIENT_RUNTIME_HYGIENE_CHECKPOINT_COMMIT_MESSAGE,
    });
  }

  const dirtyPaths = readTrackedDirtyPaths(repoRoot);
  if (dirtyPaths.length > 0) {
    return {
      status: "blocked",
      reason: "dirty-live-tree",
      diagnostic: `Tracked changes under .als/ or .claude/ must be committed or discarded before /update starts: ${dirtyPaths.join(", ")}`,
    };
  }

  const liveValidation = validateSystem(systemRoot);
  if (liveValidation.status === "fail") {
    return {
      status: "blocked",
      reason: "live-validation-failed",
      diagnostic: "Live ALS system validation failed before /update could stage any changes.",
    };
  }

  if (
    input.language_plan
    && liveValidation.als_version !== input.language_plan.current_als_version
  ) {
    return {
      status: "blocked",
      reason: "language-plan-mismatch",
      diagnostic: `Language plan expected ALS v${input.language_plan.current_als_version}, but the live system validated as v${liveValidation.als_version ?? "<missing>"}.`,
    };
  }

  const language = input.language_plan
    ? {
      plan: input.language_plan,
      preflight: await preflightLanguageUpgradeChain({
        current_als_version: input.language_plan.current_als_version,
        target_als_version: input.language_plan.target_als_version,
        hops: input.language_plan.hops,
        options: input.language_plan.options,
      }),
    }
    : null;
  const constructs = await preflightConstructs(systemRoot, pluginRoot);
  const prompts = [
    ...(language?.preflight.prompts.map(toLanguagePrompt) ?? []),
    ...constructs.dispatcher.prompts.map(toConstructPrompt),
    ...constructs.statusline.prompts.map(toConstructPrompt),
    ...constructs.dashboard.prompts.map(toConstructPrompt),
  ];
  const requiresChanges = (language?.plan.hops.length ?? 0) > 0
    || CONSTRUCT_ORDER.some((name) => constructs[name].needs_upgrade);

  return {
    status: "ready",
    repo_root: repoRoot,
    system_root: systemRoot,
    plugin_root: pluginRoot,
    language,
    constructs,
    prompts,
    requires_changes: requiresChanges,
    manual_follow_up_note: constructs.statusline.needs_upgrade
      ? "If statusline data goes stale, run `/reload-plugins`."
      : null,
  };
}

export async function runPreparedUpdateTransaction(input: {
  prepared: PreparedUpdateTransaction;
  operator_answers?: Record<string, string>;
  services?: UpdateTransactionServices;
}): Promise<UpdateTransactionExecuteResult> {
  const prepared = input.prepared;
  const services = withDefaultServices(input.services);
  const emptyConstructPhase = buildConstructPhaseTrace([]);
  if (!prepared.requires_changes) {
    return buildSuccessfulResult({
      commit_oid: null,
      commit_message: null,
      action_count: 0,
      postconditions: [],
      language_phase: null,
      language_error_code: null,
      language_checkpoint_mismatch: null,
      construct_phase: emptyConstructPhase,
    });
  }

  await pruneStaleUpdateWorktrees(prepared.repo_root);
  const stagingRepoRoot = join(
    dirname(prepared.repo_root),
    `${UPDATE_STAGING_WORKTREE_PREFIX}${randomUUID()}`,
  );
  runGit(prepared.repo_root, ["worktree", "add", "--detach", stagingRepoRoot, "HEAD"]);

  const systemSubpath = relative(prepared.repo_root, prepared.system_root);
  const stagingSystemRoot = systemSubpath.length > 0
    ? resolve(stagingRepoRoot, systemSubpath)
    : stagingRepoRoot;
  await services.after_staging_created({
    live_repo_root: prepared.repo_root,
    staging_repo_root: stagingRepoRoot,
    staging_system_root: stagingSystemRoot,
  });

  const operatorAnswers = { ...(input.operator_answers ?? {}) };
  let languagePhase: LanguageUpgradePhaseTrace | null = null;
  let languageErrorCode: string | null = null;
  let languageCheckpointMismatch: LanguageUpgradeCheckpointMismatch | null = null;
  const stagedConstructResults: ConstructUpgradeExecuteResult[] = [];

  if (prepared.language) {
    const languageStatePath = join(
      stagingRepoRoot,
      ".als-update-transaction",
      "language-upgrades",
      "state.json",
    );
    const executeResult = await executeLanguageUpgradeChain({
      system_root: stagingSystemRoot,
      hops: prepared.language.plan.hops,
      target_als_version: prepared.language.plan.target_als_version,
      services: {
        inspect_system(systemRoot) {
          const result = services.validate_system(systemRoot);
          return {
            als_version: result.als_version,
            status: result.status,
          };
        },
      },
      options: {
        ...(prepared.language.plan.options ?? {}),
        run_owner: UPDATE_TRANSACTION_LANGUAGE_RUN_OWNER,
        state_path: languageStatePath,
        operator_responses: operatorAnswers,
      },
    });
    languagePhase = executeResult.phase;
    languageErrorCode = executeResult.error_code;
    languageCheckpointMismatch = executeResult.checkpoint_mismatch;
    if (executeResult.status !== "completed") {
      return buildFailureResult(
        "validation-deploy-failed",
        executeResult.diagnostic ?? "Language-upgrade execute failed inside the staging worktree.",
        stagingRepoRoot,
        null,
        [],
        languagePhase,
        languageErrorCode,
        languageCheckpointMismatch,
        buildConstructPhaseTrace(stagedConstructResults),
      );
    }
  }

  try {
    if (prepared.constructs.dispatcher.needs_upgrade) {
      stagedConstructResults.push(await executeDelamainConstructUpgrade({
        live_system_root: prepared.system_root,
        staging_system_root: stagingSystemRoot,
        plugin_root: prepared.plugin_root,
        operator_answers: operatorAnswers,
      }));
    }

    if (prepared.constructs.statusline.needs_upgrade) {
      stagedConstructResults.push(await executeStatuslineConstructUpgrade({
        live_system_root: prepared.system_root,
        staging_system_root: stagingSystemRoot,
        plugin_root: prepared.plugin_root,
      }));
    }

    if (prepared.constructs.dashboard.needs_upgrade) {
      stagedConstructResults.push(await executeProcessConstructUpgrade({
        live_system_root: prepared.system_root,
        staging_system_root: stagingSystemRoot,
        plugin_root: prepared.plugin_root,
        definition: createDashboardProcessDefinition(prepared.plugin_root),
      }));
    }
  } catch (error) {
    return buildFailureResult(
      "validation-deploy-failed",
      formatError(error),
      stagingRepoRoot,
      null,
      [],
      languagePhase,
      languageErrorCode,
      languageCheckpointMismatch,
      buildConstructPhaseTrace(stagedConstructResults),
    );
  }

  const stagedValidation = services.validate_system(stagingSystemRoot);
  if (stagedValidation.status === "fail") {
    return buildFailureResult(
      "validation-deploy-failed",
      "Staged ALS system validation failed before commit.",
      stagingRepoRoot,
      null,
      [],
      languagePhase,
      languageErrorCode,
      languageCheckpointMismatch,
      buildConstructPhaseTrace(stagedConstructResults),
    );
  }

  const deploy = services.deploy_claude(stagingSystemRoot);
  if (deploy.status === "fail") {
    return buildFailureResult(
      "validation-deploy-failed",
      deploy.error ?? "Bundled-surface refresh failed inside the staging worktree.",
      stagingRepoRoot,
      null,
      [],
      languagePhase,
      languageErrorCode,
      languageCheckpointMismatch,
      buildConstructPhaseTrace(stagedConstructResults),
    );
  }

  const constructPhase = buildConstructPhaseTrace(stagedConstructResults);
  try {
    runGit(stagingRepoRoot, ["add", "-A", "--", ".als", ".claude"]);
    const stagedPaths = readCachedChangedPaths(stagingRepoRoot);
    const languageInvariantFailure = validateLanguageCommitTruth({
      prepared,
      language_phase: languagePhase,
      staged_validation_als_version: stagedValidation.als_version,
      staged_paths: stagedPaths,
    });
    if (languageInvariantFailure) {
      return buildFailureResult(
        "validation-deploy-failed",
        languageInvariantFailure,
        stagingRepoRoot,
        null,
        [],
        languagePhase,
        languageErrorCode,
        languageCheckpointMismatch,
        constructPhase,
      );
    }
    if (stagedPaths.length === 0) {
      await removeWorktree(prepared.repo_root, stagingRepoRoot);
      return buildSuccessfulResult({
        commit_oid: null,
        commit_message: null,
        action_count: 0,
        postconditions: [],
        language_phase: languagePhase,
        language_error_code: languageErrorCode,
        language_checkpoint_mismatch: languageCheckpointMismatch,
        construct_phase: constructPhase,
      });
    }
    const commitMessage = buildCommitMessage(languagePhase, constructPhase);
    runGit(stagingRepoRoot, ["commit", "--no-gpg-sign", "-m", commitMessage]);
    const commitOid = runGit(stagingRepoRoot, ["rev-parse", "HEAD"]).stdout.trim();
    try {
      await services.before_writeback({
        live_repo_root: prepared.repo_root,
        staging_repo_root: stagingRepoRoot,
        staging_system_root: stagingSystemRoot,
        staging_commit_oid: commitOid,
      });
      runGit(prepared.repo_root, ["merge", "--ff-only", commitOid]);
    } catch (error) {
      return buildFailureResult(
        "commit-failed",
        formatError(error),
        stagingRepoRoot,
        commitOid,
        [],
        languagePhase,
        languageErrorCode,
        languageCheckpointMismatch,
        constructPhase,
      );
    }

    const actionManifest = combineActionManifests(stagedConstructResults);
    const postconditions = [
      ...buildLanguagePhasePostconditions(prepared, languagePhase),
      ...evaluateActiveOperatorPostconditions(prepared),
      ...buildWarningPostconditions(prepared),
    ];
    try {
      await runStatuslineCutoverIfNeeded(prepared, stagedConstructResults);
    } catch (error) {
      await removeWorktree(prepared.repo_root, stagingRepoRoot);
      return {
        status: "failed",
        failure_surface: "lifecycle-failed",
        diagnostic: formatError(error),
        staging_worktree_path: null,
        commit_oid: commitOid,
        lifecycle_failure_state: null,
        precise_lifecycle_failure_state: null,
        postconditions,
        manual_follow_up_note: synthesizeManualFollowUpNote(postconditions),
        language_phase: languagePhase,
        language_error_code: languageErrorCode,
        language_checkpoint_mismatch: languageCheckpointMismatch,
        construct_phase: constructPhase,
      };
    }
    if (actionManifest.actions.length > 0) {
      try {
        const lifecycle = await services.run_action_manifest(actionManifest, {
          system_root: prepared.system_root,
          plugin_root: prepared.plugin_root,
        });
        if (!lifecycle.success) {
          await removeWorktree(prepared.repo_root, stagingRepoRoot);
          return {
            status: "failed",
            failure_surface: "lifecycle-failed",
            diagnostic: lifecycle.failure?.message ?? "Post-commit lifecycle execution failed.",
            staging_worktree_path: null,
            commit_oid: commitOid,
            lifecycle_failure_state: lifecycle.failure?.overall_failure_state ?? null,
            precise_lifecycle_failure_state: lifecycle.failure?.precise_failure_state ?? null,
            postconditions,
            manual_follow_up_note: synthesizeManualFollowUpNote(postconditions),
            language_phase: languagePhase,
            language_error_code: languageErrorCode,
            language_checkpoint_mismatch: languageCheckpointMismatch,
            construct_phase: constructPhase,
          };
        }
      } catch (error) {
        await removeWorktree(prepared.repo_root, stagingRepoRoot);
        return {
          status: "failed",
          failure_surface: "lifecycle-failed",
          diagnostic: formatError(error),
          staging_worktree_path: null,
          commit_oid: commitOid,
          lifecycle_failure_state: null,
          precise_lifecycle_failure_state: null,
          postconditions,
          manual_follow_up_note: synthesizeManualFollowUpNote(postconditions),
          language_phase: languagePhase,
          language_error_code: languageErrorCode,
          language_checkpoint_mismatch: languageCheckpointMismatch,
          construct_phase: constructPhase,
        };
      }
    }

    await removeWorktree(prepared.repo_root, stagingRepoRoot);
    return buildSuccessfulResult({
      commit_oid: commitOid,
      commit_message: commitMessage,
      action_count: actionManifest.actions.length,
      postconditions: [
        ...postconditions,
        ...buildLifecycleSuccessPostconditions(actionManifest),
      ],
      language_phase: languagePhase,
      language_error_code: languageErrorCode,
      language_checkpoint_mismatch: languageCheckpointMismatch,
      construct_phase: constructPhase,
    });
  } catch (error) {
    return buildFailureResult(
      "commit-failed",
      formatError(error),
      stagingRepoRoot,
      null,
      [],
      languagePhase,
      languageErrorCode,
      languageCheckpointMismatch,
      constructPhase,
    );
  }
}

async function preflightConstructs(
  systemRoot: string,
  pluginRoot: string,
): Promise<Record<ConstructName, ConstructUpgradePreflightResult>> {
  return {
    dispatcher: await preflightDelamainConstructUpgrade({
      system_root: systemRoot,
      plugin_root: pluginRoot,
    }),
    statusline: await preflightStatuslineConstructUpgrade({
      system_root: systemRoot,
      plugin_root: pluginRoot,
    }),
    dashboard: await preflightProcessConstructUpgrade({
      system_root: systemRoot,
      plugin_root: pluginRoot,
      definition: createDashboardProcessDefinition(pluginRoot),
    }),
  };
}

function toLanguagePrompt(prompt: LanguageUpgradePreflightPrompt): UpdateTransactionPrompt {
  return {
    key: prompt.key,
    source: "language",
    intent: prompt.intent,
    markdown: prompt.markdown,
    options: prompt.options,
    hop_id: prompt.hop_id,
    step_id: prompt.step_id,
    construct: null,
    instance_id: null,
    display_name: null,
  };
}

function toConstructPrompt(prompt: ConstructUpgradePrompt): UpdateTransactionPrompt {
  return {
    key: prompt.key,
    source: "construct",
    intent: prompt.intent,
    markdown: prompt.markdown,
    options: prompt.options,
    hop_id: null,
    step_id: null,
    construct: prompt.construct,
    instance_id: prompt.instance_id,
    display_name: prompt.display_name,
  };
}

function buildCommitMessage(
  languagePhase: LanguageUpgradePhaseTrace | null,
  constructPhase: UpdateTransactionConstructPhaseTrace,
): string {
  const lines: string[] = [];
  const appliedLanguageHops = (languagePhase?.hops ?? [])
    .filter((hop) => hop.status === "applied")
    .map((hop) => hop.hop_id);
  if (appliedLanguageHops.length > 0) {
    lines.push(
      `Language hops: ${appliedLanguageHops.join(", ")}`,
    );
  }

  if (constructPhase.deltas.length > 0) {
    lines.push(`Construct deltas: ${constructPhase.deltas.join("; ")}`);
  }

  if (lines.length === 0) {
    lines.push("Refresh ALS runtime surfaces.");
  }

  return [
    "chore: apply ALS update transaction",
    "",
    ...lines,
  ].join("\n");
}

function combineActionManifests(
  constructResults: ConstructUpgradeExecuteResult[],
): ConstructActionManifest {
  return {
    schema: "als-construct-action-manifest@1",
    actions: constructResults.flatMap((result) => result.action_manifest?.actions ?? []),
  };
}

function buildConstructPhaseTrace(
  constructResults: ConstructUpgradeExecuteResult[],
): UpdateTransactionConstructPhaseTrace {
  const appliedConstructs = constructResults
    .filter((result) => result.needs_upgrade)
    .map((result) => result.construct);
  const deltas = constructResults
    .filter((result) => result.needs_upgrade)
    .map((result) => `${result.construct} ${result.current_version ?? 0} -> ${result.target_version}`);
  return {
    applied_constructs: appliedConstructs,
    deltas,
  };
}

function buildLanguagePhasePostconditions(
  prepared: PreparedUpdateTransaction,
  languagePhase: LanguageUpgradePhaseTrace | null,
): UpdateTransactionPostcondition[] {
  if (!prepared.language || prepared.language.plan.hops.length === 0) {
    return [];
  }

  const appliedHopIds = (languagePhase?.hops ?? [])
    .filter((hop) => hop.status === "applied")
    .map((hop) => hop.hop_id);
  if (appliedHopIds.length === 0) {
    return [];
  }

  return [{
    code: "language.target-version-landed",
    phase: "language",
    status: "satisfied",
    severity: "required",
    why: `Language hops ${appliedHopIds.join(", ")} landed and validated as ALS v${prepared.language.plan.target_als_version}.`,
    command_to_run: null,
    operator_input_required: false,
  }];
}

function evaluateActiveOperatorPostconditions(
  prepared: PreparedUpdateTransaction,
): UpdateTransactionPostcondition[] {
  const inspection = inspectOperatorConfig(prepared.system_root);
  if (!inspection || !inspection.roster.exists) {
    return [];
  }

  if (inspection.status === "pass" && inspection.active_selection.exists) {
    return [{
      code: "language.active-operator-selector",
      phase: "language",
      status: "satisfied",
      severity: "required",
      why: `Machine-local active-operator selector is present and valid at ${inspection.active_selection.file_path}.`,
      command_to_run: null,
      operator_input_required: false,
    }];
  }

  const selectionWrite = selectSingletonActiveOperator(prepared.system_root);
  if (selectionWrite.status === "pass") {
    return [{
      code: "language.active-operator-selector",
      phase: "language",
      status: "satisfied",
      severity: "required",
      why: `Wrapper wrote the machine-local active-operator selector for singleton roster entry '${selectionWrite.operator_id}'.`,
      command_to_run: null,
      operator_input_required: false,
    }];
  }

  const operatorConfigCli = resolve(prepared.plugin_root, "alsc", "compiler", "src", "cli.ts");
  const operatorChoiceRequired = inspection.roster.operator_ids.length > 1;
  return [{
    code: "language.active-operator-selector",
    phase: "language",
    status: "unresolved",
    severity: "required",
    why: operatorChoiceRequired
      ? `Machine-local active-operator selection still requires an explicit operator choice. ${selectionWrite.error ?? "Choose one roster entry before dispatch resumes."}`
      : selectionWrite.error ?? "Machine-local active-operator selection is still unresolved after the update commit landed.",
    command_to_run: operatorChoiceRequired
      ? `bun ${operatorConfigCli} operator-config set-active "${prepared.system_root}" <operator-id>`
      : `bun ${operatorConfigCli} operator-config inspect "${prepared.system_root}"`,
    operator_input_required: operatorChoiceRequired,
  }];
}

function buildWarningPostconditions(
  prepared: PreparedUpdateTransaction,
): UpdateTransactionPostcondition[] {
  const postconditions: UpdateTransactionPostcondition[] = [];
  if (prepared.constructs.statusline.needs_upgrade) {
    postconditions.push({
      code: "statusline.data-freshness",
      phase: "statusline",
      status: "unresolved",
      severity: "warning",
      why: "Statusline pulse now lives under Claude's plugin MCP lifecycle. If the cache stays stale after this update, reload the plugin MCP servers to respawn pulse.",
      command_to_run: "/reload-plugins",
      operator_input_required: false,
    });
  }
  return postconditions;
}

function buildLifecycleSuccessPostconditions(
  actionManifest: ConstructActionManifest,
): UpdateTransactionPostcondition[] {
  const constructs = new Set<ConstructName>();
  for (const action of actionManifest.actions) {
    if (action.construct === "dispatcher" || action.construct === "statusline" || action.construct === "dashboard") {
      constructs.add(action.construct);
    }
  }

  return Array.from(constructs).map((construct) => ({
    code: `${construct}.lifecycle-actions-completed`,
    phase: construct,
    status: "satisfied",
    severity: "required",
    why: `Wrapper completed post-commit ${construct} lifecycle actions without a wrapper-level failure.`,
    command_to_run: null,
    operator_input_required: false,
  }));
}

function buildSuccessfulResult(input: {
  commit_oid: string | null;
  commit_message: string | null;
  action_count: number;
  postconditions: UpdateTransactionPostcondition[];
  language_phase: LanguageUpgradePhaseTrace | null;
  language_error_code: string | null;
  language_checkpoint_mismatch: LanguageUpgradeCheckpointMismatch | null;
  construct_phase: UpdateTransactionConstructPhaseTrace;
}): UpdateTransactionCompletedResult | UpdateTransactionRequiresPostconditionInputResult {
  const manualFollowUpNote = synthesizeManualFollowUpNote(input.postconditions);
  const requiresOperatorInput = input.postconditions.some((postcondition) =>
    postcondition.status === "unresolved" && postcondition.severity === "required",
  );

  return {
    status: requiresOperatorInput ? "requires_postcondition_input" : "completed",
    commit_oid: input.commit_oid,
    commit_message: input.commit_message,
    action_count: input.action_count,
    postconditions: input.postconditions,
    manual_follow_up_note: manualFollowUpNote,
    language_phase: input.language_phase,
    language_error_code: input.language_error_code,
    language_checkpoint_mismatch: input.language_checkpoint_mismatch,
    construct_phase: input.construct_phase,
  };
}

async function runStatuslineCutoverIfNeeded(
  prepared: PreparedUpdateTransaction,
  constructResults: ConstructUpgradeExecuteResult[],
): Promise<void> {
  const statuslineResult = constructResults.find((result) => result.construct === "statusline");
  if (!statuslineResult?.needs_upgrade || statuslineResult.target_version < 2) {
    return;
  }

  const migrationPath = join(
    prepared.plugin_root,
    "statusline",
    "migrations",
    "v1-to-v2.ts",
  );
  const migrationModule = await import(pathToFileURL(migrationPath).href) as {
    migrate?: (context: {
      system_root: string;
      target_root: string;
      construct_name: string;
      instance_id: string | null;
      from_version: number;
      to_version: number;
    }) => Promise<void>;
  };

  if (typeof migrationModule.migrate !== "function") {
    throw new Error(`Statusline cutover migration is missing migrate() at ${migrationPath}.`);
  }

  await migrationModule.migrate({
    system_root: prepared.system_root,
    target_root: prepared.system_root,
    construct_name: "statusline",
    instance_id: null,
    from_version: Math.max(statuslineResult.current_version ?? 1, 1),
    to_version: 2,
  });
}

function validateLanguageCommitTruth(input: {
  prepared: PreparedUpdateTransaction;
  language_phase: LanguageUpgradePhaseTrace | null;
  staged_validation_als_version: number | null | undefined;
  staged_paths: string[];
}): string | null {
  const preparedLanguage = input.prepared.language;
  if (!preparedLanguage || preparedLanguage.plan.hops.length === 0) {
    return null;
  }

  if (input.staged_validation_als_version !== preparedLanguage.plan.target_als_version) {
    return `Prepared language target ALS v${preparedLanguage.plan.target_als_version} did not land in staged validation; staged tree still reports v${input.staged_validation_als_version ?? "<missing>"}.`;
  }

  if (!input.language_phase) {
    return "Prepared language hops were requested, but the execute result did not return a language phase trace.";
  }

  const appliedHops = input.language_phase.hops.filter((hop) => hop.status === "applied");
  if (appliedHops.length === 0) {
    return "Prepared language hops were requested, but the execute result did not report any applied language hop.";
  }

  const stagedLanguagePaths = input.staged_paths.filter(isNonRuntimeAlsPath);
  if (stagedLanguagePaths.length === 0) {
    return "Prepared language hop did not produce required staged non-runtime .als/ mutations.";
  }

  for (const hop of appliedHops) {
    if (!hopRequiresMutatingProof(hop)) {
      continue;
    }

    const hopProofPaths = hop.mutated_paths.filter(isNonRuntimeAlsPath);
    if (hopProofPaths.length === 0) {
      return `Applied language hop '${hop.hop_id}' did not report any non-runtime .als/ mutations.`;
    }

    const stagedHopProof = hopProofPaths.filter((path) => stagedLanguagePaths.includes(path));
    if (stagedHopProof.length === 0) {
      return `Applied language hop '${hop.hop_id}' reported mutations, but none are present in the staged commit diff.`;
    }
  }

  const stagedClaudePaths = input.staged_paths.filter((path) => path === ".claude" || path.startsWith(".claude/"));
  if (stagedClaudePaths.length === 0) {
    return "Language-authored .als/ mutations landed, but the bundled .claude/ refresh is absent from the staged commit.";
  }

  return null;
}

function hopRequiresMutatingProof(hop: LanguageUpgradePhaseHopTrace): boolean {
  return hop.steps.some((step) =>
    step.category === "must-run"
    && (step.type === "script" || step.type === "agent-task")
    && (step.status === "completed" || step.status === "recovered"),
  );
}

function isNonRuntimeAlsPath(path: string): boolean {
  if (path === ".als" || path === ".als/runtime" || path.startsWith(".als/runtime/")) {
    return false;
  }
  return path.startsWith(".als/");
}

function resolveGitRepoRoot(repoRoot: string): string {
  return runGit(repoRoot, ["rev-parse", "--show-toplevel"]).stdout.trim();
}

function canonicalizeExistingPath(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return resolve(filePath);
  }
}

function assertSystemRootWithinRepo(repoRoot: string, systemRoot: string): void {
  const rel = relative(repoRoot, systemRoot);
  if (rel.startsWith("..") || rel === "..") {
    throw new Error(`System root '${systemRoot}' must live inside repo root '${repoRoot}'.`);
  }
}

function readTrackedDirtyPaths(repoRoot: string): string[] {
  const output = runGit(repoRoot, ["status", "--porcelain", "--untracked-files=no", "--", ".als", ".claude"]).stdout;
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3));
}

function shouldCheckpointTransientRuntimePaths(dirtyPaths: string[]): boolean {
  return dirtyPaths.length > 0
    && dirtyPaths.every((path) => path.startsWith(".claude/") && isTransientRuntimePath(path));
}

function readCachedChangedPaths(repoRoot: string): string[] {
  return runGit(repoRoot, ["diff", "--cached", "--name-only", "--", ".als", ".claude"]).stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function pruneStaleUpdateWorktrees(repoRoot: string): Promise<void> {
  const registeredPaths = runGit(repoRoot, ["worktree", "list", "--porcelain"]).stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .filter((path) => basename(path).startsWith(UPDATE_STAGING_WORKTREE_PREFIX));
  for (const path of registeredPaths) {
    await removeWorktree(repoRoot, path);
  }

  const parentDir = dirname(repoRoot);
  for (const entry of await readdir(parentDir, { withFileTypes: true })) {
    if (!entry.name.startsWith(UPDATE_STAGING_WORKTREE_PREFIX)) {
      continue;
    }
    const fullPath = join(parentDir, entry.name);
    if (registeredPaths.includes(fullPath)) {
      continue;
    }
    await rm(fullPath, { recursive: true, force: true });
  }
}

async function removeWorktree(repoRoot: string, worktreePath: string): Promise<void> {
  runGitAllowFailure(repoRoot, ["worktree", "remove", "--force", worktreePath]);
  await rm(worktreePath, { recursive: true, force: true });
  runGitAllowFailure(repoRoot, ["worktree", "prune"]);
}

function runGit(
  repoRoot: string,
  args: string[],
): { status: number; stdout: string; stderr: string } {
  const result = runGitAllowFailure(repoRoot, args);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`);
  }
  return result;
}

function runGitAllowFailure(
  repoRoot: string,
  args: string[],
): { status: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    status: result.exitCode,
    stdout: Buffer.from(result.stdout).toString("utf-8"),
    stderr: Buffer.from(result.stderr).toString("utf-8"),
  };
}

function withDefaultServices(
  services: UpdateTransactionServices | undefined,
): Required<UpdateTransactionServices> {
  return {
    validate_system: services?.validate_system ?? validateSystem,
    deploy_claude: services?.deploy_claude ?? deployClaudeSkills,
    run_action_manifest: services?.run_action_manifest ?? ((manifest, input) => runConstructActionManifest(manifest, {
      system_root: input.system_root,
      plugin_root: input.plugin_root,
    })),
    after_staging_created: services?.after_staging_created ?? (() => {}),
    before_writeback: services?.before_writeback ?? (() => {}),
  };
}

function buildFailureResult(
  surface: UpdateTransactionFailedResult["failure_surface"],
  diagnostic: string,
  stagingWorktreePath: string | null,
  commitOid: string | null,
  postconditions: UpdateTransactionPostcondition[],
  languagePhase: LanguageUpgradePhaseTrace | null,
  languageErrorCode: string | null,
  languageCheckpointMismatch: LanguageUpgradeCheckpointMismatch | null,
  constructPhase: UpdateTransactionConstructPhaseTrace,
): UpdateTransactionFailedResult {
  return {
    status: "failed",
    failure_surface: surface,
    diagnostic,
    staging_worktree_path: stagingWorktreePath,
    commit_oid: commitOid,
    lifecycle_failure_state: null,
    precise_lifecycle_failure_state: null,
    postconditions,
    manual_follow_up_note: synthesizeManualFollowUpNote(postconditions),
    language_phase: languagePhase,
    language_error_code: languageErrorCode,
    language_checkpoint_mismatch: languageCheckpointMismatch,
    construct_phase: constructPhase,
  };
}

function synthesizeManualFollowUpNote(
  postconditions: UpdateTransactionPostcondition[],
): string | null {
  const surfaced = postconditions.filter((postcondition) => postcondition.status === "unresolved");
  if (surfaced.length === 0) {
    return null;
  }

  return surfaced.map((postcondition) => {
    const prefix = postcondition.severity === "required" ? "Required" : "Warning";
    const command = postcondition.command_to_run ? ` Command: ${postcondition.command_to_run}.` : "";
    return `${prefix}: ${postcondition.why}${command}`;
  }).join("\n");
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
