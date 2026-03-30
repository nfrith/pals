#!/usr/bin/env bun

import { resolve } from "node:path";
import { deployClaudeSkills } from "./claude-skills.ts";
import { validateSystem } from "./validate.ts";

const MAIN_USAGE = `Usage:
  alsc validate <system-root> [module-id]
  alsc deploy claude [--dry-run] [--require-empty-targets] <system-root> [module-id]

Commands:
  validate        Validate an ALS system and emit JSON.
  deploy claude   Project active ALS skills into .claude/skills.
`;

const VALIDATE_USAGE = "Usage: alsc validate <system-root> [module-id]";
const DEPLOY_USAGE = "Usage: alsc deploy claude [--dry-run] [--require-empty-targets] <system-root> [module-id]";

export function runCli(args: string[]): number {
  if (args.length === 0) {
    printStderr(MAIN_USAGE);
    return 2;
  }

  if (isHelpFlag(args[0])) {
    printStdout(MAIN_USAGE);
    return 0;
  }

  const [command, ...rest] = args;

  if (command === "validate") {
    return runValidateCommand(rest);
  }

  if (command === "deploy") {
    return runDeployCommand(rest);
  }

  printStderr(MAIN_USAGE);
  return 2;
}

function runValidateCommand(args: string[]): number {
  if (args.length === 1 && isHelpFlag(args[0])) {
    printStdout(`${VALIDATE_USAGE}\n`);
    return 0;
  }

  if (args.length < 1 || args.length > 2 || args.some((arg) => arg.startsWith("--"))) {
    printStderr(`${VALIDATE_USAGE}\n`);
    return 2;
  }

  const systemRoot = resolve(args[0]);
  const moduleId = args[1];
  const result = validateSystem(systemRoot, moduleId);
  printStdout(JSON.stringify(result, null, 2));
  return result.status === "fail" ? 1 : 0;
}

function runDeployCommand(args: string[]): number {
  if (args.length === 1 && isHelpFlag(args[0])) {
    printStdout(`${DEPLOY_USAGE}\n`);
    return 0;
  }

  if (args.length === 0) {
    printStderr(`${DEPLOY_USAGE}\n`);
    return 2;
  }

  const [target, ...rest] = args;
  if (target !== "claude") {
    printStderr(`${DEPLOY_USAGE}\n`);
    return 2;
  }

  return runDeployClaudeCommand(rest);
}

function runDeployClaudeCommand(args: string[]): number {
  if (args.length === 1 && isHelpFlag(args[0])) {
    printStdout(`${DEPLOY_USAGE}\n`);
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
      printStderr(`${DEPLOY_USAGE}\n`);
      return 2;
    }

    positionals.push(arg);
  }

  if (positionals.length < 1 || positionals.length > 2) {
    printStderr(`${DEPLOY_USAGE}\n`);
    return 2;
  }

  const result = deployClaudeSkills(resolve(positionals[0]), {
    dry_run: dryRun,
    module_filter: positionals[1] ?? undefined,
    require_empty_targets: requireEmptyTargets,
  });
  printStdout(JSON.stringify(result, null, 2));
  return result.status === "fail" ? 1 : 0;
}

function isHelpFlag(value: string): boolean {
  return value === "--help" || value === "-h";
}

function printStdout(value: string): void {
  process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
}

function printStderr(value: string): void {
  process.stderr.write(value.endsWith("\n") ? value : `${value}\n`);
}

if (import.meta.main) {
  process.exit(runCli(process.argv.slice(2)));
}
