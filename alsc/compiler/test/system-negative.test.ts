import { expect, test } from "bun:test";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { codes, reasons } from "../src/diagnostics.ts";
import {
  expectModuleDiagnostic,
  expectSystemDiagnostic,
  mkdirPath,
  removePath,
  renamePath,
  updateRecord,
  updateShapeYaml,
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
  ".als/registry",
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
      expectSystemDiagnostic(result, codes.SYSTEM_INVALID, ".als/system.ts");
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
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_MODULE_PATH_CONFLICT, ".als/system.ts");
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
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_MODULE_PATH_CONFLICT, ".als/system.ts");
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
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_MODULE_PATH_CONFLICT, ".als/system.ts");
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
    await mkdirPath(root, ".als/modules/client-registry/v9/module.ts");
    await updateSystemYaml(root, (config) => {
      const modules = config.modules as Record<string, Record<string, unknown>>;
      modules["client-registry"].version = 9;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SHAPE_FILE_MISSING, ".als/modules/client-registry/v9/module.ts");
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
    expect(result.module_filter).toBe("ghost-module");
    expectSystemDiagnostic(result, codes.SYSTEM_FILTER_UNKNOWN, ".als/system.ts");
  });
});

test.concurrent("filtered validation still reports real unresolved refs from the selected module", async () => {
  await withFixtureSandbox("system-filter-ref-unresolved", async ({ root }) => {
    await removePath(root, "workspace/people/persons/PPL-000101.md");

    const result = validateFixture(root, "backlog");
    expect(result.status).toBe("fail");
    expect(result.module_filter).toBe("backlog");
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].module_id).toBe("backlog");
    expect(result.system_diagnostics.find((item) => item.code === codes.SYSTEM_FILTER_CONTEXT_INVALID)).toBeUndefined();
    expectModuleDiagnostic(result, "backlog", codes.REF_UNRESOLVED, "workspace/backlog/items/ITEM-0001.md");
  });
});

test.concurrent("filtered validation fails cleanly when dependency context is invalid", async () => {
  await withFixtureSandbox("system-filter-context-invalid", async ({ root }) => {
    await updateRecord(root, "workspace/people/persons/PPL-000101.md", (record) => {
      delete record.data.display_name;
    });

    const result = validateFixture(root, "backlog");
    expect(result.status).toBe("fail");
    expect(result.module_filter).toBe("backlog");
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].module_id).toBe("backlog");

    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_FILTER_CONTEXT_INVALID, ".als/system.ts");
    expect(diagnostic.reason).toBe(reasons.SYSTEM_FILTER_CONTEXT_INVALID);
    expect(diagnostic.actual).toEqual(["people"]);

    expect(result.modules[0].diagnostics.some((item) => item.code === codes.REF_UNRESOLVED)).toBe(false);
  });
});

test.concurrent("filtered validation suppresses unresolved refs when a dependency shape cannot be loaded", async () => {
  await withFixtureSandbox("system-filter-context-invalid-shape", async ({ root }) => {
    await updateShapeYaml(root, "people", 1, (shape) => {
      delete shape.entities;
    });

    const result = validateFixture(root, "backlog");
    expect(result.status).toBe("fail");
    expect(result.module_filter).toBe("backlog");
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].module_id).toBe("backlog");

    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_FILTER_CONTEXT_INVALID, ".als/system.ts");
    expect(diagnostic.reason).toBe(reasons.SYSTEM_FILTER_CONTEXT_INVALID);
    expect(diagnostic.actual).toEqual(["people"]);
    expect(diagnostic.hint).toContain("transitive dependencies beyond them may not have been loaded");

    expect(result.modules[0].diagnostics.some((item) => item.code === codes.REF_UNRESOLVED)).toBe(false);
  });
});

test.concurrent("stale top-level schema fields in system config are rejected", async () => {
  await withFixtureSandbox("system-stale-schema-field", async ({ root }) => {
    await updateSystemYaml(root, (config) => {
      config.schema = "als-system@1";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_INVALID, ".als/system.ts");
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
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_ALS_VERSION_INVALID, ".als/system.ts");
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
      const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_ALS_VERSION_INVALID, ".als/system.ts");
      expect(diagnostic.reason).toBe(reasons.SYSTEM_ALS_VERSION_INVALID);
      expect(diagnostic.field).toBe("als_version");
    });
  });
}

