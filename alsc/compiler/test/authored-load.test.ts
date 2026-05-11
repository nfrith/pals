import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { loadAuthoredSourceExport } from "../src/authored-load.ts";
import { codes, reasons } from "../src/diagnostics.ts";

async function withAuthoredSourceFile(
  label: string,
  source: string,
  relativePath: string,
  run: (filePath: string) => Promise<void> | void,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `als-authored-load-${label}-`));
  const filePath = join(root, relativePath);

  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, source);
    await run(filePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("loadAuthoredSourceExport accepts default-only authored exports", async () => {
  await withAuthoredSourceFile(
    "default-export",
    `const authored = { module_id: "backlog", values: ["draft", "active"] } as const;\nexport default authored;\n`,
    "module.ts",
    (filePath) => {
      const result = loadAuthoredSourceExport(filePath, "module", "module_shape", codes.SHAPE_INVALID, "backlog");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          module_id: "backlog",
          values: ["draft", "active"],
        });
      }
    },
  );
});

test("loadAuthoredSourceExport accepts ALS-reserved authoring imports outside the plugin tree", async () => {
  await withAuthoredSourceFile(
    "reserved-imports",
    `import { defineModule } from "als:authoring";\nimport { COMPATIBILITY_CLASSES } from "als:contracts";\n\nexport const module = defineModule({\n  values: [...COMPATIBILITY_CLASSES]\n} as const);\n`,
    "module.ts",
    (filePath) => {
      const result = loadAuthoredSourceExport(filePath, "module", "module_shape", codes.SHAPE_INVALID, "backlog");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          values: [
            "docs_only",
            "refresh_required",
            "additive",
            "migration_required",
            "breaking_without_path",
          ],
        });
      }
    },
  );
});

test("loadAuthoredSourceExport reports missing named and default exports", async () => {
  await withAuthoredSourceFile(
    "missing-export",
    `export const wrong = { ok: true } as const;\n`,
    "module.ts",
    (filePath) => {
      const result = loadAuthoredSourceExport(filePath, "module", "module_shape", codes.SHAPE_INVALID, "backlog");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.reason).toBe(reasons.AUTHORED_SOURCE_EXPORT_MISSING);
        expect(result.diagnostics[0]?.message).toContain("must export 'module' or a default export");
        expect(result.diagnostics[0]?.actual).toEqual(["wrong"]);
      }
    },
  );
});

test("loadAuthoredSourceExport rejects value imports outside ALS authoring surfaces", async () => {
  await withAuthoredSourceFile(
    "unsupported-import",
    `import { join } from "node:path";\n\nexport const module = { value: join("a", "b") };\n`,
    "module.ts",
    (filePath) => {
      const result = loadAuthoredSourceExport(filePath, "module", "module_shape", codes.SHAPE_INVALID, "backlog");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.reason).toBe(reasons.AUTHORED_SOURCE_IMPORT_UNSUPPORTED);
        expect(result.diagnostics[0]?.message).toContain("may only import value symbols");
        expect(result.diagnostics[0]?.actual).toBe("node:path");
      }
    },
  );
});

for (const unsupportedCase of [
  {
    name: "functions",
    field: "handler",
    messageFragment: "must not contain functions",
    source: `export const module = { handler() { return "nope"; } };\n`,
  },
  {
    name: "getters",
    field: "lazy",
    messageFragment: "must not use getters or setters",
    source: `const authored: Record<string, unknown> = {};\nObject.defineProperty(authored, "lazy", { enumerable: true, get() { return "nope"; } });\nexport const module = authored;\n`,
  },
  {
    name: "undefined",
    field: "missing",
    messageFragment: "omit keys instead of using undefined",
    source: `export const module = { missing: undefined };\n`,
  },
  {
    name: "nan",
    field: "value",
    messageFragment: "must not contain NaN or Infinity",
    source: `export const module = { value: Number.NaN };\n`,
  },
  {
    name: "infinity",
    field: "value",
    messageFragment: "must not contain NaN or Infinity",
    source: `export const module = { value: Number.POSITIVE_INFINITY };\n`,
  },
  {
    name: "symbol",
    field: "marker",
    messageFragment: "must not contain symbol",
    source: `export const module = { marker: Symbol("x") };\n`,
  },
  {
    name: "bigint",
    field: "marker",
    messageFragment: "must not contain bigint",
    source: `export const module = { marker: 1n };\n`,
  },
  {
    name: "class instances",
    field: "custom",
    messageFragment: "must be plain objects, arrays, or primitives",
    source: `class Bucket { value = 1; }\nexport const module = { custom: new Bucket() };\n`,
  },
]) {
  test(`loadAuthoredSourceExport rejects authored ${unsupportedCase.name}`, async () => {
    await withAuthoredSourceFile(unsupportedCase.name, unsupportedCase.source, "module.ts", (filePath) => {
      const result = loadAuthoredSourceExport(filePath, "module", "module_shape", codes.SHAPE_INVALID, "backlog");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.reason).toBe(reasons.AUTHORED_SOURCE_VALUE_UNSUPPORTED);
        expect(result.diagnostics[0]?.field).toBe(unsupportedCase.field);
        expect(result.diagnostics[0]?.message).toContain(unsupportedCase.messageFragment);
      }
    });
  });
}

test("loadAuthoredSourceExport accepts operator roster entrypoints", async () => {
  await withAuthoredSourceFile(
    "operator-roster",
    `import { defineOperatorRoster } from "als:authoring";\n\nexport const operatorRoster = defineOperatorRoster({\n  operator_paths: ["./operators/nick-frith.ts"]\n} as const);\n`,
    ".als/operator-roster.ts",
    (filePath) => {
      const result = loadAuthoredSourceExport(filePath, "operatorRoster", "operator_roster", codes.SHAPE_INVALID, null);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          operator_paths: ["./operators/nick-frith.ts"],
        });
      }
    },
  );
});

test("loadAuthoredSourceExport accepts operator entrypoints", async () => {
  await withAuthoredSourceFile(
    "operator",
    `import { defineOperator } from "../authoring.ts";\n\nexport const operator = defineOperator({\n  id: "nick-frith",\n  first_name: "Nick",\n  last_name: "Frith",\n  display_name: "0xnfrith",\n  primary_email: "nick@example.com",\n  role: "Founder",\n  profiles: ["edgerunner"],\n  owns_company: false,\n  company_name: null,\n  company_type: null,\n  company_type_other: null,\n  revenue_band: null\n} as const);\n`,
    ".als/operators/nick-frith.ts",
    (filePath) => {
      const result = loadAuthoredSourceExport(filePath, "operator", "operator_profile", codes.SHAPE_INVALID, null);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
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
        });
      }
    },
  );
});
