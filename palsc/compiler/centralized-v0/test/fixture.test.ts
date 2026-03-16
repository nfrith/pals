import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { codes } from "../src/diagnostics.ts";
import { validateSystem } from "../src/validate.ts";

const fixtureRoot = resolve(process.cwd(), "../../../example-systems/centralized-metadata-happy-path");

test("centralized metadata fixture validates clean", () => {
  const result = validateSystem(fixtureRoot);
  expect(result.status).toBe("pass");
  expect(result.summary.error_count).toBe(0);
  expect(result.summary.modules_checked).toBe(3);
});

test("disallowed subheading inside a paragraph-only section fails", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "centralized-v0-"));
  await cp(fixtureRoot, tempRoot, { recursive: true });

  const storyPath = join(tempRoot, "workspace/backlog/stories/STORY-0001.md");
  const original = await readFile(storyPath, "utf-8");
  const updated = original.replace(
    "Module contracts must reduce ambiguity for orchestrator and module skills.",
    "Module contracts must reduce ambiguity for orchestrator and module skills.\n\n### Illegal Subheading\n\nThis should fail.",
  );
  await writeFile(storyPath, updated);

  const result = validateSystem(tempRoot);
  expect(result.status).toBe("fail");

  const backlogReport = result.modules.find((report) => report.module_id === "backlog");
  expect(backlogReport).toBeDefined();
  expect(
    backlogReport!.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === codes.BODY_CONSTRAINT_VIOLATION &&
        diagnostic.file.endsWith("STORY-0001.md"),
    ),
  ).toBe(true);
});
