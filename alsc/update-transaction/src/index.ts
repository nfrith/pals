import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { deployHarnessProjection } from "../../compiler/src/harness-projection.ts";
import type { ConstructFailureState } from "../../compiler/src/construct-contracts.ts";
import type { ConstructActionManifest } from "../../compiler/src/construct-upgrade.ts";
import {
  getHarnessRuntimeSpec,
  type HarnessTarget,
  type HarnessUpdateConstruct,
  type HarnessUpdateConstructSupport,
  type HarnessRuntimeSpec,
} from "../../shared/harnesses.ts";
import {
  applyTransientRuntimeCleanup,
  isTransientRuntimePath,
} from "../../shared/transient-runtime.ts";
import { validateSystem } from "../../compiler/src/validate.ts";
import {
  createDashboardProcessDefinition,
  createStatuslineProcessDefinition,
  executeDelamainConstructUpgrade,
  executeProcessConstructUpgrade,
  preflightDelamainConstructUpgrade,
  preflightProcessConstructUpgrade,
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
import { executeLanguageUpgradeChain } from "../../upgrade-language/src/runner.ts";
import type { PlannedLanguageUpgradeHop } from "../../upgrade-language/src/plan-chain.ts";

const UPDATE_STAGING_WORKTREE_PREFIX = ".als-update-staging-";
const TRANSIENT_RUNTIME_HYGIENE_CHECKPOINT_COMMIT_MESSAGE =
  "chore: checkpoint transient runtime hygiene before /update";
const CONSTRUCT_ORDER: readonly HarnessUpdateConstruct[] = ["dispatcher", "statusline", "dashboard"];

type ConstructName = HarnessUpdateConstruct;
type ProcessConstructName = Exclude<ConstructName, "dispatcher">;

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
  harness: HarnessTarget;
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

export interface UpdateTransactionServices {
  validate_system?(systemRoot: string): ReturnType<typeof validateSystem>;
  deploy_harness_projection?(
    target: HarnessTarget,
    systemRoot: string,
  ): ReturnType<typeof deployHarnessProjection>;
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
  manual_follow_up_note: string | null;
}

export interface UpdateTransactionFailedResult {
  status: "failed";
  failure_surface: "validation-deploy-failed" | "commit-failed" | "lifecycle-failed";
  diagnostic: string;
  staging_worktree_path: string | null;
  commit_oid: string | null;
  lifecycle_failure_state: ConstructFailureState | null;
  precise_lifecycle_failure_state: Exclude<ConstructFailureState, "lifecycle-partial"> | null;
  manual_follow_up_note: string | null;
}

export type UpdateTransactionExecuteResult =
  | UpdateTransactionCompletedResult
  | UpdateTransactionFailedResult;

export async function prepareUpdateTransaction(input: {
  repo_root: string;
  system_root?: string;
  plugin_root: string;
  harness?: HarnessTarget;
  language_plan?: UpdateTransactionLanguagePlan | null;
}): Promise<UpdateTransactionPrepareResult> {
  const repoRoot = canonicalizeExistingPath(resolveGitRepoRoot(input.repo_root));
  const systemRoot = canonicalizeExistingPath(resolve(input.system_root ?? repoRoot));
  const pluginRoot = resolve(input.plugin_root);
  const harness = input.harness ?? "claude";
  assertSystemRootWithinRepo(repoRoot, systemRoot);

  const initialDirtyPaths = readTrackedDirtyPaths(repoRoot, harness);
  if (shouldCheckpointTransientRuntimePaths(initialDirtyPaths)) {
    applyTransientRuntimeCleanup({
      system_root: systemRoot,
      commit_message: TRANSIENT_RUNTIME_HYGIENE_CHECKPOINT_COMMIT_MESSAGE,
    });
  }

  const dirtyPaths = readTrackedDirtyPaths(repoRoot, harness);
  if (dirtyPaths.length > 0) {
    const rootList = formatRootList(trackedRootsForHarness(harness));
    return {
      status: "blocked",
      reason: "dirty-live-tree",
      diagnostic: `Tracked changes under ${rootList} must be committed or discarded before /update starts: ${dirtyPaths.join(", ")}`,
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
  const constructs = await preflightConstructs(systemRoot, pluginRoot, harness);
  const prompts = [
    ...(language?.preflight.prompts.map(toLanguagePrompt) ?? []),
    ...CONSTRUCT_ORDER.flatMap((name) => constructs[name].prompts.map(toConstructPrompt)),
  ];
  const requiresChanges = (language?.plan.hops.length ?? 0) > 0
    || CONSTRUCT_ORDER.some((name) => constructs[name].needs_upgrade);

  return {
    status: "ready",
    repo_root: repoRoot,
    system_root: systemRoot,
    plugin_root: pluginRoot,
    harness,
    language,
    constructs,
    prompts,
    requires_changes: requiresChanges,
    manual_follow_up_note: updateTransactionManualFollowUpNote(harness, constructs),
  };
}

export async function runPreparedUpdateTransaction(input: {
  prepared: PreparedUpdateTransaction;
  operator_answers?: Record<string, string>;
  services?: UpdateTransactionServices;
}): Promise<UpdateTransactionExecuteResult> {
  const prepared = {
    ...input.prepared,
    harness: input.prepared.harness ?? "claude",
  };
  const services = withDefaultServices(input.services);
  if (!prepared.requires_changes) {
    return {
      status: "completed",
      commit_oid: null,
      commit_message: null,
      action_count: 0,
      manual_follow_up_note: prepared.manual_follow_up_note,
    };
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
  const stagedConstructResults: ConstructUpgradeExecuteResult[] = [];

  if (prepared.language) {
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
        operator_responses: operatorAnswers,
      },
    });
    if (executeResult.status !== "completed") {
      return buildFailureResult(
        "validation-deploy-failed",
        executeResult.diagnostic ?? "Language-upgrade execute failed inside the staging worktree.",
        stagingRepoRoot,
        null,
        prepared.manual_follow_up_note,
      );
    }
  }

  try {
    for (const construct of CONSTRUCT_ORDER) {
      if (!prepared.constructs[construct].needs_upgrade) {
        continue;
      }

      if (construct === "dispatcher") {
        stagedConstructResults.push(await executeDelamainConstructUpgrade({
          live_system_root: prepared.system_root,
          staging_system_root: stagingSystemRoot,
          plugin_root: prepared.plugin_root,
          operator_answers: operatorAnswers,
          harness: prepared.harness,
        }));
        continue;
      }

      stagedConstructResults.push(await executeProcessConstructUpgrade({
        live_system_root: prepared.system_root,
        staging_system_root: stagingSystemRoot,
        plugin_root: prepared.plugin_root,
        definition: createProcessDefinition(construct, prepared.plugin_root, prepared.harness),
      }));
    }
  } catch (error) {
    return buildFailureResult(
      "validation-deploy-failed",
      formatError(error),
      stagingRepoRoot,
      null,
      prepared.manual_follow_up_note,
    );
  }

  const stagedValidation = services.validate_system(stagingSystemRoot);
  if (stagedValidation.status === "fail") {
    return buildFailureResult(
      "validation-deploy-failed",
      "Staged ALS system validation failed before commit.",
      stagingRepoRoot,
      null,
      prepared.manual_follow_up_note,
    );
  }

  const deploy = services.deploy_harness_projection(prepared.harness, stagingSystemRoot);
  if (deploy.status === "fail") {
    return buildFailureResult(
      "validation-deploy-failed",
      deploy.error ?? "Bundled-surface refresh failed inside the staging worktree.",
      stagingRepoRoot,
      null,
      prepared.manual_follow_up_note,
    );
  }

  const commitMessage = buildCommitMessage(prepared, stagedConstructResults);
  try {
    runGit(stagingRepoRoot, ["add", "-A", "--", ...trackedRootsForHarness(prepared.harness)]);
    if (!hasCachedChanges(stagingRepoRoot)) {
      await removeWorktree(prepared.repo_root, stagingRepoRoot);
      return {
        status: "completed",
        commit_oid: null,
        commit_message: null,
        action_count: 0,
        manual_follow_up_note: prepared.manual_follow_up_note,
      };
    }
    runGit(stagingRepoRoot, ["commit", "--no-gpg-sign", "-m", commitMessage]);
  } catch (error) {
    return buildFailureResult(
      "commit-failed",
      formatError(error),
      stagingRepoRoot,
      null,
      prepared.manual_follow_up_note,
    );
  }

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
      prepared.manual_follow_up_note,
    );
  }

  const actionManifest = combineActionManifests(stagedConstructResults);
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
          manual_follow_up_note: prepared.manual_follow_up_note,
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
        manual_follow_up_note: prepared.manual_follow_up_note,
      };
    }
  }

  await removeWorktree(prepared.repo_root, stagingRepoRoot);
  return {
    status: "completed",
    commit_oid: commitOid,
    commit_message: commitMessage,
    action_count: actionManifest.actions.length,
    manual_follow_up_note: prepared.manual_follow_up_note,
  };
}

