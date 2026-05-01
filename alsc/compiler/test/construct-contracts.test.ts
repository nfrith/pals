import { expect, test } from "bun:test";
import {
  CONSTRUCT_ACTION_KINDS,
  CONSTRUCT_ACTION_MANIFEST_SCHEMA_LITERAL,
  CONSTRUCT_DRAIN_SIGNAL_KINDS,
  CONSTRUCT_FAILURE_STATES,
  CONSTRUCT_LIFECYCLE_STRATEGIES,
  CONSTRUCT_MANIFEST_SCHEMA_LITERAL,
  CONSTRUCT_MIGRATION_STRATEGIES,
  CONSTRUCT_OPERATOR_PROMPT_INTENTS,
  CONSTRUCT_PROCESS_LOCATOR_KINDS,
  CONSTRUCT_RUNTIME_PATH_PLACEHOLDERS,
  CONSTRUCT_SOURCE_PATH_OWNERS,
} from "../src/construct-contracts.ts";

test("construct-upgrade literals expose the canonical public contract", () => {
  expect(CONSTRUCT_MANIFEST_SCHEMA_LITERAL).toBe("als-construct-manifest@1");
  expect(CONSTRUCT_ACTION_MANIFEST_SCHEMA_LITERAL).toBe("als-construct-action-manifest@1");
  expect(CONSTRUCT_MIGRATION_STRATEGIES).toEqual(["sequential"]);
  expect(CONSTRUCT_LIFECYCLE_STRATEGIES).toEqual([
    "dispatcher-lifecycle",
    "process-lifecycle",
    "none",
  ]);
  expect(CONSTRUCT_OPERATOR_PROMPT_INTENTS).toEqual([
    "pick-construct-lifecycle",
    "confirm-construct-overwrite",
  ]);
  expect(CONSTRUCT_ACTION_KINDS).toEqual([
    "drain-then-restart",
    "kill-then-restart",
    "start-only",
  ]);
  expect(CONSTRUCT_FAILURE_STATES).toEqual([
    "lifecycle-drain-stalled",
    "lifecycle-stop-failed",
    "lifecycle-start-failed",
    "lifecycle-partial",
  ]);
  expect(CONSTRUCT_PROCESS_LOCATOR_KINDS).toEqual([
    "json-file-pid",
    "argv-substring",
  ]);
  expect(CONSTRUCT_DRAIN_SIGNAL_KINDS).toEqual(["json-file-write"]);
  expect(CONSTRUCT_SOURCE_PATH_OWNERS).toEqual(["vendor", "operator"]);
  expect(CONSTRUCT_RUNTIME_PATH_PLACEHOLDERS).toEqual([
    "$ALS_SYSTEM_ROOT",
    "$CLAUDE_PLUGIN_ROOT",
  ]);
});
