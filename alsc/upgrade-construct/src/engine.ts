import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type {
  ConstructActionManifest,
  ConstructActionProcessLocator,
  ConstructActionStartContract,
  ConstructManifest,
} from "../../compiler/src/construct-upgrade.ts";
import { inspectConstructManifest } from "../../compiler/src/construct-upgrade.ts";
import { locateProcessPid } from "./action-runner.ts";
import { detectKnownConstructFingerprint } from "./customization.ts";
import { DISPATCHER_KNOWN_VENDOR_FINGERPRINTS } from "./known-fingerprints.ts";
import {
  buildDispatcherLifecyclePrompt,
  emitDispatcherLifecycleAction,
  emitProcessLifecycleAction,
  type DispatcherLifecycleChoice,
} from "./lifecycle-strategies/index.ts";
import {
  discoverSequentialMigrationSteps,
  executeSequentialMigrationChain,
  planSequentialMigrationChain,
} from "./migration-strategies/sequential.ts";
import { assertWithinRoot } from "./paths.ts";
import {
  readConstructUpgradeRuntimeState,
  recordAppliedConstructVersion,
} from "./runtime-state.ts";
import { createConstructUpgradeTelemetryEvent } from "./telemetry.ts";
import type {
  ConstructBundleDefinition,
  ConstructUpgradeExecuteResult,
  ConstructUpgradePreflightResult,
  DelamainDispatcherInstance,
  ProcessConstructDefinition,
} from "./types.ts";

export async function preflightDelamainConstructUpgrade(input: {
  system_root: string;
  plugin_root: string;
}): Promise<ConstructUpgradePreflightResult> {
  const bundle = loadConstructBundle(join(input.plugin_root, "skills", "new", "references", "dispatcher"));
  const instances = await discoverDelamainDispatcherInstances(input.system_root);
  if (instances.length === 0) {
    return {
      construct: "dispatcher",
      current_version: null,
      target_version: bundle.manifest.version,
      needs_upgrade: false,
      prompts: [],
      validation: null,
      telemetry: [
        createConstructUpgradeTelemetryEvent("dispatcher", "preflight_skipped", "No delamain dispatcher instances were discovered."),
      ],
    };
  }

  const versionSet = new Set(await Promise.all(instances.map((instance) => readVersionNumber(join(instance.dispatcher_root, "VERSION")))));
  if (versionSet.size !== 1) {
    throw new Error("Dispatcher fleet must be on one version before construct-upgrade can proceed.");
  }

  const currentVersion = [...versionSet][0]!;
  if (currentVersion === bundle.manifest.version) {
    return {
      construct: "dispatcher",
      current_version: currentVersion,
      target_version: bundle.manifest.version,
      needs_upgrade: false,
      prompts: [],
      validation: null,
      telemetry: [
        createConstructUpgradeTelemetryEvent("dispatcher", "preflight_clean", "Dispatcher fleet already matches the canonical version.", {
          current_version: currentVersion,
        }),
      ],
    };
  }

  const prompts = [];
  for (const instance of instances.sort((left, right) => left.instance_id.localeCompare(right.instance_id))) {
    prompts.push(buildDispatcherLifecyclePrompt({
      instance_id: instance.instance_id,
      display_name: instance.display_name,
    }));

    const fingerprint = await detectKnownConstructFingerprint(
      instance.dispatcher_root,
      DISPATCHER_KNOWN_VENDOR_FINGERPRINTS,
    );
    if (fingerprint.customized) {
      prompts.push({
        key: `dispatcher-overwrite:${instance.instance_id}`,
        construct: "dispatcher",
        instance_id: instance.instance_id,
        display_name: instance.display_name,
        intent: "confirm-construct-overwrite",
        markdown: [
          `Dispatcher \`${instance.display_name}\` includes hand-customized vendor files.`,
          "",
          `Continuing will overwrite the local dispatcher bundle and save a backup at \`${instance.dispatcher_root}.customized-backup\`.`,
        ].join("\n"),
        options: [
          {
            value: "approve",
            label: "Approve",
            description: "Overwrite the customized dispatcher and stage a backup copy.",
          },
          {
            value: "abort",
            label: "Abort",
            description: "Abort the whole construct-upgrade transaction.",
          },
        ],
      });
    }
  }

  return {
    construct: "dispatcher",
    current_version: currentVersion,
    target_version: bundle.manifest.version,
    needs_upgrade: true,
    prompts,
    validation: {
      requires_claude_deploy: true,
      touched_paths: instances.map((instance) => instance.relative_dispatcher_root),
    },
    telemetry: [
      createConstructUpgradeTelemetryEvent("dispatcher", "preflight_ready", "Dispatcher fleet requires an upgrade.", {
        current_version: currentVersion,
        target_version: bundle.manifest.version,
        instance_count: instances.length,
      }),
    ],
  };
}

