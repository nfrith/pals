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

test.concurrent("unknown module root fails system validation", async () => {
  await withFixtureSandbox("system-unknown-root", async ({ root }) => {
    await updateSystemYaml(root, (config) => {
      const modules = config.modules as Record<string, Record<string, unknown>>;
      modules["client-registry"].root = "ghosts";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectSystemDiagnostic(result, codes.SYSTEM_INVALID, ".pals/system.yaml");
  });
});

test.concurrent("duplicate roots fail schema validation", async () => {
  await withFixtureSandbox("system-duplicate-roots", async ({ root }) => {
    await updateSystemYaml(root, (config) => {
      (config.roots as string[]).push("clients");
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectSystemDiagnostic(result, codes.SYSTEM_INVALID, ".pals/system.yaml");
  });
});

test.concurrent("roots must be single-segment slugs", async () => {
  await withFixtureSandbox("system-root-slug", async ({ root }) => {
    await updateSystemYaml(root, (config) => {
      const roots = config.roots as string[];
      roots[1] = "clients/nested";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectSystemDiagnostic(result, codes.SYSTEM_INVALID, ".pals/system.yaml");
  });
});

test.concurrent("module dirs must be single-segment slugs", async () => {
  await withFixtureSandbox("system-module-dir-slug", async ({ root }) => {
    await updateSystemYaml(root, (config) => {
      const modules = config.modules as Record<string, Record<string, unknown>>;
      modules["client-registry"].dir = "registry/nested";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectSystemDiagnostic(result, codes.SYSTEM_INVALID, ".pals/system.yaml");
  });
});

test.concurrent("declared roots must exist on disk", async () => {
  await withFixtureSandbox("system-root-missing", async ({ root }) => {
    await updateSystemYaml(root, (config) => {
      const roots = config.roots as string[];
      roots[4] = "ghost-root";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectSystemDiagnostic(result, codes.SYSTEM_ROOT_INVALID, "ghost-root");
  });
});

test.concurrent("declared roots must be directories", async () => {
  await withFixtureSandbox("system-root-file", async ({ root }) => {
    await writePath(root, "ghost-root", "not a directory");
    await updateSystemYaml(root, (config) => {
      const roots = config.roots as string[];
      roots[4] = "ghost-root";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectSystemDiagnostic(result, codes.SYSTEM_ROOT_INVALID, "ghost-root");
  });
});

test.concurrent("declared module directories must exist on disk", async () => {
  await withFixtureSandbox("system-module-dir-missing", async ({ root }) => {
    await updateSystemYaml(root, (config) => {
      const modules = config.modules as Record<string, Record<string, unknown>>;
      modules["client-registry"].dir = "missing";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectSystemDiagnostic(result, codes.SYSTEM_MODULE_DIR_INVALID, "clients/missing");
  });
});

test.concurrent("declared module directories must be directories", async () => {
  await withFixtureSandbox("system-module-dir-file", async ({ root }) => {
    await writePath(root, "clients/registry-file", "not a directory");
    await updateSystemYaml(root, (config) => {
      const modules = config.modules as Record<string, Record<string, unknown>>;
      modules["client-registry"].dir = "registry-file";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectSystemDiagnostic(result, codes.SYSTEM_MODULE_DIR_INVALID, "clients/registry-file");
  });
});

test.concurrent("duplicate module locations are rejected", async () => {
  await withFixtureSandbox("system-location-conflict", async ({ root }) => {
    await updateSystemYaml(root, (config) => {
      const modules = config.modules as Record<string, Record<string, unknown>>;
      modules["client-registry"].root = "workspace";
      modules["client-registry"].dir = "backlog";
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectSystemDiagnostic(result, codes.SYSTEM_MODULE_LOCATION_CONFLICT, "workspace/backlog");
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
    expectSystemDiagnostic(result, codes.SHAPE_FILE_MISSING, ".pals/modules/client-registry/v9.yaml");
  });
});

test.concurrent("inferred shape paths must be files", async () => {
  await withFixtureSandbox("system-shape-path-file", async ({ root }) => {
    await mkdirPath(root, ".pals/modules/client-registry/v9.yaml");
    await updateSystemYaml(root, (config) => {
      const modules = config.modules as Record<string, Record<string, unknown>>;
      modules["client-registry"].version = 9;
    });

    const result = validateFixture(root);
    expect(result.status).toBe("fail");
    expectSystemDiagnostic(result, codes.SHAPE_FILE_MISSING, ".pals/modules/client-registry/v9.yaml");
  });
});

test.concurrent("unknown module filters fail cleanly", async () => {
  await withFixtureSandbox("system-filter-unknown", async ({ root }) => {
    const result = validateFixture(root, "ghost-module");
    expect(result.status).toBe("fail");
    expectSystemDiagnostic(result, codes.SYSTEM_FILTER_UNKNOWN, ".pals/system.yaml");
  });
});
