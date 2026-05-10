export const HARNESS_TARGETS = ["claude", "codex"] as const;

export type HarnessTarget = typeof HARNESS_TARGETS[number];
export type HarnessUpdateConstruct = "dispatcher" | "statusline" | "dashboard";

export type HarnessUpdateConstructSupport =
  | {
    status: "managed";
    required_for_feature_parity: boolean;
  }
  | {
    status: "skipped";
    required_for_feature_parity: boolean;
    reason: string;
  };

export interface HarnessRuntimeSpec {
  target: HarnessTarget;
  display_name: string;
  generated_skill_root: string;
  delamain_runtime_root: string;
  delamain_roots_file: string;
  system_instruction_path: string;
  transaction_roots: readonly string[];
  update_constructs: Record<HarnessUpdateConstruct, HarnessUpdateConstructSupport>;
  statusline_cache_root: string | null;
}

export const HARNESS_RUNTIME_SPECS: Record<HarnessTarget, HarnessRuntimeSpec> = Object.freeze({
  claude: {
    target: "claude",
    display_name: "Claude",
    generated_skill_root: ".claude/skills",
    delamain_runtime_root: ".claude/delamains",
    delamain_roots_file: ".claude/delamain-roots",
    system_instruction_path: ".als/CLAUDE.md",
    transaction_roots: [".als", ".claude"],
    update_constructs: {
      dispatcher: {
        status: "managed",
        required_for_feature_parity: true,
      },
      statusline: {
        status: "managed",
        required_for_feature_parity: false,
      },
      dashboard: {
        status: "managed",
        required_for_feature_parity: true,
      },
    },
    statusline_cache_root: ".claude/scripts/.cache/pulse",
  },
  codex: {
    target: "codex",
    display_name: "Codex",
    generated_skill_root: ".agents/skills",
    delamain_runtime_root: ".codex/delamains",
    delamain_roots_file: ".codex/delamain-roots",
    system_instruction_path: ".als/AGENTS.md",
    transaction_roots: [".als", ".agents", ".codex"],
    update_constructs: {
      dispatcher: {
        status: "managed",
        required_for_feature_parity: true,
      },
      statusline: {
        status: "skipped",
        required_for_feature_parity: false,
        reason: "Codex does not have a registered ALS statusline face.",
      },
      dashboard: {
        status: "managed",
        required_for_feature_parity: true,
      },
    },
    statusline_cache_root: null,
  },
});

export function isHarnessTarget(value: unknown): value is HarnessTarget {
  return typeof value === "string" && (HARNESS_TARGETS as readonly string[]).includes(value);
}

export function parseHarnessTarget(value: string): HarnessTarget | null {
  return isHarnessTarget(value) ? value : null;
}

export function getHarnessRuntimeSpec(target: HarnessTarget): HarnessRuntimeSpec {
  return HARNESS_RUNTIME_SPECS[target];
}

export function listHarnessRuntimeSpecs(): HarnessRuntimeSpec[] {
  return HARNESS_TARGETS.map((target) => HARNESS_RUNTIME_SPECS[target]);
}

export function formatHarnessTargetList(): string {
  return HARNESS_TARGETS.join("|");
}
