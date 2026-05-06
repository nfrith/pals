#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

interface TransientRuntimeRule {
  id: string;
  gitignore_pattern: string;
  matches(path: string): boolean;
}

export interface AppliedTransientRuntimeCleanup {
  tracked_paths: string[];
  added_patterns: string[];
  committed: boolean;
  commit_message: string | null;
}

export const TRANSIENT_RUNTIME_TAXONOMY: readonly TransientRuntimeRule[] = Object.freeze([
  {
    id: "dispatcher-runtime",
    gitignore_pattern: ".claude/delamains/*/runtime/",
    matches(path) {
      return /^\.claude\/delamains\/[^/]+\/runtime\/.+$/.test(path);
    },
  },
  {
    id: "dispatcher-status",
    gitignore_pattern: ".claude/delamains/*/status.json",
    matches(path) {
      return /^\.claude\/delamains\/[^/]+\/status\.json$/.test(path);
    },
  },
  {
    id: "pulse-cache",
    gitignore_pattern: ".claude/scripts/.cache/pulse/*.json",
    matches(path) {
      return /^\.claude\/scripts\/\.cache\/pulse\/[^/]+\.json$/.test(path);
    },
  },
  {
    id: "dispatcher-telemetry",
    gitignore_pattern: ".claude/delamains/*/telemetry/events.jsonl",
    matches(path) {
      return /^\.claude\/delamains\/[^/]+\/telemetry\/events\.jsonl$/.test(path);
    },
  },
  {
    id: "dispatcher-drain-control",
    gitignore_pattern: ".claude/delamains/*/dispatcher/control/drain-request.json",
    matches(path) {
      return /^\.claude\/delamains\/[^/]+\/dispatcher\/control\/drain-request\.json$/.test(path);
    },
  },
]);

export const TRANSIENT_RUNTIME_GITIGNORE_PATTERNS = Object.freeze(
  TRANSIENT_RUNTIME_TAXONOMY.map((rule) => rule.gitignore_pattern),
);

export function isTransientRuntimePath(path: string): boolean {
  const normalized = normalizeRepoPath(path);
  return TRANSIENT_RUNTIME_TAXONOMY.some((rule) => rule.matches(normalized));
}

export function listTrackedTransientRuntimePaths(repoRoot: string): string[] {
  return splitNullSeparated(runGit(repoRoot, ["ls-files", "-z", "--", ".claude"]).stdout)
    .map(normalizeRepoPath)
    .filter((path) => path.length > 0 && isTransientRuntimePath(path))
    .sort();
}

export function ensureTransientRuntimeGitignore(systemRoot: string): {
  changed: boolean;
  added_patterns: string[];
} {
  const gitignorePath = join(systemRoot, ".gitignore");
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";
  const lines = existing.split(/\r?\n/);
  const seen = new Set(lines.filter((line) => line.length > 0));
  const addedPatterns: string[] = [];
  let next = existing;

  for (const pattern of TRANSIENT_RUNTIME_GITIGNORE_PATTERNS) {
    if (seen.has(pattern)) {
      continue;
    }
    if (next.length > 0 && !next.endsWith("\n")) {
      next += "\n";
    }
    next += `${pattern}\n`;
    seen.add(pattern);
    addedPatterns.push(pattern);
  }

  if (addedPatterns.length > 0) {
    writeFileSync(gitignorePath, next, "utf-8");
  }

  return {
    changed: addedPatterns.length > 0,
    added_patterns: addedPatterns,
  };
}

