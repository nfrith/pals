import type {
  ConstructActionDrainSignal,
  ConstructActionProcessLocator,
  ConstructActionStartContract,
} from "../../../compiler/src/construct-upgrade.ts";
import type { ConstructUpgradePrompt } from "../types.ts";

export type DispatcherLifecycleChoice = "drain" | "kill" | "cancel";

export function buildDispatcherLifecyclePrompt(input: {
  instance_id: string;
  display_name: string;
}): ConstructUpgradePrompt {
  return {
    key: `dispatcher-lifecycle:${input.instance_id}`,
    construct: "dispatcher",
    instance_id: input.instance_id,
    display_name: input.display_name,
    intent: "pick-construct-lifecycle",
    markdown: [
      `Dispatcher \`${input.display_name}\` must restart to complete the construct upgrade.`,
      "",
      "- `Drain` waits for in-flight dispatches to finish and then restarts.",
      "- `Kill` stops the dispatcher immediately and restarts it after commit.",
      "- `Cancel` aborts the whole `/update` transaction before execute begins.",
    ].join("\n"),
    options: [
      {
        value: "drain",
        label: "Drain",
        description: "Wait for in-flight work to finish before restart.",
      },
      {
        value: "kill",
        label: "Kill",
        description: "Stop the dispatcher immediately and restart after commit.",
      },
      {
        value: "cancel",
        label: "Cancel",
        description: "Abort the whole construct-upgrade transaction.",
      },
    ],
  };
}

export function emitDispatcherLifecycleAction(input: {
  instance_id: string;
  display_name: string;
  choice: DispatcherLifecycleChoice;
  start: ConstructActionStartContract;
  process_locator: ConstructActionProcessLocator;
  drain_signal: ConstructActionDrainSignal;
}) {
  if (input.choice === "cancel") {
    return null;
  }

  if (input.choice === "drain") {
    return {
      kind: "drain-then-restart" as const,
      construct: "dispatcher",
      instance_id: input.instance_id,
      display_name: input.display_name,
      start: input.start,
      process_locator: input.process_locator,
      drain_signal: input.drain_signal,
    };
  }

  return {
    kind: "kill-then-restart" as const,
    construct: "dispatcher",
    instance_id: input.instance_id,
    display_name: input.display_name,
    start: input.start,
    process_locator: input.process_locator,
  };
}
