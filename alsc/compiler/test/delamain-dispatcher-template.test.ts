import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deployClaudeSkillsFromConfig } from "../src/claude-skills.ts";
import {
  serializeActiveOperatorSelection,
  serializeOperatorConfigSource,
  serializeOperatorRosterSource,
} from "../src/operator-config.ts";
import { loadSystemValidationContext } from "../src/validate.ts";
import { resolveDispatchActiveOperator } from "../../../delamain-dispatcher/src/active-operator.ts";
import {
  formatDispatcherVersionLine,
  loadDispatcherVersionInfo,
  parseDispatcherVersion,
} from "../../../delamain-dispatcher/src/dispatcher-version.ts";
import { resolve as resolveDispatcherConfig } from "../../../delamain-dispatcher/src/dispatcher.ts";
import { resolveDispatchLimits } from "../../../delamain-dispatcher/src/dispatch-limits.ts";
import { runGit } from "../../../delamain-dispatcher/src/git.ts";
import { loadRuntimeManifest } from "../../../delamain-dispatcher/src/runtime-manifest.ts";
import { scan } from "../../../delamain-dispatcher/src/watcher.ts";
import {
  updateRecord,
  updateShapeYaml,
  updateTextFile,
  withFixtureSandbox,
  withFixtureSandboxFromSource,
  writePath,
} from "./helpers/fixture.ts";

const v5FixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../language-upgrades/fixtures/v5");
const factoryItemIds = ["SWF-001", "SWF-002", "SWF-003", "SWF-004"] as const;

async function writeValidOperatorSurface(root: string, activeOperatorId: string | null): Promise<void> {
  await writePath(
    root,
    ".als/operator-roster.ts",
    serializeOperatorRosterSource({
      operator_paths: ["./operators/nick-frith.ts"],
    }),
  );
  await writePath(
    root,
    ".als/operators/nick-frith.ts",
    serializeOperatorConfigSource({
      id: "nick-frith",
      first_name: "Nick",
      last_name: "Frith",
      display_name: "0xnfrith",
      primary_email: "nick@example.com",
      role: "Founder",
      profiles: ["edgerunner"],
      owns_company: false,
      company_name: null,
      company_type: null,
      company_type_other: null,
      revenue_band: null,
    }),
  );
  if (activeOperatorId) {
    await writePath(
      root,
      ".als/local/active-operator.json",
      serializeActiveOperatorSelection({
        schema: "als-active-operator-selection@1",
        operator_id: activeOperatorId,
      }),
    );
  }
}

async function configureFactoryOperatorAssignment(
  root: string,
  mode: "opportunistic" | "strict" = "opportunistic",
): Promise<void> {
  await updateShapeYaml(root, "factory", 1, (shape) => {
    const entities = shape.entities as Record<string, Record<string, unknown>>;
    const itemFields = entities["work-item"].fields as Record<string, Record<string, unknown>>;
    itemFields.assigned_operator = {
      type: "operator-ref",
      allow_null: mode === "strict" ? false : true,
    };
  });
  await updateTextFile(
    root,
    ".als/modules/factory/v1/delamains/development-pipeline/delamain.ts",
    (current) => current.replace(
      '  "transitions": [',
      `  "requires_active_operator": {\n    "field": "assigned_operator",\n    "mode": "${mode}"\n  },\n  "transitions": [`,
    ),
  );
}

async function seedFactoryAssignedOperators(root: string, operatorId: string | null): Promise<void> {
  for (const itemId of factoryItemIds) {
    await updateRecord(root, `workspace/factory/items/${itemId}.md`, (record) => {
      record.data.assigned_operator = operatorId;
    });
  }
}

test("dispatcher version parser accepts positive integers", () => {
  expect(parseDispatcherVersion("1\n", "local")).toBe(1);
  expect(parseDispatcherVersion("42", "canonical")).toBe(42);
});

test("dispatch limits resolve authored overrides and canonical defaults", () => {
  expect(resolveDispatchLimits()).toEqual({
    maxTurns: 50,
    maxBudgetUsdByProvider: {
      anthropic: 20,
      openai: 50,
    },
  });
  expect(resolveDispatchLimits({ maxTurns: 100, maxBudgetUsd: 20 })).toEqual({
    maxTurns: 100,
    maxBudgetUsdByProvider: {
      anthropic: 20,
      openai: 20,
    },
  });
  expect(resolveDispatchLimits({
    maxBudgetUsd: 20,
    maxBudgetUsdByProvider: {
      openai: 50,
    },
  })).toEqual({
    maxTurns: 50,
    maxBudgetUsdByProvider: {
      anthropic: 20,
      openai: 50,
    },
  });
});

