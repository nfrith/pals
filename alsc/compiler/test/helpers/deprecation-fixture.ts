import {
  registerCompilerEnumDeprecationContract,
  unregisterCompilerEnumDeprecationContract,
} from "../../src/contracts.ts";

export const SYNTHETIC_DEPRECATION_CONTRACT = "synthetic_deprecation_fixture";
export const SYNTHETIC_DEPRECATION_VALUES = [
  "synthetic-supported",
  "synthetic-deprecated",
] as const;
const SYNTHETIC_DEPRECATION_FIXTURES_ENV = "ALS_COMPILER_ENUM_DEPRECATION_FIXTURES_JSON";

const SYNTHETIC_DEPRECATIONS = {
  "synthetic-deprecated": {
    since: "v1.4",
    removed_in: "v1.6",
    replacement: "synthetic-supported",
  },
} as const;

let syntheticFixtureRefs = 0;

export function acquireSyntheticDeprecationFixture(): void {
  if (syntheticFixtureRefs === 0) {
    registerCompilerEnumDeprecationContract(SYNTHETIC_DEPRECATION_CONTRACT, {
      values: SYNTHETIC_DEPRECATION_VALUES,
      deprecations: SYNTHETIC_DEPRECATIONS,
    });
  }

  syntheticFixtureRefs += 1;
}

export function releaseSyntheticDeprecationFixture(): void {
  if (syntheticFixtureRefs === 0) {
    throw new Error("Synthetic deprecation fixture was released without a matching acquire");
  }

  syntheticFixtureRefs -= 1;
  if (syntheticFixtureRefs === 0) {
    unregisterCompilerEnumDeprecationContract(SYNTHETIC_DEPRECATION_CONTRACT);
  }
}

export function syntheticDeprecationFixtureEnv(): Record<string, string> {
  return {
    [SYNTHETIC_DEPRECATION_FIXTURES_ENV]: JSON.stringify({
      [SYNTHETIC_DEPRECATION_CONTRACT]: {
        values: [...SYNTHETIC_DEPRECATION_VALUES],
        deprecations: SYNTHETIC_DEPRECATIONS,
      },
    }),
  };
}
