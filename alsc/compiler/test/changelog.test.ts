import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CHANGELOG_POINTER_LINE,
  inspectChangelogFile,
  inspectChangelogSource,
  resolveChangelogPath,
} from "../src/changelog.ts";

const VALID_CHANGELOG = `# Changelog

${CHANGELOG_POINTER_LINE}

## [Unreleased]

### ALS-058
- Compatibility: refresh_required, additive
- Summary: Adds typed compatibility classes and changelog validation.
- Operator action: Run /update after the next release if you need the new projected assets.
- Affected surfaces: alsc compiler, als-factory jobs, release tooling

## 0.1.0-beta.1 - 2026-04-29

### ALS-001
- Compatibility: docs_only
- Summary: Published the preview documentation baseline.
- Operator action: None.
- Affected surfaces: docs
`;

test("inspectChangelogSource accepts the structured changelog contract", () => {
  const inspection = inspectChangelogSource(VALID_CHANGELOG, "/tmp/CHANGELOG.md");

  expect(inspection.status).toBe("pass");
  expect(inspection.errors).toEqual([]);
  expect(inspection.total_entry_count).toBe(2);
  expect(inspection.sections).toHaveLength(2);
  expect(inspection.sections[0]?.kind).toBe("unreleased");
  expect(inspection.sections[0]?.headline_class).toBe("refresh_required");
  expect(inspection.sections[1]?.kind).toBe("release");
  expect(inspection.sections[1]?.headline_class).toBe("docs_only");
});

test("inspectChangelogSource rejects malformed compatibility fields", () => {
  const source = VALID_CHANGELOG.replace(
    "- Compatibility: refresh_required, additive",
    "- Compatibility: refresh_required, made_up_class, refresh_required",
  );
  const inspection = inspectChangelogSource(source, "/tmp/CHANGELOG.md");

  expect(inspection.status).toBe("fail");
  expect(inspection.errors.some((error) => error.code === "changelog.entry.compatibility.invalid")).toBe(true);
  expect(inspection.errors.some((error) => error.code === "changelog.entry.compatibility.duplicate")).toBe(true);
});

test("inspectChangelogSource rejects missing required entry fields", () => {
  const source = VALID_CHANGELOG.replace(
    "- Operator action: Run /update after the next release if you need the new projected assets.\n",
    "",
  );
  const inspection = inspectChangelogSource(source, "/tmp/CHANGELOG.md");

  expect(inspection.status).toBe("fail");
  expect(inspection.errors.some((error) => error.code === "changelog.entry.field_missing")).toBe(true);
});

test("resolveChangelogPath resolves repo roots and direct changelog paths", async () => {
  await withTempDir("changelog-path-resolution", async (root) => {
    const repoRoot = join(root, "als-repo");
    await mkdir(repoRoot, { recursive: true });

    expect(resolveChangelogPath(repoRoot)).toBe(join(repoRoot, "CHANGELOG.md"));
    expect(resolveChangelogPath(join(repoRoot, "CHANGELOG.md"))).toBe(join(repoRoot, "CHANGELOG.md"));
  });
});

test("inspectChangelogFile reports missing changelog files", async () => {
  await withTempDir("changelog-file-missing", async (root) => {
    const repoRoot = join(root, "als-repo");
    await mkdir(repoRoot, { recursive: true });

    const inspection = inspectChangelogFile(repoRoot);
    expect(inspection.status).toBe("missing");
    expect(inspection.exists).toBe(false);
    expect(inspection.file_path).toBe(join(repoRoot, "CHANGELOG.md"));
  });
});

test("inspectChangelogFile reads and validates changelog files from repo roots", async () => {
  await withTempDir("changelog-file-pass", async (root) => {
    const repoRoot = join(root, "als-repo");
    await mkdir(repoRoot, { recursive: true });
    await writeFile(join(repoRoot, "CHANGELOG.md"), VALID_CHANGELOG);

    const inspection = inspectChangelogFile(repoRoot);
    expect(inspection.status).toBe("pass");
    expect(inspection.total_entry_count).toBe(2);
  });
});

async function withTempDir(label: string, run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `${label}-`));
  let runError: unknown = null;

  try {
    await run(root);
  } catch (error) {
    runError = error;
  }

  await rm(root, { recursive: true, force: true });

  if (runError) {
    throw runError;
  }
}