export async function executeDelamainConstructUpgrade(input: {
  live_system_root: string;
  staging_system_root: string;
  plugin_root: string;
  operator_answers: Record<string, string>;
}): Promise<ConstructUpgradeExecuteResult> {
  const preflight = await preflightDelamainConstructUpgrade({
    system_root: input.live_system_root,
    plugin_root: input.plugin_root,
  });
  if (!preflight.needs_upgrade) {
    return {
      construct: "dispatcher",
      current_version: preflight.current_version,
      target_version: preflight.target_version,
      needs_upgrade: false,
      staged_paths: [],
      action_manifest: null,
      validation: preflight.validation,
      telemetry: [
        createConstructUpgradeTelemetryEvent("dispatcher", "execute_skipped", "Dispatcher fleet already matches the canonical version."),
      ],
    };
  }

  const bundle = loadConstructBundle(join(input.plugin_root, "skills", "new", "references", "dispatcher"));
  const instances = await discoverDelamainDispatcherInstances(input.live_system_root);
  const currentVersion = preflight.current_version!;
  const migrationSteps = await discoverSequentialMigrationSteps(join(bundle.root, bundle.manifest.migrations_dir));
  const migrationChain = planSequentialMigrationChain(
    migrationSteps,
    currentVersion,
    bundle.manifest.version,
  );

  const stagedPaths: string[] = [];
  const actions = [];
  for (const instance of instances.sort((left, right) => left.instance_id.localeCompare(right.instance_id))) {
    const lifecycleChoice = readRequiredAnswer(
      input.operator_answers,
      `dispatcher-lifecycle:${instance.instance_id}`,
    ) as DispatcherLifecycleChoice;
    if (lifecycleChoice === "cancel") {
      throw new Error(`Dispatcher '${instance.instance_id}' cancelled the construct-upgrade transaction.`);
    }

    const overwriteAnswer = input.operator_answers[`dispatcher-overwrite:${instance.instance_id}`];
    const fingerprint = await detectKnownConstructFingerprint(
      instance.dispatcher_root,
      DISPATCHER_KNOWN_VENDOR_FINGERPRINTS,
    );
    if (fingerprint.customized && overwriteAnswer !== "approve") {
      throw new Error(`Dispatcher '${instance.instance_id}' requires explicit overwrite approval.`);
    }

    const stagedDispatcherRoot = resolve(
      input.staging_system_root,
      instance.relative_dispatcher_root,
    );
    assertWithinRoot(input.staging_system_root, stagedDispatcherRoot);
    if (fingerprint.customized) {
      const backupPath = `${stagedDispatcherRoot}.customized-backup`;
      assertWithinRoot(input.staging_system_root, backupPath);
      await rm(backupPath, { recursive: true, force: true });
      await cp(stagedDispatcherRoot, backupPath, { recursive: true });
      stagedPaths.push(relative(input.staging_system_root, backupPath));
    }

    await executeSequentialMigrationChain(migrationChain, (step) => ({
      system_root: input.staging_system_root,
      target_root: stagedDispatcherRoot,
      construct_name: "dispatcher",
      instance_id: instance.instance_id,
      from_version: step.from_version,
      to_version: step.to_version,
    }));

    await copyVendorPaths(bundle, stagedDispatcherRoot);
    stagedPaths.push(instance.relative_dispatcher_root);

    const action = emitDispatcherLifecycleAction({
      instance_id: instance.instance_id,
      display_name: instance.display_name,
      choice: lifecycleChoice,
      start: buildDispatcherStartContract(instance.instance_id),
      process_locator: buildDispatcherProcessLocator(instance.instance_id),
      drain_signal: buildDispatcherDrainSignal(instance.instance_id),
    });
    if (action) {
      actions.push(action);
    }
  }

  return {
    construct: "dispatcher",
    current_version: currentVersion,
    target_version: bundle.manifest.version,
    needs_upgrade: true,
    staged_paths: stagedPaths,
    action_manifest: {
      schema: "als-construct-action-manifest@1",
      actions,
    },
    validation: {
      requires_claude_deploy: true,
      touched_paths: stagedPaths,
    },
    telemetry: [
      createConstructUpgradeTelemetryEvent("dispatcher", "execute_staged", "Dispatcher upgrade staged into the shared worktree.", {
        instance_count: instances.length,
        action_count: actions.length,
      }),
    ],
  };
}

