import { basename, join } from "node:path";

export interface SequentialMigrationValidationIssue {
  code: string;
  path: string;
  message: string;
  expected: unknown;
  actual: unknown;
}

export interface SequentialMigrationValidationStep {
  from_version: number;
  to_version: number;
  script_path: string;
}

export const SEQUENTIAL_MIGRATION_STEP_PATTERN = /^v([1-9][0-9]*)-to-v([1-9][0-9]*)\.(?:c|m)?(?:j|t)s$/;

// SDR 040 is the canonical contract for sequential migration files. The compiler
// and runtime engine both import this module so filename and chain rules stay aligned.
export function parseSequentialMigrationDirectoryEntries(input: {
  entries: readonly string[];
  migrations_dir: string;
  path_root?: string;
}): {
  steps: SequentialMigrationValidationStep[];
  issues: SequentialMigrationValidationIssue[];
} {
  const pathRoot = input.path_root ?? "migrations_dir";
  const issues: SequentialMigrationValidationIssue[] = [];
  const steps: SequentialMigrationValidationStep[] = [];

  for (const entry of [...input.entries].sort()) {
    if (entry === ".gitkeep") {
      continue;
    }

    const match = entry.match(SEQUENTIAL_MIGRATION_STEP_PATTERN);
    if (!match) {
      issues.push(buildIssue(
        "construct_manifest.migrations.malformed_name",
        `${pathRoot}/${entry}`,
        `Sequential migrations entries must match 'vN-to-vM.{ts,js,cts,mts,cjs,mjs}' or be the literal '.gitkeep'; found '${entry}'.`,
        "canonical migration filename or literal .gitkeep",
        entry,
      ));
      continue;
    }

    steps.push({
      from_version: Number(match[1]),
      to_version: Number(match[2]),
      script_path: join(input.migrations_dir, entry),
    });
  }

  return { steps, issues };
}

export function validateSequentialMigrationContract(input: {
  steps: readonly SequentialMigrationValidationStep[];
  target_version: number;
  path_root?: string;
}): SequentialMigrationValidationIssue[] {
  const pathRoot = input.path_root ?? "migrations_dir";
  const orderedSteps = [...input.steps].sort(compareSequentialMigrationSteps);
  const issues: SequentialMigrationValidationIssue[] = [];

  if (orderedSteps.length === 0) {
    if (input.target_version > 1) {
      issues.push(buildIssue(
        "construct_manifest.migrations.empty_with_nontrivial_version",
        pathRoot,
        `Construct version ${input.target_version} requires at least one sequential migration step; empty migrations directories are only valid for version 1.`,
        "non-empty migrations directory when version > 1",
        input.target_version,
      ));
    }
    return issues;
  }

  const stepsByHop = new Map<string, SequentialMigrationValidationStep[]>();
  for (const step of orderedSteps) {
    if (step.to_version !== step.from_version + 1) {
      issues.push(buildIssue(
        "construct_manifest.migrations.multi_hop_forbidden",
        pathRoot,
        `Sequential migration '${basename(step.script_path)}' must move exactly one version at a time.`,
        `v${step.from_version}-to-v${step.from_version + 1}`,
        `v${step.from_version}-to-v${step.to_version}`,
      ));
    }

    const key = sequentialHopKey(step);
    const existing = stepsByHop.get(key);
    if (existing) {
      existing.push(step);
    } else {
      stepsByHop.set(key, [step]);
    }
  }

  for (const [key, group] of stepsByHop.entries()) {
    if (group.length > 1) {
      issues.push(buildIssue(
        "construct_manifest.migrations.duplicate",
        pathRoot,
        `Sequential migration hop '${key}' must be declared exactly once. Found ${group.map((step) => `'${basename(step.script_path)}'`).join(", ")}.`,
        `single file for ${key}`,
        group.map((step) => basename(step.script_path)),
      ));
    }
  }

  const uniqueSingleHopSteps = orderedSteps.filter((step, index, all) => {
    if (step.to_version !== step.from_version + 1) {
      return false;
    }

    const firstIndex = all.findIndex((candidate) => sequentialHopKey(candidate) === sequentialHopKey(step));
    return firstIndex === index;
  });

  for (let index = 1; index < uniqueSingleHopSteps.length; index += 1) {
    const previous = uniqueSingleHopSteps[index - 1]!;
    const current = uniqueSingleHopSteps[index]!;
    if (previous.to_version !== current.from_version) {
      const missingStep = `v${previous.to_version}-to-v${previous.to_version + 1}.ts`;
      issues.push(buildIssue(
        "construct_manifest.migrations.gap",
        pathRoot,
        `Sequential migration chain has a gap. Missing at least '${missingStep}' between '${basename(previous.script_path)}' and '${basename(current.script_path)}'.`,
        `next migration starting at v${previous.to_version}`,
        basename(current.script_path),
      ));
    }
  }

  const highestTargetVersion = Math.max(...orderedSteps.map((step) => step.to_version));
  if (highestTargetVersion !== input.target_version) {
    issues.push(buildIssue(
      "construct_manifest.migrations.chain_end_mismatch",
      pathRoot,
      `Sequential migration chain must end at construct version ${input.target_version}, but the highest migration target is ${highestTargetVersion}.`,
      input.target_version,
      highestTargetVersion,
    ));
  }

  return issues;
}

export function inspectSequentialMigrationDirectoryEntries(input: {
  entries: readonly string[];
  migrations_dir: string;
  target_version: number;
  path_root?: string;
}): {
  steps: SequentialMigrationValidationStep[];
  issues: SequentialMigrationValidationIssue[];
} {
  const parsed = parseSequentialMigrationDirectoryEntries(input);
  return {
    steps: parsed.steps,
    issues: [
      ...parsed.issues,
      ...validateSequentialMigrationContract({
        steps: parsed.steps,
        target_version: input.target_version,
        path_root: input.path_root,
      }),
    ],
  };
}

function sequentialHopKey(step: SequentialMigrationValidationStep): string {
  return `v${step.from_version}-to-v${step.to_version}`;
}

function compareSequentialMigrationSteps(
  left: SequentialMigrationValidationStep,
  right: SequentialMigrationValidationStep,
): number {
  return left.from_version - right.from_version
    || left.to_version - right.to_version
    || left.script_path.localeCompare(right.script_path);
}

function buildIssue(
  code: string,
  path: string,
  message: string,
  expected: unknown,
  actual: unknown,
): SequentialMigrationValidationIssue {
  return {
    code,
    path,
    message,
    expected,
    actual,
  };
}
