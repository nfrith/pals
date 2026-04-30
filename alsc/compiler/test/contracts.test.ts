import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  COMPATIBILITY_CLASSES,
  COMPATIBILITY_CLASS_DEPRECATIONS,
  COMPATIBILITY_CLASS_METADATA,
  COMPATIBILITY_CLASS_RELEASE_HEADLINE_ORDER,
  findCompilerEnumValueDeprecation,
  highestCompatibilityClass,
  LANGUAGE_UPGRADE_CHECK_NAMES,
  LANGUAGE_UPGRADE_OPERATOR_PROMPT_INTENTS,
  LANGUAGE_UPGRADE_RECIPE_CATEGORIES,
  LANGUAGE_UPGRADE_RECIPE_CATEGORY_METADATA,
  LANGUAGE_UPGRADE_RECIPE_INSPECTION_SCHEMA_LITERAL,
  LANGUAGE_UPGRADE_RECIPE_SCHEMA_LITERAL,
  LANGUAGE_UPGRADE_RECIPE_STEP_TYPES,
  LANGUAGE_UPGRADE_RECIPE_TRIGGERS,
  LANGUAGE_UPGRADE_RECIPE_VERIFICATION_SCHEMA_LITERAL,
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

test("language-upgrade-recipe literals expose the canonical public contract", () => {
  expect(LANGUAGE_UPGRADE_RECIPE_SCHEMA_LITERAL).toBe("als-language-upgrade-recipe@1");
  expect(LANGUAGE_UPGRADE_RECIPE_INSPECTION_SCHEMA_LITERAL).toBe("als-language-upgrade-recipe-inspection@1");
  expect(LANGUAGE_UPGRADE_RECIPE_VERIFICATION_SCHEMA_LITERAL).toBe("als-language-upgrade-recipe-verification@1");
  expect(LANGUAGE_UPGRADE_RECIPE_STEP_TYPES).toEqual([
    "script",
    "agent-task",
    "gate",
    "operator-prompt",
  ]);
  expect(LANGUAGE_UPGRADE_RECIPE_CATEGORIES).toEqual([
    "must-run",
    "recommended",
    "optional",
    "recovery",
  ]);
  expect(LANGUAGE_UPGRADE_RECIPE_TRIGGERS).toEqual([
    "auto",
    "manual",
    "on-error",
  ]);
  expect(LANGUAGE_UPGRADE_OPERATOR_PROMPT_INTENTS).toEqual([
    "confirm-live-apply",
    "acknowledge-future-obligation",
    "operator-owned-data-choice",
  ]);
  expect(LANGUAGE_UPGRADE_CHECK_NAMES).toEqual([
    "als-version-matches-from",
    "als-version-matches-to",
    "validates-as-from-version",
    "validates-as-to-version",
  ]);
  expect(LANGUAGE_UPGRADE_RECIPE_CATEGORY_METADATA["must-run"].default_trigger).toBe("auto");
  expect(LANGUAGE_UPGRADE_RECIPE_CATEGORY_METADATA.optional.default_trigger).toBe("manual");
  expect(LANGUAGE_UPGRADE_RECIPE_CATEGORY_METADATA.recovery.default_trigger).toBe("on-error");
});