export async function preflightProcessConstructUpgrade(input: {
  system_root: string;
  plugin_root: string;
  definition: ProcessConstructDefinition;
}): Promise<ConstructUpgradePreflightResult> {
  const state = await readConstructUpgradeRuntimeState(input.system_root);
  const bundle = loadConstructBundle(input.definition.bundle_root);
  const currentVersion = state.constructs[input.definition.construct]?.applied_version ?? 0;

  if (currentVersion === bundle.manifest.version) {
    return {
      construct: input.definition.construct,
      current_version: currentVersion,
      target_version: bundle.manifest.version,
      needs_upgrade: false,
      prompts: [],
      validation: null,
      telemetry: [
        createConstructUpgradeTelemetryEvent(input.definition.construct, "preflight_clean", "Process construct already matches the recorded applied version."),
      ],
    };
  }

  return {
    construct: input.definition.construct,
    current_version: currentVersion,
    target_version: bundle.manifest.version,
    needs_upgrade: true,
    prompts: [],
    validation: {
      requires_claude_deploy: false,
      touched_paths: [".als/runtime/construct-upgrades/state.json"],
    },
    telemetry: [
      createConstructUpgradeTelemetryEvent(input.definition.construct, "preflight_ready", "Process construct requires a version-state refresh.", {
        current_version: currentVersion,
        target_version: bundle.manifest.version,
      }),
    ],
  };
}

export async function executeProcessConstructUpgrade(input: {
  live_system_root: string;
  staging_system_root: string;
  plugin_root: string;
  definition: ProcessConstructDefinition;
}): Promise<ConstructUpgradeExecuteResult> {
  const preflight = await preflightProcessConstructUpgrade({
    system_root: input.live_system_root,
    plugin_root: input.plugin_root,
    definition: input.definition,
  });
  if (!preflight.needs_upgrade) {
    return {
      construct: input.definition.construct,
      current_version: preflight.current_version,
      target_version: preflight.target_version,
      needs_upgrade: false,
      staged_paths: [],
      action_manifest: null,
      validation: preflight.validation,
      telemetry: [
        createConstructUpgradeTelemetryEvent(input.definition.construct, "execute_skipped", "No process construct upgrade was needed."),
      ],
    };
  }

  await recordAppliedConstructVersion(
    input.staging_system_root,
    input.definition.construct,
    preflight.target_version,
  );
  const isRunning = await locateProcessPid(
    input.definition.process_locator,
    {
      system_root: input.live_system_root,
      plugin_root: input.plugin_root,
    },
  ) !== null;

  const action = emitProcessLifecycleAction({
    construct: input.definition.construct,
    instance_id: input.definition.construct,
    display_name: input.definition.construct === "statusline" ? "Statusline Pulse" : "Delamain Dashboard",
    is_running: isRunning,
    start: input.definition.start,
    process_locator: input.definition.process_locator,
  });

  return {
    construct: input.definition.construct,
    current_version: preflight.current_version,
    target_version: preflight.target_version,
    needs_upgrade: true,
    staged_paths: [".als/runtime/construct-upgrades/state.json"],
    action_manifest: {
      schema: "als-construct-action-manifest@1",
      actions: [action],
    },
    validation: {
      requires_claude_deploy: false,
      touched_paths: [".als/runtime/construct-upgrades/state.json"],
    },
    telemetry: [
      createConstructUpgradeTelemetryEvent(input.definition.construct, "execute_staged", "Process construct upgrade staged runtime state and lifecycle action.", {
        is_running: isRunning,
        action_kind: action.kind,
      }),
    ],
  };
}

export function createStatuslineProcessDefinition(pluginRoot: string): ProcessConstructDefinition {
  return {
    construct: "statusline",
    bundle_root: join(pluginRoot, "statusline"),
    start: {
      command: ["bun", "run", "$CLAUDE_PLUGIN_ROOT/statusline/pulse.ts", "$ALS_SYSTEM_ROOT"],
      cwd: "$ALS_SYSTEM_ROOT",
    },
    process_locator: {
      kind: "json-file-pid",
      path: "$ALS_SYSTEM_ROOT/.claude/scripts/.cache/pulse/meta.json",
      pid_field: "pid",
    },
  };
}