async function preflightConstructs(
  systemRoot: string,
  pluginRoot: string,
  harness: HarnessTarget,
): Promise<Record<ConstructName, ConstructUpgradePreflightResult>> {
  const spec = getHarnessRuntimeSpec(harness);
  const results = {} as Record<ConstructName, ConstructUpgradePreflightResult>;

  for (const construct of CONSTRUCT_ORDER) {
    const support = spec.update_constructs[construct];
    if (support.status === "skipped") {
      results[construct] = skippedConstruct(spec, construct, support);
      continue;
    }

    results[construct] = construct === "dispatcher"
      ? await preflightDelamainConstructUpgrade({
        system_root: systemRoot,
        plugin_root: pluginRoot,
      })
      : await preflightProcessConstructUpgrade({
        system_root: systemRoot,
        plugin_root: pluginRoot,
        definition: createProcessDefinition(construct, pluginRoot, harness),
      });
  }

  return results;
}

function skippedConstruct(
  spec: HarnessRuntimeSpec,
  construct: ConstructName,
  support: Extract<HarnessUpdateConstructSupport, { status: "skipped" }>,
): ConstructUpgradePreflightResult {
  return {
    construct,
    current_version: null,
    target_version: 0,
    needs_upgrade: false,
    prompts: [],
    validation: null,
    telemetry: [
      {
        type: "preflight_skipped",
        timestamp: new Date().toISOString(),
        construct,
        message: `${construct} construct lifecycle is not managed for the ${spec.display_name} harness.`,
        data: {
          harness: spec.target,
          required_for_feature_parity: support.required_for_feature_parity,
          reason: support.reason,
        },
      },
    ],
  };
}

