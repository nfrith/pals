import { expect, test } from "bun:test";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { codes, reasons } from "../src/diagnostics.ts";
import {
  expectSystemDiagnostic,
  mkdirPath,
  removePath,
  renamePath,
  updateSystemYaml,
  validateFixture,
  withFixtureSandbox,
  writePath,
} from "./helpers/fixture.ts";

function isRootUser(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

for (const invalidPath of [
  "./clients/registry",
  "/clients/registry",
  "clients//registry",
  "clients/../registry",
  ".pals/registry",
  "clients/.cache",
]) {
  test.concurrent(`module paths must be normalized relative slug paths (${invalidPath})`, async () => {
    await withFixtureSandbox("system-module-path-invalid", async ({ root }) => {
      await updateSystemYaml(root, (config) => {
        const modules = config.modules as Record<string, Record<string, unknown>>;
        modules["client-registry"].path = invalidPath;
      });

      const result = validateFixture(root);
      expect(result.status).toBe("fail");
      expectSystemDiagnostic(result, codes.SYSTEM_INVALID, ".als/system.yaml");
    });
  });
}

test.concurrent("declared module paths must exist on disk", async () => {
  await withFixtureSandbox("system-module-path-missing", async ({ root }) => {
    await updateSystemYaml(root, (config) => {
      const modules = config.modules as Record<string, Record<string, unknown>>;
      modules["client-registry"].path = "ghost-root";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectSystemDiagnostic(result, codes.SYSTEM_MODULE_PATH_INVALID, "ghost-root");
  });
});

test.concurrent("declared module paths must be directories", async () => {
  await withFixtureSandbox("system-module-path-file", async ({ root }) => {
    await writePath(root, "clients/registry-file", "not a directory");
    await updateSystemYaml(root, (config) => {
      const modules = config.modules as Record<string, Record<string, unknown>>;
      modules["client-registry"].path = "clients/registry-file";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectSystemDiagnostic(result, codes.SYSTEM_MODULE_PATH_INVALID, "clients/registry-file");
  });
});

test.concurrent("exact duplicate module paths are rejected", async () => {
  await withFixtureSandbox("system-path-conflict-exact", async ({ root }) => {
    await updateSystemYaml(root, (config) => {
      const modules = config.modules as Record<string, Record<string, unknown>>;
      modules["client-registry"].path = "workspace/backlog";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_MODULE_PATH_CONFLICT, ".als/system.yaml");
    expect(diagnostic.message).toContain("workspace/backlog");
  });
});

test.concurrent("nested module paths are rejected", async () => {
  await withFixtureSandbox("system-path-conflict-nested", async ({ root }) => {
    await mkdirPath(root, "workspace/backlog/archive");
    await updateSystemYaml(root, (config) => {
      const modules = config.modules as Record<string, Record<string, unknown>>;
      modules["client-registry"].path = "workspace/backlog/archive";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_MODULE_PATH_CONFLICT, ".als/system.yaml");
    expect(diagnostic.message).toContain("workspace/backlog/archive");
  });
});

test.concurrent("ancestor module paths are rejected", async () => {
  await withFixtureSandbox("system-path-conflict-ancestor", async ({ root }) => {
    await updateSystemYaml(root, (config) => {
      const modules = config.modules as Record<string, Record<string, unknown>>;
      modules["client-registry"].path = "workspace";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_MODULE_PATH_CONFLICT, ".als/system.yaml");
    expect(diagnostic.message).toContain("workspace");
  });
});

test.concurrent("missing inferred shape files are rejected", async () => {
  await withFixtureSandbox("system-missing-shape", async ({ root }) => {
    await updateSystemYaml(root, (config) => {
      const modules = config.modules as Record<string, Record<string, unknown>>;
      modules["client-registry"].version = 9;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectSystemDiagnostic(result, codes.SYSTEM_MODULE_BUNDLE_INVALID, ".als/modules/client-registry/v9");
  });
});

test.concurrent("inferred shape paths must be files", async () => {
  await withFixtureSandbox("system-shape-path-file", async ({ root }) => {
    await mkdirPath(root, ".als/modules/client-registry/v9/shape.yaml");
    await updateSystemYaml(root, (config) => {
      const modules = config.modules as Record<string, Record<string, unknown>>;
      modules["client-registry"].version = 9;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SHAPE_FILE_MISSING, ".als/modules/client-registry/v9/shape.yaml");
    expect(diagnostic.reason).toBe(reasons.SYSTEM_SHAPE_FILE_NOT_FILE);
  });
});

test.concurrent("required version bundles must be directories", async () => {
  await withFixtureSandbox("system-bundle-path-not-directory", async ({ root }) => {
    await writePath(root, ".als/modules/client-registry/v9", "not a bundle directory");
    await updateSystemYaml(root, (config) => {
      const modules = config.modules as Record<string, Record<string, unknown>>;
      modules["client-registry"].version = 9;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_MODULE_BUNDLE_INVALID, ".als/modules/client-registry/v9");
    expect(diagnostic.reason).toBe(reasons.SYSTEM_MODULE_BUNDLE_NOT_DIRECTORY);
  });
});

test.concurrent("unknown module filters fail cleanly", async () => {
  await withFixtureSandbox("system-filter-unknown", async ({ root }) => {
    const result = validateFixture(root, "ghost-module");
    expect(result.status).toBe("fail");
    expectSystemDiagnostic(result, codes.SYSTEM_FILTER_UNKNOWN, ".als/system.yaml");
  });
});

test.concurrent("stale top-level schema fields in system config are rejected", async () => {
  await withFixtureSandbox("system-stale-schema-field", async ({ root }) => {
    await updateSystemYaml(root, (config) => {
      config.schema = "als-system@1";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_INVALID, ".als/system.yaml");
    expect(diagnostic.reason).toBe(reasons.SYSTEM_SCHEMA_REMOVED);
  });
});

test.concurrent("missing als_version fails with a dedicated system diagnostic", async () => {
  await withFixtureSandbox("system-als-version-missing", async ({ root }) => {
    await updateSystemYaml(root, (config) => {
      delete config.als_version;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_ALS_VERSION_INVALID, ".als/system.yaml");
    expect(diagnostic.reason).toBe(reasons.SYSTEM_ALS_VERSION_INVALID);
  });
});

for (const { label, value } of [
  { label: "zero", value: 0 },
  { label: "negative integer", value: -1 },
  { label: "string", value: "one" },
]) {
  test.concurrent(`invalid als_version values are rejected (${label})`, async () => {
    await withFixtureSandbox(`system-als-version-invalid-${label.replaceAll(" ", "-")}`, async ({ root }) => {
      await updateSystemYaml(root, (config) => {
        config.als_version = value;
      });

      const result = validateFixture(root);
      expect(result.status).toBe("fail");
      const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_ALS_VERSION_INVALID, ".als/system.yaml");
      expect(diagnostic.reason).toBe(reasons.SYSTEM_ALS_VERSION_INVALID);
      expect(diagnostic.field).toBe("als_version");
    });
  });
}

test.concurrent("unsupported als_version stops validation before module loading", async () => {
  await withFixtureSandbox("system-als-version-unsupported", async ({ root }) => {
    await updateSystemYaml(root, (config) => {
      config.als_version = 2;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_ALS_VERSION_UNSUPPORTED, ".als/system.yaml");
    expect(diagnostic.reason).toBe(reasons.SYSTEM_ALS_VERSION_UNSUPPORTED);
    expect(result.modules).toHaveLength(0);
    expect(result.als_version).toBe(2);
  });
});

test.concurrent("stale schema diagnostics do not suppress other system parse errors", async () => {
  await withFixtureSandbox("system-stale-schema-plus-missing-als-version", async ({ root }) => {
    await updateSystemYaml(root, (config) => {
      config.schema = "als-system@1";
      delete config.als_version;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expect(result.system_diagnostics.some((diagnostic) => diagnostic.reason === reasons.SYSTEM_SCHEMA_REMOVED)).toBe(true);
    expect(
      result.system_diagnostics.some(
        (diagnostic) =>
          diagnostic.code === codes.SYSTEM_ALS_VERSION_INVALID
          && diagnostic.reason === reasons.SYSTEM_ALS_VERSION_INVALID
          && diagnostic.field === "als_version",
      ),
    ).toBe(true);
  });
});

test.concurrent("stale singular skill fields are rejected even when skills exists", async () => {
  await withFixtureSandbox("system-singular-skill-removed", async ({ root }) => {
    await updateSystemYaml(root, (config) => {
      const modules = config.modules as Record<string, Record<string, unknown>>;
      modules.backlog.skill = "backlog-module";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_INVALID, ".als/system.yaml");
    expect(diagnostic.field).toBe("modules.backlog.skill");
    expect(diagnostic.reason).toBe(reasons.SYSTEM_SKILL_REMOVED);
  });
});

test.concurrent("modules may declare empty skills arrays and omit the skills directory", async () => {
  await withFixtureSandbox("system-empty-skills", async ({ root }) => {
    await updateSystemYaml(root, (config) => {
      const modules = config.modules as Record<string, Record<string, unknown>>;
      modules.backlog.skills = [];
    });
    await removePath(root, ".als/modules/backlog/v1/skills");

    const result = validateFixture(root);
    expect(result.status).toBe("pass");
  });
});

for (const { label, value } of [
  { label: "string", value: "backlog-module" },
  { label: "number", value: 42 },
]) {
  test.concurrent(`skills rejects non-array values (${label})`, async () => {
    await withFixtureSandbox(`system-skills-non-array-${label}`, async ({ root }) => {
      await updateSystemYaml(root, (config) => {
        const modules = config.modules as Record<string, Record<string, unknown>>;
        modules.backlog.skills = value;
      });

      const result = validateFixture(root);
      expect(result.status).toBe("fail");
      const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_INVALID, ".als/system.yaml");
      expect(diagnostic.field).toBe("modules.backlog.skills");
    });
  });
}

test.concurrent("invalid skill ids are rejected", async () => {
  await withFixtureSandbox("system-skill-id-invalid", async ({ root }) => {
    await updateSystemYaml(root, (config) => {
      const modules = config.modules as Record<string, Record<string, unknown>>;
      modules.backlog.skills = ["Backlog_Module"];
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_INVALID, ".als/system.yaml");
    expect(diagnostic.field).toBe("modules.backlog.skills.0");
  });
});

test.concurrent("duplicate skill ids surface a stable machine-readable reason", async () => {
  await withFixtureSandbox("system-skills-duplicate-reason", async ({ root }) => {
    await updateSystemYaml(root, (config) => {
      const modules = config.modules as Record<string, Record<string, unknown>>;
      modules.backlog.skills = ["backlog-module", "backlog-module"];
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_INVALID, ".als/system.yaml");
    expect(diagnostic.field).toBe("modules.backlog.skills.1");
    expect(diagnostic.reason).toBe(reasons.SYSTEM_SKILLS_DUPLICATE);
  });
});

test.concurrent("gaps in active module version history are rejected", async () => {
  await withFixtureSandbox("system-version-history-gap", async ({ root }) => {
    await renamePath(root, ".als/modules/experiments/v2", ".als/modules/experiments/v3");
    await updateSystemYaml(root, (config) => {
      const modules = config.modules as Record<string, Record<string, unknown>>;
      modules.experiments.version = 3;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_MODULE_BUNDLE_INVALID, ".als/modules/experiments/v2");
    expect(diagnostic.reason).toBe(reasons.SYSTEM_MODULE_BUNDLE_MISSING);
  });
});

test.concurrent("future staged version bundles above the active version are ignored", async () => {
  await withFixtureSandbox("system-future-version-staged", async ({ root }) => {
    await mkdirPath(root, ".als/modules/experiments/v3");
    await writePath(root, ".als/modules/experiments/v3/README.md", "staged future bundle");

    const result = validateFixture(root);
    expect(result.status).toBe("pass");
  });
});

test.concurrent("missing migration directories are rejected for active versions above v1", async () => {
  await withFixtureSandbox("system-migration-dir-missing", async ({ root }) => {
    await removePath(root, ".als/modules/experiments/v2/migrations");

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_MODULE_MIGRATIONS_INVALID, ".als/modules/experiments/v2/migrations");
    expect(diagnostic.reason).toBe(reasons.SYSTEM_MIGRATIONS_DIR_MISSING);
  });
});

test.concurrent("v1 modules do not require migration assets", async () => {
  await withFixtureSandbox("system-v1-no-migrations-required", async ({ root }) => {
    const result = validateFixture(root);
    expect(
      result.system_diagnostics.some(
        (diagnostic) =>
          diagnostic.code === codes.SYSTEM_MODULE_MIGRATIONS_INVALID
          && diagnostic.file.endsWith(".als/modules/backlog/v1/migrations"),
      ),
    ).toBe(false);
  });
});

test.concurrent("migration directories must be directories", async () => {
  await withFixtureSandbox("system-migration-dir-not-directory", async ({ root }) => {
    await removePath(root, ".als/modules/experiments/v2/migrations");
    await writePath(root, ".als/modules/experiments/v2/migrations", "not a directory");

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_MODULE_MIGRATIONS_INVALID, ".als/modules/experiments/v2/migrations");
    expect(diagnostic.reason).toBe(reasons.SYSTEM_MIGRATIONS_DIR_NOT_DIRECTORY);
  });
});

test.concurrent("missing migration manifests are rejected", async () => {
  await withFixtureSandbox("system-migration-manifest-missing", async ({ root }) => {
    await removePath(root, ".als/modules/experiments/v2/migrations/MANIFEST.md");

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_MODULE_MIGRATIONS_INVALID, ".als/modules/experiments/v2/migrations/MANIFEST.md");
    expect(diagnostic.reason).toBe(reasons.SYSTEM_MIGRATION_MANIFEST_MISSING);
  });
});

test.concurrent("migration manifests must be files", async () => {
  await withFixtureSandbox("system-migration-manifest-not-file", async ({ root }) => {
    await removePath(root, ".als/modules/experiments/v2/migrations/MANIFEST.md");
    await mkdirPath(root, ".als/modules/experiments/v2/migrations/MANIFEST.md");

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_MODULE_MIGRATIONS_INVALID, ".als/modules/experiments/v2/migrations/MANIFEST.md");
    expect(diagnostic.reason).toBe(reasons.SYSTEM_MIGRATION_MANIFEST_NOT_FILE);
  });
});

test.concurrent("migration bundles must include an artifact besides MANIFEST.md", async () => {
  await withFixtureSandbox("system-migration-artifact-missing", async ({ root }) => {
    await removePath(root, ".als/modules/experiments/v2/migrations/migrate_from_v1.py");

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_MODULE_MIGRATIONS_INVALID, ".als/modules/experiments/v2/migrations");
    expect(diagnostic.reason).toBe(reasons.SYSTEM_MIGRATION_ASSET_MISSING);
  });
});

test.concurrent("listed skills must provide a SKILL.md entrypoint", async () => {
  await withFixtureSandbox("system-skill-entrypoint-missing", async ({ root }) => {
    await removePath(root, ".als/modules/backlog/v1/skills/backlog-module/SKILL.md");

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_MODULE_SKILLS_INVALID, ".als/modules/backlog/v1/skills/backlog-module/SKILL.md");
    expect(diagnostic.reason).toBe(reasons.SYSTEM_SKILL_ENTRY_MISSING);
  });
});

test.concurrent("listed skill entrypoints must be files", async () => {
  await withFixtureSandbox("system-skill-entrypoint-not-file", async ({ root }) => {
    await removePath(root, ".als/modules/backlog/v1/skills/backlog-module/SKILL.md");
    await mkdirPath(root, ".als/modules/backlog/v1/skills/backlog-module/SKILL.md");

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_MODULE_SKILLS_INVALID, ".als/modules/backlog/v1/skills/backlog-module/SKILL.md");
    expect(diagnostic.reason).toBe(reasons.SYSTEM_SKILL_ENTRY_NOT_FILE);
  });
});

test.concurrent("unlisted skill directories in the active bundle are rejected", async () => {
  await withFixtureSandbox("system-unlisted-skill-dir", async ({ root }) => {
    await mkdirPath(root, ".als/modules/backlog/v1/skills/archive-module");
    await writePath(
      root,
      ".als/modules/backlog/v1/skills/archive-module/SKILL.md",
      "---\nname: archive-module\ndescription: extra skill\n---\n",
    );

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_MODULE_SKILLS_INVALID, ".als/modules/backlog/v1/skills/archive-module");
    expect(diagnostic.reason).toBe(reasons.SYSTEM_SKILLS_UNLISTED_DIRECTORY);
  });
});

test.concurrent("unexpected files in the skills root are rejected", async () => {
  await withFixtureSandbox("system-skills-unexpected-root-file", async ({ root }) => {
    await writePath(root, ".als/modules/backlog/v1/skills/README.md", "unexpected root file");

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_MODULE_SKILLS_INVALID, ".als/modules/backlog/v1/skills/README.md");
    expect(diagnostic.reason).toBe(reasons.SYSTEM_SKILLS_UNEXPECTED_ROOT_FILE);
  });
});

test.concurrent("unreadable active skills directories fail cleanly", async () => {
  await withFixtureSandbox("system-skills-dir-unreadable", async ({ root }) => {
    if (isRootUser()) return;

    const skillsPath = join(root, ".als/modules/backlog/v1/skills");
    await chmod(skillsPath, 0o000);

    try {
      const result = validateFixture(root);
      expect(result.status).toBe("fail");
      const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_MODULE_SKILLS_INVALID, ".als/modules/backlog/v1/skills");
      expect(diagnostic.reason).toBe(reasons.SYSTEM_SKILLS_DIR_UNREADABLE);
    } finally {
      await chmod(skillsPath, 0o700);
    }
  });
});

test.concurrent("unreadable system config files fail cleanly", async () => {
  await withFixtureSandbox("system-unreadable-config", async ({ root }) => {
    if (isRootUser()) return;

    const systemConfigPath = join(root, ".als/system.yaml");
    await chmod(systemConfigPath, 0o000);

    try {
      const result = validateFixture(root);
      expect(result.status).toBe("fail");
      const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_INVALID, ".als/system.yaml");
      expect(diagnostic.message).toContain("Could not read YAML file");
      expect(diagnostic.hint).toContain("Check file permissions");
    } finally {
      await chmod(systemConfigPath, 0o600);
    }
  });
});