test("canonical dispatcher template strips ANTHROPIC_API_KEY before SDK imports", async () => {
  const indexText = await Bun.file(
    new URL("../../../delamain-dispatcher/src/index.ts", import.meta.url),
  ).text();
  const preflightText = await Bun.file(
    new URL("../../../delamain-dispatcher/src/preflight.ts", import.meta.url),
  ).text();

  expect(indexText.split("\n")[0]).toBe('import "./preflight.js";');
  expect(preflightText).toContain("delete process.env.ANTHROPIC_API_KEY;");
});

test("run-demo dispatcher strips ANTHROPIC_API_KEY before SDK imports", async () => {
  const indexText = await Bun.file(
    new URL("../../../skills/run-demo/dispatcher/src/index.ts", import.meta.url),
  ).text();
  const preflightText = await Bun.file(
    new URL("../../../skills/run-demo/dispatcher/src/preflight.ts", import.meta.url),
  ).text();

  expect(indexText.split("\n")[0]).toBe('import "./preflight.js";');
  expect(preflightText).toContain("delete process.env.ANTHROPIC_API_KEY;");
});

test("canonical dispatcher template ships worktree runtime modules", async () => {
  const runtimeText = await Bun.file(
    new URL("../../../delamain-dispatcher/src/dispatcher-runtime.ts", import.meta.url),
  ).text();
  const isolationText = await Bun.file(
    new URL("../../../delamain-dispatcher/src/git-worktree-isolation.ts", import.meta.url),
  ).text();
  const registryText = await Bun.file(
    new URL("../../../delamain-dispatcher/src/dispatch-registry.ts", import.meta.url),
  ).text();

  expect(runtimeText).toContain("class DispatcherRuntime");
  expect(isolationText).toContain("class GitWorktreeIsolationStrategy");
  expect(registryText).toContain("class DispatchRegistry");
});

test("dispatcher version parser rejects malformed values", () => {
  expect(() => parseDispatcherVersion("0\n", "local")).toThrow(
    "local dispatcher VERSION must be a positive integer",
  );
  expect(() => parseDispatcherVersion("1.0.0\n", "canonical")).toThrow(
    "canonical dispatcher VERSION must be a positive integer",
  );
});

test("dispatcher version check reads local and canonical VERSION files", async () => {
  await withVersionSandbox("current", async ({ root }) => {
    const bundleRoot = join(root, ".claude/delamains/version-check");
    const pluginRoot = join(root, "plugin");

    await writeVersionPath(root, ".claude/delamains/version-check/dispatcher/VERSION", "1\n");
    await writeVersionPath(root, "plugin/delamain-dispatcher/VERSION", "1\n");

    const info = await loadDispatcherVersionInfo(bundleRoot, {
      CLAUDE_PLUGIN_ROOT: pluginRoot,
    });

    expect(info.localVersion).toBe(1);
    expect(info.latestVersion).toBe(1);
    expect(formatDispatcherVersionLine(info)).toBe("[dispatcher] version: 1 (latest: 1)");
  });
});

test("dispatcher version check rejects missing local VERSION", async () => {
  await withVersionSandbox("missing-local", async ({ root }) => {
    const bundleRoot = join(root, ".claude/delamains/version-check");
    const pluginRoot = join(root, "plugin");

    await writeVersionPath(root, "plugin/delamain-dispatcher/VERSION", "1\n");

    await expect(loadDispatcherVersionInfo(bundleRoot, {
      CLAUDE_PLUGIN_ROOT: pluginRoot,
    })).rejects.toThrow("local dispatcher VERSION missing or unreadable");
  });
});

test("dispatcher version check rejects malformed local VERSION", async () => {
  await withVersionSandbox("malformed-local", async ({ root }) => {
    const bundleRoot = join(root, ".claude/delamains/version-check");
    const pluginRoot = join(root, "plugin");

    await writeVersionPath(root, ".claude/delamains/version-check/dispatcher/VERSION", "latest\n");
    await writeVersionPath(root, "plugin/delamain-dispatcher/VERSION", "1\n");

    await expect(loadDispatcherVersionInfo(bundleRoot, {
      CLAUDE_PLUGIN_ROOT: pluginRoot,
    })).rejects.toThrow("local dispatcher VERSION must be a positive integer");
  });
});

