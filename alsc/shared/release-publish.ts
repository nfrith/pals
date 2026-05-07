#!/usr/bin/env bun

import { realpathSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_REMOTE_NAME = "origin";
const USAGE =
  "Usage: release-publish.ts publish --repo-root <path> --source-ref <ref> --destination-branch <branch> [--remote <remote>]";

export interface ReleasePublishInput {
  repo_root: string;
  source_ref: string;
  destination_branch: string;
  remote_name?: string;
}

export interface ReleasePublishResult {
  repo_root: string;
  remote_name: string;
  source_ref: string;
  pushed_commit: string;
  destination_branch: string;
  destination_ref: string;
}

export function publishReleaseRef(input: ReleasePublishInput): ReleasePublishResult {
  const repoRoot = canonicalizePath(resolve(input.repo_root));
  const sourceRef = input.source_ref.trim();
  if (sourceRef.length === 0) {
    throw new Error("release-publish requires a non-empty source_ref.");
  }

  const remoteName = (input.remote_name ?? DEFAULT_REMOTE_NAME).trim();
  if (remoteName.length === 0) {
    throw new Error("release-publish requires a non-empty remote_name.");
  }

  const destinationBranch = normalizeDestinationBranch(repoRoot, input.destination_branch);
  const pushedCommit = runGit(repoRoot, ["rev-parse", "--verify", `${sourceRef}^{commit}`]).stdout.trim();
  const destinationRef = `refs/heads/${destinationBranch}`;

  runGit(repoRoot, ["push", remoteName, `${pushedCommit}:${destinationRef}`]);

  return {
    repo_root: repoRoot,
    remote_name: remoteName,
    source_ref: sourceRef,
    pushed_commit: pushedCommit,
    destination_branch: destinationBranch,
    destination_ref: destinationRef,
  };
}

function normalizeDestinationBranch(repoRoot: string, destinationBranch: string): string {
  const trimmed = destinationBranch.trim();
  if (trimmed.length === 0) {
    throw new Error("release-publish requires a non-empty destination_branch.");
  }
  if (trimmed.startsWith("refs/")) {
    throw new Error("destination_branch must be a branch name like 'main', not a full ref.");
  }
  if (trimmed.includes(":")) {
    throw new Error("destination_branch may not contain ':'.");
  }

  const result = runGitAllowFailure(repoRoot, ["check-ref-format", "--branch", trimmed]);
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || result.stdout.trim() || `Invalid destination branch '${trimmed}'.`,
    );
  }

  const normalized = result.stdout.trim();
  return normalized.length > 0 ? normalized : trimmed;
}

function canonicalizePath(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return resolve(filePath);
  }
}

function runGit(
  repoRoot: string,
  args: string[],
): { status: number; stdout: string; stderr: string } {
  const result = runGitAllowFailure(repoRoot, args);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`);
  }
  return result;
}

function runGitAllowFailure(
  repoRoot: string,
  args: string[],
): { status: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd: repoRoot,
    env: {
      ...process.env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    status: result.exitCode,
    stdout: Buffer.from(result.stdout).toString("utf-8"),
    stderr: Buffer.from(result.stderr).toString("utf-8"),
  };
}

async function main(args: string[]): Promise<number> {
  if (args[0] !== "publish") {
    console.error(USAGE);
    return 2;
  }

  let parsed: Record<string, string>;
  try {
    parsed = parseNamedArgs(args.slice(1), {
      "--repo-root": true,
      "--source-ref": true,
      "--destination-branch": true,
      "--remote": true,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    return 2;
  }

  if (!parsed["--repo-root"] || !parsed["--source-ref"] || !parsed["--destination-branch"]) {
    console.error(USAGE);
    return 2;
  }

  try {
    const result = publishReleaseRef({
      repo_root: parsed["--repo-root"],
      source_ref: parsed["--source-ref"],
      destination_branch: parsed["--destination-branch"],
      remote_name: parsed["--remote"],
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function parseNamedArgs(
  args: string[],
  allowed: Record<string, true>,
): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith("--") || !allowed[key]) {
      throw new Error(`Unknown argument '${key ?? "<missing>"}'.`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Argument '${key}' requires a value.`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

if (import.meta.main) {
  const exitCode = await main(process.argv.slice(2));
  process.exit(exitCode);
}