export function applyTransientRuntimeCleanup(input: {
  system_root: string;
  commit_message: string;
}): AppliedTransientRuntimeCleanup {
  const systemRoot = canonicalizePath(resolve(input.system_root));
  const repoRoot = canonicalizePath(resolveGitRepoRoot(systemRoot));
  const trackedPaths = listTrackedTransientRuntimePaths(repoRoot);
  const gitignore = ensureTransientRuntimeGitignore(systemRoot);
  const relativeGitignorePath = relativeToRepoRoot(repoRoot, join(systemRoot, ".gitignore"));
  const commitPaths = [
    ...(gitignore.changed ? [relativeGitignorePath] : []),
    ...trackedPaths,
  ];
  if (commitPaths.length === 0) {
    return {
      tracked_paths: trackedPaths,
      added_patterns: gitignore.added_patterns,
      committed: false,
      commit_message: null,
    };
  }

  const tempIndexDir = mkdtempSync(join(tmpdir(), "als-transient-runtime-index-"));
  const tempIndexPath = join(tempIndexDir, "index");
  try {
    const env = {
      GIT_INDEX_FILE: tempIndexPath,
    };
    runGit(repoRoot, ["read-tree", "HEAD"], env);
    if (gitignore.changed) {
      runGit(repoRoot, ["add", "--", relativeGitignorePath], env);
    }
    if (trackedPaths.length > 0) {
      runGit(repoRoot, ["rm", "--cached", "--", ...trackedPaths], env);
    }
    const treeOid = runGit(repoRoot, ["write-tree"], env).stdout.trim();
    const commitOid = runGitWithInput(
      repoRoot,
      ["commit-tree", treeOid, "-p", "HEAD"],
      `${input.commit_message}\n`,
    ).stdout.trim();
    if (gitignore.changed) {
      runGit(repoRoot, ["add", "--", relativeGitignorePath]);
    }
    if (trackedPaths.length > 0) {
      runGit(repoRoot, ["rm", "--cached", "--", ...trackedPaths]);
    }
    runGit(repoRoot, ["merge", "--ff-only", commitOid]);
    return {
      tracked_paths: trackedPaths,
      added_patterns: gitignore.added_patterns,
      committed: true,
      commit_message: input.commit_message,
    };
  } finally {
    rmSync(tempIndexDir, { recursive: true, force: true });
  }
}

function relativeToRepoRoot(repoRoot: string, filePath: string): string {
  const relativePath = normalizeRepoPath(relative(repoRoot, filePath));
  if (relativePath.startsWith("../") || relativePath === "..") {
    throw new Error(`Path '${filePath}' is outside repo root '${repoRoot}'.`);
  }
  return relativePath;
}

function resolveGitRepoRoot(repoRoot: string): string {
  return runGit(repoRoot, ["rev-parse", "--show-toplevel"]).stdout.trim();
}

function canonicalizePath(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return resolve(filePath);
  }
}

function normalizeRepoPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

function splitNullSeparated(value: string): string[] {
  return value.split("\0").filter((entry) => entry.length > 0);
}

function runGit(
  repoRoot: string,
  args: string[],
  env: Record<string, string> = {},
): { status: number; stdout: string; stderr: string } {
  const result = runGitAllowFailure(repoRoot, args, env);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`);
  }
  return result;
}

function runGitWithInput(
  repoRoot: string,
  args: string[],
  stdin: string,
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    env: {
      ...process.env,
    },
    input: stdin,
    encoding: "utf-8",
  });
  const output = {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
  if (output.status !== 0) {
    throw new Error(output.stderr.trim() || output.stdout.trim() || `git ${args.join(" ")} failed`);
  }
  return output;
}

function runGitAllowFailure(
  repoRoot: string,
  args: string[],
  env: Record<string, string> = {},
): { status: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
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
  if (args[0] !== "cleanup") {
    console.error("Usage: transient-runtime.ts cleanup --system-root <path> --commit-message <message>");
    return 2;
  }

  const parsed = parseNamedArgs(args.slice(1), {
    "--system-root": true,
    "--commit-message": true,
  });
  if (!parsed["--system-root"] || !parsed["--commit-message"]) {
    console.error("Usage: transient-runtime.ts cleanup --system-root <path> --commit-message <message>");
    return 2;
  }

  const result = applyTransientRuntimeCleanup({
    system_root: parsed["--system-root"],
    commit_message: parsed["--commit-message"],
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
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