test("dispatcher version check rejects missing CLAUDE_PLUGIN_ROOT", async () => {
  await withVersionSandbox("missing-plugin-root", async ({ root }) => {
    const bundleRoot = join(root, ".claude/delamains/version-check");

    await writeVersionPath(root, ".claude/delamains/version-check/dispatcher/VERSION", "1\n");

    await expect(loadDispatcherVersionInfo(bundleRoot, {})).rejects.toThrow(
      "CLAUDE_PLUGIN_ROOT is not set; cannot read canonical dispatcher VERSION",
    );
  });
});

test("dispatcher version check rejects missing canonical VERSION", async () => {
  await withVersionSandbox("missing-canonical", async ({ root }) => {
    const bundleRoot = join(root, ".claude/delamains/version-check");
    const pluginRoot = join(root, "plugin");

    await writeVersionPath(root, ".claude/delamains/version-check/dispatcher/VERSION", "1\n");

    await expect(loadDispatcherVersionInfo(bundleRoot, {
      CLAUDE_PLUGIN_ROOT: pluginRoot,
    })).rejects.toThrow("canonical dispatcher VERSION missing or unreadable");
  });
});

test("dispatcher version check rejects malformed canonical VERSION", async () => {
  await withVersionSandbox("malformed-canonical", async ({ root }) => {
    const bundleRoot = join(root, ".claude/delamains/version-check");
    const pluginRoot = join(root, "plugin");

    await writeVersionPath(root, ".claude/delamains/version-check/dispatcher/VERSION", "1\n");
    await writeVersionPath(root, "plugin/delamain-dispatcher/VERSION", "v2\n");

    await expect(loadDispatcherVersionInfo(bundleRoot, {
      CLAUDE_PLUGIN_ROOT: pluginRoot,
    })).rejects.toThrow("canonical dispatcher VERSION must be a positive integer");
  });
});

test("dispatcher version check logs stale upgrade instruction without failing", async () => {
  await withVersionSandbox("stale", async ({ root }) => {
    const bundleRoot = join(root, ".claude/delamains/version-check");
    const pluginRoot = join(root, "plugin");

    await writeVersionPath(root, ".claude/delamains/version-check/dispatcher/VERSION", "1\n");
    await writeVersionPath(root, "plugin/delamain-dispatcher/VERSION", "2\n");

    const info = await loadDispatcherVersionInfo(bundleRoot, {
      CLAUDE_PLUGIN_ROOT: pluginRoot,
    });

    expect(formatDispatcherVersionLine(info)).toBe(
      "[dispatcher] version: 1 (latest: 2 — run /update to update)",
    );
  });
});

test("dispatcher version check ignores dispatcher package.json version", async () => {
  await withVersionSandbox("ignores-package-json", async ({ root }) => {
    const bundleRoot = join(root, ".claude/delamains/version-check");
    const pluginRoot = join(root, "plugin");

    await writeVersionPath(root, ".claude/delamains/version-check/dispatcher/VERSION", "1\n");
    await writeVersionPath(
      root,
      ".claude/delamains/version-check/dispatcher/package.json",
      JSON.stringify({ name: "delamain-dispatcher", version: "999.0.0" }) + "\n",
    );
    await writeVersionPath(root, "plugin/delamain-dispatcher/VERSION", "1\n");

    const info = await loadDispatcherVersionInfo(bundleRoot, {
      CLAUDE_PLUGIN_ROOT: pluginRoot,
    });

    expect(info.localVersion).toBe(1);
    expect(info.latestVersion).toBe(1);
  });
});

