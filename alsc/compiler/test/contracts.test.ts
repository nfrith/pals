import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  COMPATIBILITY_CLASSES,
  COMPATIBILITY_CLASS_DEPRECATIONS,
  COMPATIBILITY_CLASS_METADATA,
  COMPATIBILITY_CLASS_RELEASE_HEADLINE_ORDER,
  findCompilerEnumValueDeprecation,
  highestCompatibilityClass,
  sortCompatibilityClassesByPrecedence,
} from "../src/contracts.ts";
import {
  acquireSyntheticDeprecationFixture,
  releaseSyntheticDeprecationFixture,
  SYNTHETIC_DEPRECATION_CONTRACT,
  SYNTHETIC_DEPRECATION_VALUES,
} from "./helpers/deprecation-fixture.ts";

beforeAll(() => {
  acquireSyntheticDeprecationFixture();
});

afterAll(() => {
  releaseSyntheticDeprecationFixture();
});

test("compatibility classes expose the canonical public contract", () => {
  expect(COMPATIBILITY_CLASSES).toEqual([
    "docs_only",
    "refresh_required",
    "additive",
    "migration_required",
    "breaking_without_path",
  ]);
  expect(COMPATIBILITY_CLASS_RELEASE_HEADLINE_ORDER).toEqual([
    "breaking_without_path",
    "migration_required",
    "refresh_required",
    "additive",
    "docs_only",
  ]);
  expect(COMPATIBILITY_CLASS_METADATA.refresh_required.operator_action_required).toBe(true);
  expect(COMPATIBILITY_CLASS_METADATA.additive.operator_action_required).toBe(false);
  expect(COMPATIBILITY_CLASS_METADATA.breaking_without_path.release_headline_precedence).toBe(0);
  expect(COMPATIBILITY_CLASS_METADATA.docs_only.release_headline_precedence).toBe(4);
});

test("compatibility precedence collapses lists to the most disruptive class", () => {
  expect(highestCompatibilityClass(["docs_only", "additive"])).toBe("additive");
  expect(highestCompatibilityClass(["additive", "refresh_required"])).toBe("refresh_required");
  expect(highestCompatibilityClass(["migration_required", "docs_only"])).toBe("migration_required");
  expect(highestCompatibilityClass([])).toBeNull();
  expect(sortCompatibilityClassesByPrecedence([
    "docs_only",
    "migration_required",
    "additive",
    "migration_required",
  ])).toEqual([
    "migration_required",
    "additive",
    "docs_only",
  ]);
});

test("compiler enum deprecations stay empty for live contracts and resolve for the synthetic fixture", () => {
  expect(COMPATIBILITY_CLASS_DEPRECATIONS).toEqual({});
  expect(findCompilerEnumValueDeprecation(COMPATIBILITY_CLASSES, "additive")).toBeNull();
  expect(findCompilerEnumValueDeprecation(SYNTHETIC_DEPRECATION_VALUES, "synthetic-supported")).toBeNull();
  expect(findCompilerEnumValueDeprecation(SYNTHETIC_DEPRECATION_VALUES, "synthetic-deprecated")).toEqual({
    contract: SYNTHETIC_DEPRECATION_CONTRACT,
    value: "synthetic-deprecated",
    since: "v1.4",
    removed_in: "v1.6",
    replacement: "synthetic-supported",
  });
});
