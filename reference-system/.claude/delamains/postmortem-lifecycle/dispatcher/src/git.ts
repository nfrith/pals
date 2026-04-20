interface RunCommandOptions {
  cwd: string;
  env?: Record<string, string | undefined>;
}

export async function runGit(
  cwd: string,
  args: string[],
  options: Omit<RunCommandOptions, "cwd"> = {},
): Promise<string> {
  const result = await runCommand(["git", ...args], {
    cwd,
    env: options.env,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in '${cwd}': ${result.stderr || result.stdout || `exit ${result.exitCode}`}`,
    );
  }

  return result.stdout.trim();
}

export async function runCommand(
  cmd: string[],
  options: RunCommandOptions,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn({
    cmd,
    cwd: options.cwd,
    env: options.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return {
    stdout,
    stderr,
    exitCode,
  };
}

export async function gitHeadCommit(cwd: string): Promise<string> {
  return runGit(cwd, ["rev-parse", "HEAD"]);
}

export async function gitRepoRoot(cwd: string): Promise<string> {
  return runGit(cwd, ["rev-parse", "--show-toplevel"]);
}

export async function gitRepoPrefix(cwd: string): Promise<string> {
  return runGit(cwd, ["rev-parse", "--show-prefix"]);
}

export async function gitCommonDir(cwd: string): Promise<string> {
  return runGit(cwd, ["rev-parse", "--git-common-dir"]);
}

export async function gitCurrentBranch(cwd: string): Promise<string> {
  return runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

export async function gitStatusPorcelain(cwd: string): Promise<string> {
  return runGit(cwd, ["status", "--porcelain"]);
}

export async function gitStatusPorcelainNoUntracked(cwd: string): Promise<string> {
  return runGit(cwd, ["status", "--porcelain", "--untracked-files=no"]);
}

export async function gitListTrackedFilesAtHead(
  cwd: string,
  pathspec?: string,
): Promise<string[]> {
  const args = ["ls-tree", "-r", "--name-only", "HEAD"];
  if (pathspec) {
    args.push("--", pathspec);
  }

  const output = await runGit(cwd, args);
  if (output.length === 0) return [];
  return output.split("\n").filter(Boolean);
}

export async function gitChangedFilesAgainstHead(
  cwd: string,
  pathspec?: string,
): Promise<string[]> {
  const args = ["diff", "--name-only", "HEAD"];
  if (pathspec) {
    args.push("--", pathspec);
  }

  const output = await runGit(cwd, args);
  if (output.length === 0) return [];
  return output.split("\n").filter(Boolean);
}

async function readGitObject(
  cwd: string,
  objectSpec: string,
): Promise<string | null> {
  const result = await runCommand(["git", "show", objectSpec], { cwd });
  if (result.exitCode !== 0) {
    return null;
  }

  return result.stdout;
}

export async function readGitFileAtHead(
  cwd: string,
  repoRelativePath: string,
): Promise<string | null> {
  return readGitObject(cwd, `HEAD:${repoRelativePath}`);
}

export async function readGitFileFromIndex(
  cwd: string,
  repoRelativePath: string,
): Promise<string | null> {
  return readGitObject(cwd, `:${repoRelativePath}`);
}

export async function gitHasChanges(cwd: string, baseCommit: string): Promise<boolean> {
  const [status, head] = await Promise.all([
    gitStatusPorcelain(cwd),
    gitHeadCommit(cwd),
  ]);

  return status.length > 0 || head !== baseCommit;
}

export async function gitIsClean(cwd: string): Promise<boolean> {
  return (await gitStatusPorcelainNoUntracked(cwd)).length === 0;
}

export function isProcessAlive(pid: number | null): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