async function withVersionSandbox(
  label: string,
  run: (sandbox: { root: string }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `als-dispatcher-version-${label}-`));
  try {
    await run({ root });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeVersionPath(root: string, relativePath: string, contents: string): Promise<void> {
  const filePath = join(root, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

test("dispatcher resolve fails closed when runtime manifest is missing", async () => {
  await withFixtureSandbox("delamain-dispatcher-manifest-missing", async ({ root }) => {
    const bundleRoot = join(root, ".als/modules/factory/v1/delamains/development-pipeline");

    await expect(loadRuntimeManifest(bundleRoot)).rejects.toThrow(
      "Missing runtime-manifest.json",
    );
  });
});

test("dispatcher resolve rejects unsupported per-provider deployed runtime manifest limits", async () => {
  const root = await mkdtemp(join(tmpdir(), "als-dispatcher-manifest-invalid-provider-"));
  try {
    const bundleRoot = join(root, ".claude/delamains/development-pipeline");
    await mkdir(bundleRoot, { recursive: true });
    await writeFile(
      join(bundleRoot, "runtime-manifest.json"),
      JSON.stringify(
        {
          schema: "als-delamain-runtime-manifest@1",
          delamain_name: "development-pipeline",
          module_id: "factory",
          module_version: 1,
          module_mount_path: "workspace/factory",
          entity_name: "work-item",
          entity_path: "items/{id}.md",
          status_field: "status",
          discriminator_field: null,
          discriminator_value: null,
          submodules: [],
          state_providers: {
            dev: "openai",
          },
          limits: {
            maxBudgetUsdByProvider: {
              other: 1,
            },
          },
        },
        null,
        2,
      ) + "\n",
    );

    await expect(loadRuntimeManifest(bundleRoot)).rejects.toThrow(
      "limits.maxBudgetUsdByProvider.other",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dispatcher resolve uses deployed runtime manifest metadata", async () => {
  await withFixtureSandbox("delamain-dispatcher-resolve", async ({ root }) => {
    const validationContext = loadSystemValidationContext(root);
    expect(validationContext.system_config).not.toBeNull();

    const output = deployClaudeSkillsFromConfig(root, validationContext.system_config!, "pass", {
      module_filter: "factory",
    });
    expect(output.status).toBe("pass");

    const bundleRoot = join(root, ".claude/delamains/development-pipeline");
    const manifest = await loadRuntimeManifest(bundleRoot);

    expect(manifest.delamain_name).toBe("development-pipeline");
    expect(manifest.module_id).toBe("factory");
    expect(manifest.entity_name).toBe("work-item");
    expect(manifest.entity_path).toBe("items/{id}.md");
    expect(manifest.status_field).toBe("status");
    expect(manifest.module_mount_path).toBe("workspace/factory");
    expect(manifest.submodules).toEqual([]);
    expect(manifest.limits).toBeUndefined();
    expect(resolveDispatchLimits(manifest.limits)).toEqual({
      maxTurns: 50,
      maxBudgetUsdByProvider: {
        anthropic: 20,
        openai: 50,
      },
    });
    expect(await readFile(join(bundleRoot, "delamain.yaml"), "utf-8")).not.toContain("concurrency:");

    const delamainSourcePath = join(
      root,
      ".als/modules/factory/v1/delamains/development-pipeline/delamain.ts",
    );
    const authoredDelamain = await readFile(delamainSourcePath, "utf-8");
    await writeFile(
      delamainSourcePath,
      authoredDelamain.replace(
        '"path": "agents/planning.md"',
        '"path": "agents/planning.md",\n        "concurrency": 1',
      ),
      "utf-8",
    );

    const updatedContext = loadSystemValidationContext(root);
    expect(updatedContext.system_config).not.toBeNull();
    const updatedOutput = deployClaudeSkillsFromConfig(root, updatedContext.system_config!, "pass", {
      module_filter: "factory",
    });
    expect(updatedOutput.status).toBe("pass");
    expect(await readFile(join(bundleRoot, "delamain.yaml"), "utf-8")).toContain("concurrency: 1");
  });
});

test("dispatcher deploy projects active-operator assignment into the runtime manifest", async () => {
  await withFixtureSandboxFromSource("delamain-dispatcher-active-operator-manifest", v5FixtureRoot, async ({ root }) => {
    await writeValidOperatorSurface(root, null);
    await configureFactoryOperatorAssignment(root, "opportunistic");
    await seedFactoryAssignedOperators(root, null);

    const validationContext = loadSystemValidationContext(root);
    expect(validationContext.system_config).not.toBeNull();

    const output = deployClaudeSkillsFromConfig(root, validationContext.system_config!, "pass", {
      module_filter: "factory",
    });
    expect(output.status).toBe("pass");

    const bundleRoot = join(root, ".claude/delamains/development-pipeline");
    const manifest = await loadRuntimeManifest(bundleRoot);
    expect(manifest.active_operator_assignment).toEqual({
      field: "assigned_operator",
      mode: "opportunistic",
    });

    const resolved = await resolveDispatcherConfig(bundleRoot, root);
    expect(resolved.activeOperatorAssignment).toEqual({
      field: "assigned_operator",
      mode: "opportunistic",
    });
  });
});

test("dispatcher resolve carries authored concurrency pools into runtime config", async () => {
  await withFixtureSandbox("delamain-dispatcher-concurrency-pools", async ({ root }) => {
    const delamainSourcePath = join(
      root,
      ".als/modules/factory/v1/delamains/development-pipeline/delamain.ts",
    );
    const authoredDelamain = await readFile(delamainSourcePath, "utf-8");
    await writeFile(
      delamainSourcePath,
      authoredDelamain.replace(
        '"transitions": [',
        '"concurrency_pools": {\n    "rc": {\n      "states": [\n        "in-dev",\n        "in-review"\n      ],\n      "capacity": 1\n    }\n  },\n  "transitions": [',
      ),
      "utf-8",
    );

    const validationContext = loadSystemValidationContext(root);
    expect(validationContext.system_config).not.toBeNull();

    const output = deployClaudeSkillsFromConfig(root, validationContext.system_config!, "pass", {
      module_filter: "factory",
    });
    expect(output.status).toBe("pass");

    const bundleRoot = join(root, ".claude/delamains/development-pipeline");
    const delamainYaml = await readFile(join(bundleRoot, "delamain.yaml"), "utf-8");
    expect(delamainYaml).toContain("concurrency_pools:");
    expect(delamainYaml).toContain("rc:");
    expect(delamainYaml).toContain("- in-dev");
    expect(delamainYaml).toContain("- in-review");

    const resolved = await resolveDispatcherConfig(bundleRoot, root);
    expect(resolved.concurrencyPools).toEqual({
      rc: {
        id: "rc",
        states: ["in-dev", "in-review"],
        capacity: 1,
      },
    });
    expect(resolved.dispatchTable.find((entry) => entry.state === "in-dev")?.pool).toEqual({
      id: "rc",
      states: ["in-dev", "in-review"],
      capacity: 1,
    });
  });
});

test("dispatcher deploy merges authored runtime-manifest config into the generated manifest", async () => {
  await withFixtureSandbox("delamain-dispatcher-runtime-manifest-config", async ({ root }) => {
    await writePath(
      root,
      ".als/modules/factory/v1/delamains/development-pipeline/runtime-manifest.config.json",
      JSON.stringify(
        {
          submodules: ["workspace/factory"],
          limits: {
            maxTurns: 100,
            maxBudgetUsd: 20,
            maxBudgetUsdByProvider: {
              openai: 50,
            },
          },
        },
        null,
        2,
      ) + "\n",
    );

    const validationContext = loadSystemValidationContext(root);
    expect(validationContext.system_config).not.toBeNull();

    const output = deployClaudeSkillsFromConfig(root, validationContext.system_config!, "pass", {
      module_filter: "factory",
    });
    expect(output.status).toBe("pass");

    const manifest = await loadRuntimeManifest(join(root, ".claude/delamains/development-pipeline"));
    expect(manifest.submodules).toEqual(["workspace/factory"]);
    expect(manifest.limits).toEqual({
      maxTurns: 100,
      maxBudgetUsd: 20,
      maxBudgetUsdByProvider: {
        openai: 50,
      },
    });
    expect(resolveDispatchLimits(manifest.limits)).toEqual({
      maxTurns: 100,
      maxBudgetUsdByProvider: {
        anthropic: 20,
        openai: 50,
      },
    });
  });
});

test("dispatcher deploy rejects malformed runtime-manifest limits config", async () => {
  await withFixtureSandbox("delamain-dispatcher-invalid-limits-config", async ({ root }) => {
    await writePath(
      root,
      ".als/modules/factory/v1/delamains/development-pipeline/runtime-manifest.config.json",
      JSON.stringify(
        {
          limits: {
            maxTurns: 0,
          },
        },
        null,
        2,
      ) + "\n",
    );

    const validationContext = loadSystemValidationContext(root);
    expect(validationContext.system_config).not.toBeNull();

    const output = deployClaudeSkillsFromConfig(root, validationContext.system_config!, "pass", {
      module_filter: "factory",
    });

    expect(output.status).toBe("fail");
    expect(output.error).toContain("'limits.maxTurns' must be a positive integer");
  });
});

test("dispatcher deploy rejects unsupported per-provider runtime-manifest limits config", async () => {
  await withFixtureSandbox("delamain-dispatcher-invalid-provider-limits-config", async ({ root }) => {
    await writePath(
      root,
      ".als/modules/factory/v1/delamains/development-pipeline/runtime-manifest.config.json",
      JSON.stringify(
        {
          limits: {
            maxBudgetUsdByProvider: {
              other: 5,
            },
          },
        },
        null,
        2,
      ) + "\n",
    );

    const validationContext = loadSystemValidationContext(root);
    expect(validationContext.system_config).not.toBeNull();

    const output = deployClaudeSkillsFromConfig(root, validationContext.system_config!, "pass", {
      module_filter: "factory",
    });

    expect(output.status).toBe("fail");
    expect(output.error).toContain("'limits.maxBudgetUsdByProvider.other' is not a supported field");
  });
});

test("dispatcher scan discovers nested entity paths from runtime manifest bindings", async () => {
  await withFixtureSandbox("delamain-dispatcher-nested-scan", async ({ root }) => {
    const validationContext = loadSystemValidationContext(root);
    expect(validationContext.system_config).not.toBeNull();

    const output = deployClaudeSkillsFromConfig(root, validationContext.system_config!, "pass", {
      module_filter: "experiments",
    });
    expect(output.status).toBe("pass");
    await initFixtureRepo(root);

    const bundleRoot = join(root, ".claude/delamains/run-lifecycle");
    const manifest = await loadRuntimeManifest(bundleRoot);
    const items = await scan(
      join(root, manifest.module_mount_path),
      manifest.entity_path,
      manifest.status_field,
      manifest.discriminator_field ?? undefined,
      manifest.discriminator_value ?? undefined,
    );

    const byId = new Map(items.map((item) => [item.id, item]));
    expect(items.map((item) => item.id).sort()).toEqual(["RUN-0001", "RUN-0002", "RUN-0003"]);
    expect(byId.get("RUN-0001")?.status).toBe("completed");
    expect(byId.get("RUN-0002")?.status).toBe("completed");
    expect(byId.get("RUN-0003")?.status).toBe("completed");
    expect(byId.get("RUN-0003")?.filePath).toContain(
      "workspace/experiments/programs/PRG-0001/experiments/EXP-0001/runs/RUN-0003.md",
    );
  });
});

test("dispatcher scan honors non-status field names and discriminator filtering", async () => {
  await withFixtureSandbox("delamain-dispatcher-discriminator-scan", async ({ root }) => {
    const bundleRoot = join(root, ".claude/delamains/synthetic-lifecycle");

    await writePath(
      root,
      ".claude/delamains/synthetic-lifecycle/runtime-manifest.json",
      JSON.stringify(
        {
          schema: "als-delamain-runtime-manifest@1",
          delamain_name: "synthetic-lifecycle",
          module_id: "synthetic",
          module_version: 1,
          module_mount_path: "runtime-module",
          entity_name: "item",
          entity_path: "items/{id}.md",
          status_field: "lifecycle",
          discriminator_field: "type",
          discriminator_value: "app",
          state_providers: {
            active: "anthropic",
          },
        },
        null,
        2,
      ) + "\n",
    );
    await writePath(
      root,
      ".claude/delamains/synthetic-lifecycle/delamain.yaml",
      [
        "phases: [execution, closed]",
        "",
        "states:",
        "  queued:",
        "    initial: true",
        "    phase: execution",
        "    actor: agent",
        "    resumable: false",
        "    path: agents/queued.md",
        "  completed:",
        "    phase: closed",
        "    terminal: true",
        "",
        "transitions:",
        "  - class: exit",
        "    from: queued",
        "    to: completed",
        "",
      ].join("\n"),
    );
    await writePath(
      root,
      ".claude/delamains/synthetic-lifecycle/agents/queued.md",
      [
        "---",
        "name: queued",
        "description: Synthetic queued agent",
        "---",
        "",
        "Inspect the record and move it when appropriate.",
        "",
      ].join("\n"),
    );

    await writePath(
      root,
      "runtime-module/items/APP-001.md",
      [
        "---",
        "id: APP-001",
        "type: app",
        "lifecycle: queued",
        "---",
        "",
        "# APP-001",
        "",
      ].join("\n"),
    );
    await writePath(
      root,
      "runtime-module/items/OPS-001.md",
      [
        "---",
        "id: OPS-001",
        "type: ops",
        "lifecycle: queued",
        "---",
        "",
        "# OPS-001",
        "",
      ].join("\n"),
    );
    await initFixtureRepo(root);

    const manifest = await loadRuntimeManifest(bundleRoot);
    const items = await scan(
      join(root, manifest.module_mount_path),
      manifest.entity_path,
      manifest.status_field,
      manifest.discriminator_field ?? undefined,
      manifest.discriminator_value ?? undefined,
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("APP-001");
    expect(items[0]?.status).toBe("queued");
    expect(items[0]?.filePath).toContain("runtime-module/items/APP-001.md");
  });
});

test("dispatcher resolves local active-operator selection and refuses missing selectors per delamain", async () => {
  const root = await mkdtemp(join(tmpdir(), "als-dispatcher-active-operator-"));
  try {
    const assignment = {
      field: "assigned_operator",
      mode: "strict",
    } as const;

    const refused = await resolveDispatchActiveOperator(root, "development-pipeline", assignment);
    expect(refused.status).toBe("refuse");
    if (refused.status === "refuse") {
      expect(refused.messages[0]).toBe(
        "[dispatcher] active-operator selection missing or invalid for delamain 'development-pipeline'",
      );
      expect(refused.messages[1]).toBe(
        "[dispatcher] requires_active_operator.field='assigned_operator' mode='strict'",
      );
      expect(refused.messages[2]).toContain(".als/local/active-operator.json");
    }

    await mkdir(join(root, ".als", "local"), { recursive: true });
    await writeFile(
      join(root, ".als", "local", "active-operator.json"),
      serializeActiveOperatorSelection({
        schema: "als-active-operator-selection@1",
        operator_id: "nick-frith",
      }),
      "utf-8",
    );

    const ready = await resolveDispatchActiveOperator(root, "development-pipeline", assignment);
    expect(ready).toEqual({
      status: "ready",
      filter: {
        field: "assigned_operator",
        mode: "strict",
        operatorId: "nick-frith",
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dispatcher scan applies opportunistic and strict active-operator filters", async () => {
  const root = await mkdtemp(join(tmpdir(), "als-dispatcher-active-operator-scan-"));
  try {
    await mkdir(join(root, "runtime-module", "items"), { recursive: true });
    await writeFile(
      join(root, "runtime-module", "items", "MATCH-001.md"),
      [
        "---",
        "id: MATCH-001",
        "status: queued",
        "assigned_operator: nick-frith",
        "---",
        "",
        "# MATCH-001",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(root, "runtime-module", "items", "MISMATCH-001.md"),
      [
        "---",
        "id: MISMATCH-001",
        "status: queued",
        "assigned_operator: alice-operator",
        "---",
        "",
        "# MISMATCH-001",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(root, "runtime-module", "items", "UNASSIGNED-001.md"),
      [
        "---",
        "id: UNASSIGNED-001",
        "status: queued",
        "---",
        "",
        "# UNASSIGNED-001",
        "",
      ].join("\n"),
    );
    await initFixtureRepo(root);

    const opportunisticItems = await scan(
      join(root, "runtime-module"),
      "items/{id}.md",
      "status",
      undefined,
      undefined,
      {
        field: "assigned_operator",
        mode: "opportunistic",
        operatorId: "nick-frith",
      },
    );
    expect(opportunisticItems.map((item) => item.id).sort()).toEqual(["MATCH-001", "UNASSIGNED-001"]);

    const strictItems = await scan(
      join(root, "runtime-module"),
      "items/{id}.md",
      "status",
      undefined,
      undefined,
      {
        field: "assigned_operator",
        mode: "strict",
        operatorId: "nick-frith",
      },
    );
    expect(strictItems.map((item) => item.id)).toEqual(["MATCH-001"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function initFixtureRepo(root: string): Promise<void> {
  await runGit(root, ["init"]);
  await runGit(root, ["branch", "-M", "main"]);
  await runGit(root, ["add", "."]);
  await runGit(
    root,
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@local",
      "commit",
      "--no-gpg-sign",
      "-m",
      "fixture: initial commit",
    ],
  );
}