test.concurrent("unsupported als_version stops validation before module loading", async () => {
  await withFixtureSandbox("system-als-version-unsupported", async ({ root }) => {
    await updateSystemYaml(root, (config) => {
      config.als_version = 3;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_ALS_VERSION_UNSUPPORTED, ".als/system.ts");
    expect(diagnostic.reason).toBe(reasons.SYSTEM_ALS_VERSION_UNSUPPORTED);
    expect(result.modules).toHaveLength(0);
    expect(result.als_version).toBe(3);
  });
});

test.concurrent("ALS v2 rejects bundled dispatcher source inside Delamain bundles", async () => {
  await withFixtureSandbox("system-v2-bundled-dispatcher-forbidden", async ({ root }) => {
    await mkdirPath(root, ".als/modules/factory/v1/delamains/development-pipeline/dispatcher");
    await writePath(
      root,
      ".als/modules/factory/v1/delamains/development-pipeline/dispatcher/VERSION",
      "15\n",
    );

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectModuleDiagnostic(
      result,
      "factory",
      codes.DELAMAIN_FILE_INVALID,
      ".als/modules/factory/v1/delamains/development-pipeline/dispatcher",
    );
    expect(diagnostic.reason).toBe(reasons.DELAMAIN_BUNDLED_DISPATCHER_FORBIDDEN);
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
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_INVALID, ".als/system.ts");
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
      const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_INVALID, ".als/system.ts");
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
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_INVALID, ".als/system.ts");
    expect(diagnostic.field).toBe("modules.backlog.skills.0");
  });
});

for (const {
  label,
  mutate,
  expectedMessage,
} of [
  {
    label: "missing",
    mutate: (moduleConfig: Record<string, unknown>) => {
      delete moduleConfig.description;
    },
    expectedMessage: "module backlog description is required",
  },
  {
    label: "blank",
    mutate: (moduleConfig: Record<string, unknown>) => {
      moduleConfig.description = "   ";
    },
    expectedMessage: "module backlog description must be a non-empty trimmed single-line string",
  },
  {
    label: "trimmed",
    mutate: (moduleConfig: Record<string, unknown>) => {
      moduleConfig.description = " backlog work";
    },
    expectedMessage: "module backlog description must not start or end with whitespace",
  },
  {
    label: "single-line",
    mutate: (moduleConfig: Record<string, unknown>) => {
      moduleConfig.description = "Backlog work\nwith wrap";
    },
    expectedMessage: "module backlog description must stay on a single line",
  },
  {
    label: "too-long",
    mutate: (moduleConfig: Record<string, unknown>) => {
      moduleConfig.description = "x".repeat(121);
    },
    expectedMessage: "module backlog description must be 120 characters or fewer",
  },
] as const) {
  test.concurrent(`module descriptions fail with a targeted diagnostic (${label})`, async () => {
    await withFixtureSandbox(`system-module-description-${label}`, async ({ root }) => {
      await updateSystemYaml(root, (config) => {
        const modules = config.modules as Record<string, Record<string, unknown>>;
        mutate(modules.backlog);
      });

      const result = validateFixture(root);
      expect(result.status).toBe("fail");
      const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_INVALID, ".als/system.ts");
      expect(diagnostic.field).toBe("modules.backlog.description");
      expect(diagnostic.reason).toBe(reasons.SYSTEM_MODULE_DESCRIPTION_INVALID);
      expect(diagnostic.message).toContain(expectedMessage);
      expect(diagnostic.message).toContain("120");
    });
  });
}

test.concurrent("duplicate skill ids surface a stable machine-readable reason", async () => {
  await withFixtureSandbox("system-skills-duplicate-reason", async ({ root }) => {
    await updateSystemYaml(root, (config) => {
      const modules = config.modules as Record<string, Record<string, unknown>>;
      modules.backlog.skills = ["backlog-module", "backlog-module"];
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_INVALID, ".als/system.ts");
    expect(diagnostic.field).toBe("modules.backlog.skills.1");
    expect(diagnostic.reason).toBe(reasons.SYSTEM_SKILLS_DUPLICATE);
  });
});

test.concurrent("active skill ids must be globally unique across modules", async () => {
  await withFixtureSandbox("system-skills-global-duplicate", async ({ root }) => {
    await updateSystemYaml(root, (config) => {
      const modules = config.modules as Record<string, Record<string, unknown>>;
      modules["client-registry"].skills = ["backlog-module"];
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_INVALID, ".als/system.ts");
    expect(diagnostic.field).toBe("modules.client-registry.skills.0");
    expect(diagnostic.reason).toBe(reasons.SYSTEM_SKILLS_GLOBAL_DUPLICATE);
    expect(diagnostic.message).toContain("backlog-module");
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

    const systemConfigPath = join(root, ".als/system.ts");
    await chmod(systemConfigPath, 0o000);

    try {
      const result = validateFixture(root);
      expect(result.status).toBe("fail");
      const diagnostic = expectSystemDiagnostic(result, codes.SYSTEM_INVALID, ".als/system.ts");
      expect(diagnostic.message).toContain("Could not read TypeScript entrypoint");
      expect(diagnostic.hint).toContain("TypeScript");
    } finally {
      await chmod(systemConfigPath, 0o600);
    }
  });
});
