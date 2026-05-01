import type {
  ConstructActionProcessLocator,
  ConstructActionStartContract,
} from "../../../compiler/src/construct-upgrade.ts";

export function emitProcessLifecycleAction(input: {
  construct: "statusline" | "dashboard";
  instance_id: string;
  display_name: string;
  is_running: boolean;
  start: ConstructActionStartContract;
  process_locator: ConstructActionProcessLocator;
}) {
  if (!input.is_running) {
    return {
      kind: "start-only" as const,
      construct: input.construct,
      instance_id: input.instance_id,
      display_name: input.display_name,
      start: input.start,
    };
  }

  return {
    kind: "kill-then-restart" as const,
    construct: input.construct,
    instance_id: input.instance_id,
    display_name: input.display_name,
    start: input.start,
    process_locator: input.process_locator,
  };
}
