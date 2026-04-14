import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadAuthoredSourceExport } from "../src/authored-load.ts";
import { codes, reasons } from "../src/diagnostics.ts";

async function withAuthoredSourceFile(
  label: string,
  source: string,
  run: (filePath: string) => Promise<void> | void,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `als-authored-load-${label}-`));
  const filePath = join(root, "module.ts");

  try {
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

test("loadAuthoredSourceExport reports missing named and default exports", async () => {
  await withAuthoredSourceFile(
    "missing-export",
    `export const wrong = { ok: true } as const;\n`,
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
    await withAuthoredSourceFile(unsupportedCase.name, unsupportedCase.source, (filePath) => {
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