function createProcessDefinition(
  construct: ProcessConstructName,
  pluginRoot: string,
  harness: HarnessTarget,
) {
  return construct === "statusline"
    ? createStatuslineProcessDefinition(pluginRoot, harness)
    : createDashboardProcessDefinition(pluginRoot, harness);
}

function updateTransactionManualFollowUpNote(
  harness: HarnessTarget,
  constructs: Record<ConstructName, ConstructUpgradePreflightResult>,
): string | null {
  const spec = getHarnessRuntimeSpec(harness);
  const skippedRequiredConstructs = CONSTRUCT_ORDER.filter((construct) => {
    const support = spec.update_constructs[construct];
    return support.status === "skipped" && support.required_for_feature_parity;
  });
  if (skippedRequiredConstructs.length > 0) {
    return `${spec.display_name} update follow-through skipped required ALS construct lifecycle actions: ${skippedRequiredConstructs.join(", ")}.`;
  }

  return spec.update_constructs.statusline.status === "managed" && constructs.statusline.needs_upgrade
    ? "If statusline data goes stale, run `/bootup` or `/reboot`."
    : null;
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
  prepared: PreparedUpdateTransaction,
  constructResults: ConstructUpgradeExecuteResult[],
): string {
  const lines: string[] = [];
  if (prepared.language && prepared.language.plan.hops.length > 0) {
    lines.push(
      `Language hops: ${prepared.language.plan.hops.map((hop) => hop.hop_id).join(", ")}`,
    );
  }

  const constructDeltas = constructResults
    .filter((result) => result.needs_upgrade)
    .map((result) => `${result.construct} ${result.current_version ?? 0} -> ${result.target_version}`);
  if (constructDeltas.length > 0) {
    lines.push(`Construct deltas: ${constructDeltas.join("; ")}`);
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

function readTrackedDirtyPaths(repoRoot: string, harness: HarnessTarget): string[] {
  const output = runGit(repoRoot, [
    "status",
    "--porcelain",
    "--untracked-files=no",
    "--",
    ...trackedRootsForHarness(harness),
  ]).stdout;
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3));
}

function shouldCheckpointTransientRuntimePaths(dirtyPaths: string[]): boolean {
  return dirtyPaths.length > 0
    && dirtyPaths.every((path) => isTransientRuntimePath(path));
}

function trackedRootsForHarness(harness: HarnessTarget): string[] {
  const spec = getHarnessRuntimeSpec(harness);
  return [...spec.transaction_roots];
}

function formatRootList(roots: string[]): string {
  if (roots.length === 1) {
    return roots[0]!;
  }
  if (roots.length === 2) {
    return `${roots[0]} or ${roots[1]}`;
  }
  return `${roots.slice(0, -1).join(", ")}, or ${roots[roots.length - 1]}`;
}

function hasCachedChanges(repoRoot: string): boolean {
  const result = runGitAllowFailure(repoRoot, ["diff", "--cached", "--quiet"]);
  return result.status === 1;
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
    deploy_harness_projection: services?.deploy_harness_projection ?? deployHarnessProjection,
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
  manualFollowUpNote: string | null,
): UpdateTransactionFailedResult {
  return {
    status: "failed",
    failure_surface: surface,
    diagnostic,
    staging_worktree_path: stagingWorktreePath,
    commit_oid: commitOid,
    lifecycle_failure_state: null,
    precise_lifecycle_failure_state: null,
    manual_follow_up_note: manualFollowUpNote,
  };
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
