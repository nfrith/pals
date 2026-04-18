import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import { homedir } from "os";
import { dirname, join, relative, resolve } from "path";
import { gitCurrentBranch, gitHasChanges, gitHeadCommit, runCommand, runGit } from "./git.js";

export interface IsolatedDispatch {
  dispatchId: string;
  itemId: string;
  baseCommit: string;
  branchName: string;
  baseBranch: string;
  itemFile: string;
  isolatedItemFile: string;
  worktreePath: string;
}

interface GitWorktreeIsolationOptions {
  systemRoot: string;
  delamainName: string;
  worktreeRoot?: string;
}

export interface WorktreeInspection {
  exists: boolean;
  pristine: boolean;
  dirty: boolean;
  headCommit: string | null;
}

export interface MergeBackResult {
  status: "merged" | "blocked";
  integratedCommit: string | null;
  error: string | null;
  incidentKind: string | null;
}

export class GitWorktreeIsolationStrategy {
  private readonly systemRoot: string;
  private readonly delamainName: string;
  private readonly worktreeRoot: string;

  constructor(options: GitWorktreeIsolationOptions) {
    this.systemRoot = resolve(options.systemRoot);
    this.delamainName = options.delamainName;
    this.worktreeRoot = options.worktreeRoot
      ? resolve(options.worktreeRoot)
      : join(homedir(), ".worktrees", "delamain");
  }

  async prepareDispatch(input: {
    dispatchId: string;
    itemId: string;
    itemFile: string;
  }): Promise<IsolatedDispatch> {
    const baseCommit = await gitHeadCommit(this.systemRoot);
    const baseBranch = await gitCurrentBranch(this.systemRoot);
    const branchName = buildWorktreeBranchName(this.delamainName, input.itemId, input.dispatchId);
    const worktreePath = join(
      this.worktreeRoot,
      sanitizePathSegment(this.delamainName),
      sanitizePathSegment(input.itemId),
      sanitizePathSegment(input.dispatchId),
    );

    await mkdir(dirname(worktreePath), { recursive: true });
    await runGit(this.systemRoot, ["worktree", "add", "-b", branchName, worktreePath, baseCommit]);

    return {
      dispatchId: input.dispatchId,
      itemId: input.itemId,
      baseCommit,
      branchName,
      baseBranch,
      itemFile: input.itemFile,
      isolatedItemFile: this.rewritePath(input.itemFile, worktreePath),
      worktreePath,
    };
  }

  rewritePath(mainPath: string, worktreePath: string): string {
    const relativePath = relative(this.systemRoot, resolve(mainPath));
    if (relativePath.startsWith("..") || relativePath === "") {
      throw new Error(
        `Cannot rewrite '${mainPath}' into worktree '${worktreePath}' because it is outside '${this.systemRoot}'`,
      );
    }

    return join(worktreePath, relativePath);
  }

  async inspectWorktree(input: {
    worktreePath: string | null;
    baseCommit: string | null;
  }): Promise<WorktreeInspection> {
    if (!input.worktreePath || !existsSync(input.worktreePath)) {
      return {
        exists: false,
        pristine: true,
        dirty: false,
        headCommit: null,
      };
    }

    const headCommit = await gitHeadCommit(input.worktreePath);
    const dirty = input.baseCommit
      ? await gitHasChanges(input.worktreePath, input.baseCommit)
      : true;

    return {
      exists: true,
      pristine: !dirty && input.baseCommit === headCommit,
      dirty,
      headCommit,
    };
  }

  async commitDispatch(
    worktreePath: string,
    baseCommit: string,
    message: string,
  ): Promise<string | null> {
    const [status, headCommit] = await Promise.all([
      runGit(worktreePath, ["status", "--porcelain"]),
      gitHeadCommit(worktreePath),
    ]);
    if (status.length === 0 && headCommit === baseCommit) {
      return null;
    }

    if (headCommit !== baseCommit) {
      // Squash any agent-authored branch history back onto the dispatch base so a
      // single audit commit carries the full isolated snapshot into integration.
      await runGit(worktreePath, ["reset", "--soft", baseCommit]);
    }

    await runGit(worktreePath, ["add", "-A"]);
    const staged = await runGit(worktreePath, ["status", "--porcelain"]);
    if (staged.length === 0) {
      return null;
    }
    await runGit(
      worktreePath,
      [
        "-c",
        "user.name=Delamain Dispatcher",
        "-c",
        "user.email=delamain@local",
        "commit",
        "--no-gpg-sign",
        "-m",
        message,
      ],
    );

    return gitHeadCommit(worktreePath);
  }

  async mergeBack(worktreeCommit: string): Promise<MergeBackResult> {
    const status = await runGit(this.systemRoot, ["status", "--porcelain", "--untracked-files=no"]);
    if (status.length > 0) {
      return {
        status: "blocked",
        integratedCommit: null,
        error: "Integration checkout is dirty",
        incidentKind: "dirty_integration_checkout",
      };
    }

    const result = await runCommand(
      ["git", "cherry-pick", worktreeCommit],
      { cwd: this.systemRoot },
    );

    if (result.exitCode !== 0) {
      await this.abortCherryPick();
      return {
        status: "blocked",
        integratedCommit: null,
        error: result.stderr.trim() || result.stdout.trim() || "Cherry-pick failed",
        incidentKind: "merge_conflict",
      };
    }

    return {
      status: "merged",
      integratedCommit: await gitHeadCommit(this.systemRoot),
      error: null,
      incidentKind: null,
    };
  }

  async cleanupDispatch(input: { worktreePath: string | null; branchName: string | null }): Promise<void> {
    if (input.worktreePath && existsSync(input.worktreePath)) {
      await runGit(this.systemRoot, ["worktree", "remove", "--force", input.worktreePath]);
    }

    if (input.worktreePath || input.branchName) {
      await runGit(this.systemRoot, ["worktree", "prune"]);
    }

    if (input.branchName) {
      const result = await runCommand(
        ["git", "branch", "-D", input.branchName],
        { cwd: this.systemRoot },
      );
      if (result.exitCode !== 0 && !result.stderr.includes("not found")) {
        throw new Error(result.stderr.trim() || result.stdout.trim() || "branch delete failed");
      }
    }
  }

  private async abortCherryPick(): Promise<void> {
    const result = await runCommand(
      ["git", "cherry-pick", "--abort"],
      { cwd: this.systemRoot },
    );
    if (result.exitCode !== 0 && !result.stderr.includes("no cherry-pick")) {
      console.warn(
        `[dispatcher] cherry-pick abort failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`}`,
      );
    }
  }
}

function buildWorktreeBranchName(
  delamainName: string,
  itemId: string,
  dispatchId: string,
): string {
  return [
    "delamain",
    sanitizePathSegment(delamainName),
    sanitizePathSegment(itemId),
    sanitizePathSegment(dispatchId),
  ].join("/");
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}
