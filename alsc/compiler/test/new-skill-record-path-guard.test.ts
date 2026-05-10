import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type RecordPathFixture = {
  label: string;
  moduleBundlePath: string;
  moduleRecordRoot: string;
  entityExamplePath: string;
  exampleRecordPath: string;
};

type RecordPathFixtureSet = {
  accepted: RecordPathFixture[];
  rejected: RecordPathFixture[];
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturesPath = resolve(repoRoot, "skills/new/record-path-fixtures.json");
const skillPath = resolve(repoRoot, "skills/new/SKILL.md");

const fixtures = JSON.parse(readFileSync(fixturesPath, "utf-8")) as RecordPathFixtureSet;
const skillText = readFileSync(skillPath, "utf-8");

function normalizeSegments(input: string): string[] {
  return input
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");
}

function normalizePath(input: string): string {
  return normalizeSegments(input).join("/");
}

function composeRecordPath(moduleRecordRoot: string, entityExamplePath: string): string {
  return [...normalizeSegments(moduleRecordRoot), ...normalizeSegments(entityExamplePath)].join("/");
}

function hasAlsAncestor(input: string): boolean {
  return normalizeSegments(input).includes(".als");
}

test("ALS /new record-path fixtures compose example record paths from the mounted root", () => {
  for (const fixture of [...fixtures.accepted, ...fixtures.rejected]) {
    expect(normalizePath(fixture.moduleBundlePath).startsWith(".als/modules/")).toBe(true);
    expect(composeRecordPath(fixture.moduleRecordRoot, fixture.entityExamplePath)).toBe(
      normalizePath(fixture.exampleRecordPath),
    );
  }
});

test("ALS /new accepted record-path fixtures stay outside .als", () => {
  for (const fixture of fixtures.accepted) {
    expect(hasAlsAncestor(fixture.exampleRecordPath)).toBe(false);
  }
});

test("ALS /new rejected record-path fixtures fail closed when .als is an ancestor segment", () => {
  for (const fixture of fixtures.rejected) {
    expect(hasAlsAncestor(fixture.exampleRecordPath)).toBe(true);
  }
});

test("ALS /new skill text documents the three path concepts and the fail-closed guard", () => {
  expect(skillText).toContain("### Record placement guard");
  expect(skillText).toContain("Module bundle path: .als/modules/experiments/v1/");
  expect(skillText).toContain("Module record root: workspace/experiments");
  expect(skillText).toContain("If any normalized segment is exactly `.als`, fail closed.");
});
