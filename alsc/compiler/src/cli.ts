#!/usr/bin/env bun

import { resolve } from "node:path";
import { deployClaudeSkills } from "./claude-skills.ts";
import {
  buildOperatorConfigSessionStartOutput,
  inspectOperatorConfigFile,
  resolveOperatorConfigPath,
} from "./operator-config.ts";
import { validateSystem } from "./validate.ts";

const MAIN_USAGE = `Usage:
  alsc validate <system-root> [module-id]
  alsc deploy claude [--dry-run] [--require-empty-targets] <system-root> [module-id]
  alsc operator-config path [system-root-or-cwd]
  alsc operator-config inspect [system-root-or-cwd-or-operator-config-path]
  alsc operator-config session-start [cwd]

Commands:
  validate        Validate an ALS system and emit JSON.
  deploy claude   Project active ALS Claude assets into .als/ and .claude/.
  operator-config Inspect the operator config or render SessionStart output.
`;

const VALIDATE_USAGE = "Usage: alsc validate <system-root> [module-id]";
const DEPLOY_USAGE = "Usage: alsc deploy claude [--dry-run] [--require-empty-targets] <system-root> [module-id]";
const OPERATOR_CONFIG_USAGE = `Usage:
  alsc operator-config path [system-root-or-cwd]
  alsc operator-config inspect [system-root-or-cwd-or-operator-config-path]
  alsc operator-config session-start [cwd]`;

export interface CliIo {
  stdout(value: string): void;
  stderr(value: string): void;
}

export function runCli(
  args: string[],
  io: CliIo = createProcessCliIo(),
): number {
  if (args.length === 0) {
    writeStderr(io, MAIN_USAGE);
    return 2;
  }

  if (isHelpFlag(args[0])) {
    writeStdout(io, MAIN_USAGE);
    return 0;
  }

  const [command, ...rest] = args;

  if (command === "validate") {
    return runValidateCommand(rest, io);
  }

  if (command === "deploy") {
    return runDeployCommand(rest, io);
  }

  if (command === "operator-config") {
    return runOperatorConfigCommand(rest, io);
  }

  writeStderr(io, MAIN_USAGE);
  return 2;
}

function runValidateCommand(args: string[], io: CliIo): number {
  if (args.length === 1 && isHelpFlag(args[0])) {
    writeStdout(io, `${VALIDATE_USAGE}\n`);
    return 0;
  }

  if (args.length < 1 || args.length > 2 || args.some((arg) => arg.startsWith("--"))) {
    writeStderr(io, `${VALIDATE_USAGE}\n`);
    return 2;
  }

  const systemRoot = resolve(args[0]);
  const moduleId = args[1];
  const result = validateSystem(systemRoot, moduleId);
  writeStdout(io, JSON.stringify(result, null, 2));
  return result.status === "fail" ? 1 : 0;
}

function runDeployCommand(args: string[], io: CliIo): number {
  if (args.length === 1 && isHelpFlag(args[0])) {
    writeStdout(io, `${DEPLOY_USAGE}\n`);
    return 0;
  }

  if (args.length === 0) {
    writeStderr(io, `${DEPLOY_USAGE}\n`);
    return 2;
  }

  const [target, ...rest] = args;
  if (target !== "claude") {
    writeStderr(io, `${DEPLOY_USAGE}\n`);
    return 2;
  }

  return runDeployClaudeCommand(rest, io);
}

function runOperatorConfigCommand(
  args: string[],
  io: CliIo,
): number {
  if (args.length === 0 || (args.length === 1 && isHelpFlag(args[0]))) {
    writeStdout(io, `${OPERATOR_CONFIG_USAGE}\n`);
    return args.length === 0 ? 2 : 0;
  }

  const [subcommand, ...rest] = args;

  if (subcommand === "path") {
    if (rest.length > 1) {
      writeStderr(io, `${OPERATOR_CONFIG_USAGE}\n`);
      return 2;
    }

    const filePath = resolveOperatorConfigPath(rest[0] ?? process.cwd());
    if (!filePath) {
      writeStderr(io, "Unable to resolve operator config path: no ALS system root found.\n");
      return 1;
    }

    writeStdout(io, filePath);
    return 0;
  }

  if (subcommand === "inspect") {
    if (rest.length > 1) {
      writeStderr(io, `${OPERATOR_CONFIG_USAGE}\n`);
      return 2;
    }

    const filePath = resolveOperatorConfigPath(rest[0] ?? process.cwd());
    if (!filePath) {
      writeStderr(io, "Unable to resolve operator config path: no ALS system root found.\n");
      return 1;
    }

    const inspection = inspectOperatorConfigFile(filePath);
    writeStdout(io, JSON.stringify(inspection, null, 2));
    return inspection.status === "fail" ? 1 : 0;
  }

  if (subcommand === "session-start") {
    if (rest.length > 1) {
      writeStderr(io, `${OPERATOR_CONFIG_USAGE}\n`);
      return 2;
    }

    const output = buildOperatorConfigSessionStartOutput(resolve(rest[0] ?? process.cwd()));
    if (output.length > 0) {
      writeStdout(io, output);
    }
    return 0;
  }

  writeStderr(io, `${OPERATOR_CONFIG_USAGE}\n`);
  return 2;
}

function runDeployClaudeCommand(args: string[], io: CliIo): number {
  if (args.length === 1 && isHelpFlag(args[0])) {
    writeStdout(io, `${DEPLOY_USAGE}\n`);
    return 0;
  }

  const positionals: string[] = [];
  let dryRun = false;
  let requireEmptyTargets = false;

  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--require-empty-targets") {
      requireEmptyTargets = true;
      continue;
    }

    if (arg.startsWith("--")) {
      writeStderr(io, `${DEPLOY_USAGE}\n`);
      return 2;
    }

    positionals.push(arg);
  }

  if (positionals.length < 1 || positionals.length > 2) {
    writeStderr(io, `${DEPLOY_USAGE}\n`);
    return 2;
  }

  const result = deployClaudeSkills(resolve(positionals[0]), {
    dry_run: dryRun,
    module_filter: positionals[1] ?? undefined,
    require_empty_targets: requireEmptyTargets,
  });
  writeStdout(io, JSON.stringify(result, null, 2));
  return result.status === "fail" ? 1 : 0;
}

function isHelpFlag(value: string): boolean {
  return value === "--help" || value === "-h";
}

function createProcessCliIo(): CliIo {
  return {
    stdout(value) {
      process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
    },
    stderr(value) {
      process.stderr.write(value.endsWith("\n") ? value : `${value}\n`);
    },
  };
}

function writeStdout(io: CliIo, value: string): void {
  io.stdout(value);
}

function writeStderr(io: CliIo, value: string): void {
  io.stderr(value);
}

if (import.meta.main) {
  process.exitCode = runCli(process.argv.slice(2));
}
