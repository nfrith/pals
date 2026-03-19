import { expect, test } from "bun:test";
import { codes } from "../src/diagnostics.ts";
import {
  expectSystemDiagnostic,
  mkdirPath,
  updateSystemYaml,
  validateFixture,
  withFixtureSandbox,
  writePath,
} from "./helpers/fixture.ts";

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
    expectSystemDiagnostic(result, codes.SYSTEM_MODULE_PATH_CONFLICT, "workspace/backlog");
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
    expectSystemDiagnostic(result, codes.SYSTEM_MODULE_PATH_CONFLICT, "workspace/backlog/archive");
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
    expectSystemDiagnostic(result, codes.SHAPE_FILE_MISSING, ".als/modules/client-registry/v9.yaml");
  });
});

test.concurrent("inferred shape paths must be files", async () => {
  await withFixtureSandbox("system-shape-path-file", async ({ root }) => {
    await mkdirPath(root, ".als/modules/client-registry/v9.yaml");
    await updateSystemYaml(root, (config) => {
      const modules = config.modules as Record<string, Record<string, unknown>>;
      modules["client-registry"].version = 9;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectSystemDiagnostic(result, codes.SHAPE_FILE_MISSING, ".als/modules/client-registry/v9.yaml");
  });
});

test.concurrent("unknown module filters fail cleanly", async () => {
  await withFixtureSandbox("system-filter-unknown", async ({ root }) => {
    const result = validateFixture(root, "ghost-module");
    expect(result.status).toBe("fail");
    expectSystemDiagnostic(result, codes.SYSTEM_FILTER_UNKNOWN, ".als/system.yaml");
  });
});
