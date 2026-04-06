import { expect, test } from "bun:test";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deployClaudeSkillsFromConfig } from "../src/claude-skills.ts";
import { loadSystemValidationContext } from "../src/validate.ts";
import {
  removePath,
  updateShapeYaml,
  updateSystemYaml,
  withFixtureSandbox,
  writePath,
} from "./helpers/fixture.ts";

const compilerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("deploy CLI projects active skills into .claude/skills and is idempotent", async () => {
  await withFixtureSandbox("deploy-cli-idempotent", async ({ root }) => {
    await rm(join(root, ".claude/skills"), { recursive: true, force: true });
    await rm(join(root, ".claude/delamains"), { recursive: true, force: true });

    const first = Bun.spawnSync({
      cmd: ["bun", "src/deploy.ts", root],
      cwd: compilerRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(first.exitCode).toBe(0);

    const firstOutput = JSON.parse(new TextDecoder().decode(first.stdout)) as {
      schema: string;
      status: string;
      planned_skill_count: number;
      written_skill_count: number;
      planned_skills: Array<Record<string, unknown>>;
      existing_skill_targets: unknown[];
      planned_delamain_count: number;
      written_delamain_count: number;
      planned_delamains: Array<Record<string, unknown>>;
      existing_delamain_targets: unknown[];
      delamain_name_conflicts: unknown[];
    };
    expect(firstOutput.schema).toBe("als-claude-deploy-output@2");
    expect(firstOutput.status).toBe("pass");
    expect(firstOutput.planned_skill_count).toBe(20);
    expect(firstOutput.written_skill_count).toBe(20);
    expect(firstOutput.existing_skill_targets).toEqual([]);
    expect(firstOutput.planned_delamain_count).toBe(1);
    expect(firstOutput.written_delamain_count).toBe(1);
    expect(firstOutput.existing_delamain_targets).toEqual([]);
    expect(firstOutput.delamain_name_conflicts).toEqual([]);
    expect(firstOutput.planned_delamains).toHaveLength(1);
    expect(firstOutput.planned_delamains[0]?.delamain_name).toBe("development-pipeline");
    expect(firstOutput.planned_delamains[0]?.source_dir).toBe(".als/modules/factory/v1/delamains/development-pipeline");
    expect(firstOutput.planned_delamains[0]?.target_dir).toBe(".claude/delamains/development-pipeline");
    for (const plan of firstOutput.planned_skills) {
      expect(plan).not.toHaveProperty("source_dir_abs");
      expect(plan).not.toHaveProperty("target_dir_abs");
      expect(plan.source_dir).toEqual(expect.stringMatching(/^\.als\/modules\//));
      expect(plan.target_dir).toEqual(expect.stringMatching(/^\.claude\/skills\//));
    }
    for (const plan of firstOutput.planned_delamains) {
      expect(plan).not.toHaveProperty("source_dir_abs");
      expect(plan).not.toHaveProperty("target_dir_abs");
    }

    const firstSkillSnapshot = snapshotTree(join(root, ".claude/skills"));
    expect(firstSkillSnapshot["backlog-module/SKILL.md"]).toContain("name: backlog-module");
    expect(firstSkillSnapshot["people-module/SKILL.md"]).toContain("name: people-module");
    expect(firstSkillSnapshot["playbooks-module/SKILL.md"]).toContain("name: playbooks-module");
    expect(firstSkillSnapshot["factory-operate/SKILL.md"]).toContain("name: factory-operate");
    const firstDelamainSnapshot = snapshotTree(join(root, ".claude/delamains"));
    expect(firstDelamainSnapshot["development-pipeline/delamain.yaml"]).toContain("phases:");
    expect(firstDelamainSnapshot["development-pipeline/agents/planning.md"]).toContain("description:");
    expect(firstDelamainSnapshot["development-pipeline/sub-agents/developer.md"]).toContain("description:");
    expect(firstDelamainSnapshot["development-pipeline/dispatcher/src/dispatcher.ts"]).toContain("resolve(");
    // The merged fixture keeps authored projection files but intentionally drops vendored dispatcher dependencies.
    expect(Object.keys(firstDelamainSnapshot).some((path) => path.includes("node_modules"))).toBe(false);

    const second = Bun.spawnSync({
      cmd: ["bun", "src/deploy.ts", root],
      cwd: compilerRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(second.exitCode).toBe(0);

    const secondSkillSnapshot = snapshotTree(join(root, ".claude/skills"));
    const secondDelamainSnapshot = snapshotTree(join(root, ".claude/delamains"));
    expect(secondSkillSnapshot).toEqual(firstSkillSnapshot);
    expect(secondDelamainSnapshot).toEqual(firstDelamainSnapshot);
  });
});

test("deploy CLI dry-run reports planned work without creating .claude/skills", async () => {
  await withFixtureSandbox("deploy-cli-dry-run", async ({ root }) => {
    await rm(join(root, ".claude/skills"), { recursive: true, force: true });
    await rm(join(root, ".claude/delamains"), { recursive: true, force: true });

    const process = Bun.spawnSync({
      cmd: ["bun", "src/deploy.ts", "--dry-run", root],
      cwd: compilerRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(process.exitCode).toBe(0);
    const output = JSON.parse(new TextDecoder().decode(process.stdout)) as {
      schema: string;
      status: string;
      planned_skill_count: number;
      written_skill_count: number;
      planned_skills: Array<Record<string, unknown>>;
      planned_delamain_count: number;
      written_delamain_count: number;
      planned_delamains: Array<Record<string, unknown>>;
    };
    expect(output.schema).toBe("als-claude-deploy-output@2");
    expect(output.status).toBe("pass");
    expect(output.planned_skill_count).toBe(20);
    expect(output.written_skill_count).toBe(0);
    expect(output.planned_delamain_count).toBe(1);
    expect(output.written_delamain_count).toBe(0);
    expect(output.planned_delamains[0]?.delamain_name).toBe("development-pipeline");
    expect(existsSync(join(root, ".claude/skills"))).toBe(false);
    expect(existsSync(join(root, ".claude/delamains"))).toBe(false);
    for (const plan of output.planned_skills) {
      expect(plan).not.toHaveProperty("source_dir_abs");
      expect(plan).not.toHaveProperty("target_dir_abs");
    }
    for (const plan of output.planned_delamains) {
      expect(plan).not.toHaveProperty("source_dir_abs");
      expect(plan).not.toHaveProperty("target_dir_abs");
    }
  });
});

test("deploy CLI can target a single module", async () => {
  await withFixtureSandbox("deploy-cli-module-filter", async ({ root }) => {
    await rm(join(root, ".claude/skills"), { recursive: true, force: true });

    const process = Bun.spawnSync({
      cmd: ["bun", "src/deploy.ts", root, "backlog"],
      cwd: compilerRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(process.exitCode).toBe(0);
    const snapshot = snapshotTree(join(root, ".claude/skills"));
    expect(Object.keys(snapshot)).toEqual(["backlog-module/SKILL.md"]);
  });
});

test("deploy CLI fails unknown module filters before planning work", async () => {
  await withFixtureSandbox("deploy-cli-unknown-module", async ({ root }) => {
    await rm(join(root, ".claude/skills"), { recursive: true, force: true });

    const process = Bun.spawnSync({
      cmd: ["bun", "src/deploy.ts", "--dry-run", root, "ghost-module"],
      cwd: compilerRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(process.exitCode).toBe(1);
    const output = JSON.parse(new TextDecoder().decode(process.stdout)) as {
      status: string;
      validation_status: string;
      planned_skill_count: number;
      planned_delamain_count: number;
      error: string | null;
    };
    expect(output.status).toBe("fail");
    expect(output.validation_status).toBe("fail");
    expect(output.planned_skill_count).toBe(0);
    expect(output.planned_delamain_count).toBe(0);
    expect(output.error).toContain("Unknown module filter 'ghost-module'");
  });
});

test("deploy CLI fails preflight when empty targets are required", async () => {
  await withFixtureSandbox("deploy-cli-collision", async ({ root }) => {
    await mkdir(join(root, ".claude/skills/backlog-module"), { recursive: true });
    await writeFile(join(root, ".claude/skills/backlog-module/SKILL.md"), "---\nname: backlog-module\ndescription: collision\n---\n");

    const process = Bun.spawnSync({
      cmd: ["bun", "src/deploy.ts", "--dry-run", "--require-empty-targets", root, "backlog"],
      cwd: compilerRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(process.exitCode).toBe(1);
    const output = JSON.parse(new TextDecoder().decode(process.stdout)) as {
      status: string;
      existing_skill_targets: Array<{ skill_id: string; target_dir: string; target_kind: string }>;
      existing_delamain_targets: unknown[];
      error: string | null;
    };
    expect(output.status).toBe("fail");
    expect(output.error).toContain("target paths already exist");
    expect(output.existing_skill_targets).toHaveLength(1);
    expect(output.existing_delamain_targets).toEqual([]);
    expect(output.existing_skill_targets[0].skill_id).toBe("backlog-module");
    expect(output.existing_skill_targets[0].target_dir).toContain(".claude/skills/backlog-module");
    expect(output.existing_skill_targets[0].target_kind).toBe("directory");
  });
});

test("deploy library projects skills when validation status is warn", async () => {
  await withFixtureSandbox("deploy-library-warning", async ({ root }) => {
    await rm(join(root, ".claude/skills"), { recursive: true, force: true });

    const validationContext = loadSystemValidationContext(root);
    expect(validationContext.system_config).not.toBeNull();

    const output = deployClaudeSkillsFromConfig(root, validationContext.system_config!, "warn", {
      module_filter: "backlog",
    });

    expect(output.status).toBe("pass");
    expect(output.validation_status).toBe("warn");
    expect(output.planned_skill_count).toBe(1);
    expect(output.written_skill_count).toBe(1);
    expect(output.planned_delamain_count).toBe(0);
    expect(output.written_delamain_count).toBe(0);
    expect(existsSync(join(root, ".claude/skills/backlog-module/SKILL.md"))).toBe(true);
  });
});

test("deploy CLI projects bound Delamain bundles into .claude/delamains and is idempotent", async () => {
  await withFixtureSandbox("deploy-delamain-idempotent", async ({ root }) => {
    await rm(join(root, ".claude/skills"), { recursive: true, force: true });
    await rm(join(root, ".claude/delamains"), { recursive: true, force: true });

    const first = Bun.spawnSync({
      cmd: ["bun", "src/deploy.ts", root, "factory"],
      cwd: compilerRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(first.exitCode).toBe(0);

    const firstOutput = JSON.parse(new TextDecoder().decode(first.stdout)) as {
      schema: string;
      status: string;
      planned_skill_count: number;
      written_skill_count: number;
      planned_delamain_count: number;
      written_delamain_count: number;
      planned_delamains: Array<Record<string, unknown>>;
      existing_delamain_targets: unknown[];
      delamain_name_conflicts: unknown[];
    };
    expect(firstOutput.schema).toBe("als-claude-deploy-output@2");
    expect(firstOutput.status).toBe("pass");
    expect(firstOutput.planned_skill_count).toBe(1);
    expect(firstOutput.written_skill_count).toBe(1);
    expect(firstOutput.planned_delamain_count).toBe(1);
    expect(firstOutput.written_delamain_count).toBe(1);
    expect(firstOutput.existing_delamain_targets).toEqual([]);
    expect(firstOutput.delamain_name_conflicts).toEqual([]);
    expect(firstOutput.planned_delamains).toHaveLength(1);
    expect(firstOutput.planned_delamains[0]?.delamain_name).toBe("development-pipeline");
    expect(firstOutput.planned_delamains[0]?.source_dir).toBe(".als/modules/factory/v1/delamains/development-pipeline");
    expect(firstOutput.planned_delamains[0]?.target_dir).toBe(".claude/delamains/development-pipeline");
    for (const plan of firstOutput.planned_delamains) {
      expect(plan).not.toHaveProperty("source_dir_abs");
      expect(plan).not.toHaveProperty("target_dir_abs");
    }

    const firstSnapshot = snapshotTree(join(root, ".claude/delamains"));
    expect(firstSnapshot["development-pipeline/delamain.yaml"]).toContain("phases:");
    expect(firstSnapshot["development-pipeline/agents/planning.md"]).toContain("description:");
    expect(firstSnapshot["development-pipeline/sub-agents/developer.md"]).toContain("description:");
    expect(firstSnapshot["development-pipeline/dispatcher/src/dispatcher.ts"]).toContain("resolve(");

    const second = Bun.spawnSync({
      cmd: ["bun", "src/deploy.ts", root, "factory"],
      cwd: compilerRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(second.exitCode).toBe(0);

    const secondSnapshot = snapshotTree(join(root, ".claude/delamains"));
    expect(secondSnapshot).toEqual(firstSnapshot);
  });
});

test("deploy CLI dry-run reports Delamain work without creating .claude/delamains", async () => {
  await withFixtureSandbox("deploy-delamain-dry-run", async ({ root }) => {
    await rm(join(root, ".claude/skills"), { recursive: true, force: true });
    await rm(join(root, ".claude/delamains"), { recursive: true, force: true });

    const process = Bun.spawnSync({
      cmd: ["bun", "src/deploy.ts", "--dry-run", root, "factory"],
      cwd: compilerRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(process.exitCode).toBe(0);
    const output = JSON.parse(new TextDecoder().decode(process.stdout)) as {
      status: string;
      planned_skill_count: number;
      written_skill_count: number;
      planned_delamain_count: number;
      written_delamain_count: number;
      planned_delamains: Array<Record<string, unknown>>;
    };
    expect(output.status).toBe("pass");
    expect(output.planned_skill_count).toBe(1);
    expect(output.written_skill_count).toBe(0);
    expect(output.planned_delamain_count).toBe(1);
    expect(output.written_delamain_count).toBe(0);
    expect(output.planned_delamains[0]?.delamain_name).toBe("development-pipeline");
    for (const plan of output.planned_delamains) {
      expect(plan).not.toHaveProperty("source_dir_abs");
      expect(plan).not.toHaveProperty("target_dir_abs");
    }
    expect(existsSync(join(root, ".claude/delamains"))).toBe(false);
  });
});

test("deploy CLI excludes unused Delamains that are only present in the registry", async () => {
  await withFixtureSandbox("deploy-unused-delamain", async ({ root }) => {
    await cp(
      join(root, ".als/modules/factory/v1/delamains/development-pipeline"),
      join(root, ".als/modules/factory/v1/delamains/unused-flow"),
      { recursive: true },
    );
    await updateShapeYaml(root, "factory", 1, (shape) => {
      const delamains = (shape.delamains ?? {}) as Record<string, unknown>;
      delamains["unused-flow"] = {
        path: "delamains/unused-flow/delamain.yaml",
      };
      shape.delamains = delamains;
    });

    const process = Bun.spawnSync({
      cmd: ["bun", "src/deploy.ts", "--dry-run", root, "factory"],
      cwd: compilerRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(process.exitCode).toBe(0);
    const output = JSON.parse(new TextDecoder().decode(process.stdout)) as {
      status: string;
      planned_delamain_count: number;
      planned_delamains: Array<{ delamain_name: string }>;
    };
    expect(output.status).toBe("pass");
    expect(output.planned_delamain_count).toBe(1);
    expect(output.planned_delamains.map((plan) => plan.delamain_name)).toEqual(["development-pipeline"]);
  });
});

test("deploy CLI fails preflight when empty targets are required for Delamain projection", async () => {
  await withFixtureSandbox("deploy-delamain-collision", async ({ root }) => {
    await rm(join(root, ".claude/skills"), { recursive: true, force: true });
    await rm(join(root, ".claude/delamains"), { recursive: true, force: true });
    await mkdir(join(root, ".claude/delamains/development-pipeline"), { recursive: true });
    await writeFile(join(root, ".claude/delamains/development-pipeline/delamain.yaml"), "collision\n");

    const process = Bun.spawnSync({
      cmd: ["bun", "src/deploy.ts", "--dry-run", "--require-empty-targets", root, "factory"],
      cwd: compilerRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(process.exitCode).toBe(1);
    const output = JSON.parse(new TextDecoder().decode(process.stdout)) as {
      status: string;
      existing_skill_targets: unknown[];
      existing_delamain_targets: Array<{ delamain_name: string; target_dir: string; target_kind: string }>;
      error: string | null;
    };
    expect(output.status).toBe("fail");
    expect(output.error).toContain("target paths already exist");
    expect(output.existing_skill_targets).toEqual([]);
    expect(output.existing_delamain_targets).toHaveLength(1);
    expect(output.existing_delamain_targets[0]?.delamain_name).toBe("development-pipeline");
    expect(output.existing_delamain_targets[0]?.target_dir).toContain(".claude/delamains/development-pipeline");
    expect(output.existing_delamain_targets[0]?.target_kind).toBe("directory");
  });
});

test("deploy CLI fails when flat Delamain names collide across modules", async () => {
  await withFixtureSandbox("deploy-delamain-name-conflict", async ({ root }) => {
    await rm(join(root, ".claude/delamains"), { recursive: true, force: true });
    await cp(join(root, ".als/modules/factory"), join(root, ".als/modules/release"), { recursive: true });
    await rm(join(root, ".als/modules/release/v1/skills"), { recursive: true, force: true });
    await cp(join(root, "workspace/factory"), join(root, "workspace/release"), { recursive: true });
    await updateSystemYaml(root, (system) => {
      const modules = system.modules as Record<string, unknown>;
      modules.release = {
        path: "workspace/release",
        version: 1,
        skills: [],
      };
    });

    const process = Bun.spawnSync({
      cmd: ["bun", "src/deploy.ts", "--dry-run", root],
      cwd: compilerRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(process.exitCode).toBe(1);
    const output = JSON.parse(new TextDecoder().decode(process.stdout)) as {
      status: string;
      planned_delamain_count: number;
      delamain_name_conflicts: Array<{ delamain_name: string; module_ids: string[]; target_dir: string }>;
      error: string | null;
    };
    expect(output.status).toBe("fail");
    expect(output.planned_delamain_count).toBe(2);
    expect(output.error).toContain("Delamain names would collide");
    expect(output.delamain_name_conflicts).toHaveLength(1);
    expect(output.delamain_name_conflicts[0]?.delamain_name).toBe("development-pipeline");
    expect(output.delamain_name_conflicts[0]?.module_ids).toEqual(["factory", "release"]);
    expect(output.delamain_name_conflicts[0]?.target_dir).toBe(".claude/delamains/development-pipeline");
  });
});

test("deploy library preserves prior planned skills when a later module shape file is missing", async () => {
  await withFixtureSandbox("deploy-shape-missing", async ({ root }) => {
    await removePath(root, ".als/modules/people/v1/shape.yaml");

    const validationContext = loadSystemValidationContext(root);
    expect(validationContext.system_config).not.toBeNull();

    const output = deployClaudeSkillsFromConfig(root, validationContext.system_config!, "pass", {
      dry_run: true,
    }) as {
      status: string;
      validation_status: string;
      planned_skill_count: number;
      planned_skills: Array<{ module_id: string }>;
      error: string | null;
    };
    expect(output.status).toBe("fail");
    expect(output.validation_status).toBe("pass");
    expect(output.planned_skill_count).toBeGreaterThan(0);
    expect(output.planned_skills.length).toBe(output.planned_skill_count);
    expect(output.planned_skills.map((plan) => plan.module_id)).toContain("people");
    expect(output.planned_skills.map((plan) => plan.module_id)).toContain("backlog");
    expect(output.error).toContain("Could not read shape.yaml");
    expect(output.error).toContain("module 'people'");
  });
});

test("deploy library reports YAML parse failures while planning Claude projection", async () => {
  await withFixtureSandbox("deploy-shape-parse-failure", async ({ root }) => {
    await writePath(root, ".als/modules/people/v1/shape.yaml", "dependencies: [\n");

    const validationContext = loadSystemValidationContext(root);
    expect(validationContext.system_config).not.toBeNull();

    const output = deployClaudeSkillsFromConfig(root, validationContext.system_config!, "pass", {
      dry_run: true,
    }) as {
      status: string;
      validation_status: string;
      planned_skill_count: number;
      error: string | null;
    };
    expect(output.status).toBe("fail");
    expect(output.validation_status).toBe("pass");
    expect(output.planned_skill_count).toBeGreaterThan(0);
    expect(output.error).toContain("Could not parse shape.yaml");
    expect(output.error).toContain("module 'people'");
  });
});

test("deploy library reports schema validation details when shape.yaml is structurally invalid", async () => {
  await withFixtureSandbox("deploy-shape-invalid-schema", async ({ root }) => {
    await writePath(root, ".als/modules/people/v1/shape.yaml", "dependencies: []\nentities: []\n");

    const validationContext = loadSystemValidationContext(root);
    expect(validationContext.system_config).not.toBeNull();

    const output = deployClaudeSkillsFromConfig(root, validationContext.system_config!, "pass", {
      dry_run: true,
    }) as {
      status: string;
      validation_status: string;
      planned_skill_count: number;
      error: string | null;
    };
    expect(output.status).toBe("fail");
    expect(output.validation_status).toBe("pass");
    expect(output.planned_skill_count).toBeGreaterThan(0);
    expect(output.error).toContain("Could not validate shape.yaml");
    expect(output.error).toContain("entities");
  });
});

test("deploy library fails closed when one entity declares multiple Delamain fields", async () => {
  await withFixtureSandbox("deploy-delamain-multi-binding", async ({ root }) => {
    await updateShapeYaml(root, "factory", 1, (shape) => {
      const entities = shape.entities as Record<string, { fields: Record<string, unknown> }>;
      entities["work-item"]!.fields["secondary_status"] = {
        type: "delamain",
        allow_null: true,
        delamain: "development-pipeline",
      };
    });

    const validationContext = loadSystemValidationContext(root);
    expect(validationContext.system_config).not.toBeNull();

    const output = deployClaudeSkillsFromConfig(root, validationContext.system_config!, "pass", {
      dry_run: true,
    });

    expect(output.status).toBe("fail");
    expect(output.planned_delamain_count).toBe(0);
    expect(output.error).toContain("multiple Delamain bindings");
    expect(output.error).toContain("secondary_status");
  });
});

function snapshotTree(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  walk(root, root, snapshot);
  return snapshot;
}

function walk(root: string, current: string, snapshot: Record<string, string>): void {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) {
      walk(root, fullPath, snapshot);
      continue;
    }

    snapshot[relativeFrom(root, fullPath)] = readFileSync(fullPath, "utf-8");
  }
}

function relativeFrom(root: string, filePath: string): string {
  return filePath.slice(root.length + 1).replace(/\\/g, "/");
}