export function createDashboardProcessDefinition(pluginRoot: string): ProcessConstructDefinition {
  return {
    construct: "dashboard",
    bundle_root: join(pluginRoot, "delamain-dashboard"),
    start: {
      command: [
        "bun",
        "run",
        "$CLAUDE_PLUGIN_ROOT/delamain-dashboard/src/index.ts",
        "service",
        "--system-root",
        "$ALS_SYSTEM_ROOT",
      ],
      cwd: "$CLAUDE_PLUGIN_ROOT/delamain-dashboard",
    },
    process_locator: {
      kind: "argv-substring",
      argv_contains: [
        "delamain-dashboard/src/index.ts",
        "service",
      ],
    },
  };
}

export async function discoverDelamainDispatcherInstances(
  systemRoot: string,
): Promise<DelamainDispatcherInstance[]> {
  const modulesRoot = join(resolve(systemRoot), ".als", "modules");
  const instances: DelamainDispatcherInstance[] = [];
  for (const moduleEntry of await safeDirectoryEntries(modulesRoot)) {
    const moduleRoot = join(modulesRoot, moduleEntry);
    for (const versionEntry of await safeDirectoryEntries(moduleRoot)) {
      const delamainsRoot = join(moduleRoot, versionEntry, "delamains");
      for (const delamainEntry of await safeDirectoryEntries(delamainsRoot)) {
        const dispatcherRoot = join(delamainsRoot, delamainEntry, "dispatcher");
        try {
          await readFile(join(dispatcherRoot, "VERSION"), "utf-8");
          instances.push({
            instance_id: delamainEntry,
            display_name: delamainEntry,
            dispatcher_root: dispatcherRoot,
            relative_dispatcher_root: relative(resolve(systemRoot), dispatcherRoot),
          });
        } catch {
          // Ignore partial or missing dispatcher bundles.
        }
      }
    }
  }
  return instances;
}

function buildDispatcherStartContract(instanceId: string): ConstructActionStartContract {
  return {
    command: ["bun", "run", `$ALS_SYSTEM_ROOT/.claude/delamains/${instanceId}/dispatcher/src/index.ts`],
    cwd: "$ALS_SYSTEM_ROOT",
  };
}

function buildDispatcherProcessLocator(instanceId: string): ConstructActionProcessLocator {
  return {
    kind: "json-file-pid",
    path: `$ALS_SYSTEM_ROOT/.claude/delamains/${instanceId}/status.json`,
    pid_field: "pid",
  };
}

function buildDispatcherDrainSignal(instanceId: string) {
  return {
    kind: "json-file-write" as const,
    path: `$ALS_SYSTEM_ROOT/.claude/delamains/${instanceId}/dispatcher/control/drain-request.json`,
    payload: {
      requested_at: new Date().toISOString(),
      reason: "construct-upgrade",
    },
  };
}

function loadConstructBundle(bundleRoot: string): ConstructBundleDefinition {
  const inspection = inspectConstructManifest(bundleRoot);
  if (inspection.status !== "pass" || !inspection.manifest) {
    const details = inspection.errors.map((entry) => `${entry.path}: ${entry.message}`).join("; ");
    throw new Error(`Invalid construct bundle at ${bundleRoot}: ${details}`);
  }
  return {
    root: resolve(bundleRoot),
    manifest: inspection.manifest,
  };
}

async function copyVendorPaths(
  bundle: ConstructBundleDefinition,
  stagedDispatcherRoot: string,
): Promise<void> {
  for (const sourcePath of bundle.manifest.source_paths) {
    if (sourcePath.owner !== "vendor") {
      continue;
    }

    const source = join(bundle.root, sourcePath.path);
    const target = join(stagedDispatcherRoot, sourcePath.path);
    await mkdir(dirname(target), { recursive: true });
    await rm(target, { recursive: true, force: true });
    await cp(source, target, { recursive: true });
  }
}

async function safeDirectoryEntries(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function readVersionNumber(path: string): Promise<number> {
  const raw = await readFile(path, "utf-8");
  return Number(raw.trim());
}

function readRequiredAnswer(
  answers: Record<string, string>,
  key: string,
): string {
  const value = answers[key];
  if (!value) {
    throw new Error(`Missing required operator answer '${key}'.`);
  }
  return value;
}
