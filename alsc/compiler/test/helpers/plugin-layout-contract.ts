import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const CLAUDE_PLACEHOLDER = "${CLAUDE_PLUGIN_ROOT}";
const CODEX_PLACEHOLDER = "${PLUGIN_ROOT}";
const OLD_CLAUDE_HOOK_FILES = [
  "post-edit-validate.json",
  "post-edit-breadcrumb.json",
  "stop-validate.json",
  "session-start-operator.json",
  "session-end-delamain.json",
] as const;
const EXPECTED_CLAUDE_HOOK_PATHS = [
  "./hooks/claude/session-start-operator.json",
  "./hooks/claude/post-edit-validate.json",
  "./hooks/claude/post-edit-breadcrumb.json",
  "./hooks/claude/stop-validate.json",
  "./hooks/claude/session-end-delamain.json",
] as const;
const EXPECTED_CODEX_HOOK_PATH = "./hooks/codex/hooks.json";
const CLAUDE_FORBIDDEN_TOKENS = ["${PLUGIN_ROOT}", "$CLAUDE_PLUGIN_ROOT", "$PLUGIN_ROOT"] as const;
const CODEX_FORBIDDEN_TOKENS = ["${CLAUDE_PLUGIN_ROOT}", "$CLAUDE_PLUGIN_ROOT", "$PLUGIN_ROOT"] as const;

interface CommandLauncher {
  location: string;
  command: string | null;
  args: string[];
}

export function assertBundledPluginLayout(root: string): void {
  assertPathMissing(root, "hooks/hooks.json", "Poisoned path");

  for (const oldFile of OLD_CLAUDE_HOOK_FILES) {
    assertPathMissing(root, `hooks/${oldFile}`, "Legacy top-level Claude hook file");
  }

  const claudeManifest = readJsonFile(root, ".claude-plugin/plugin.json");
  if (!Array.isArray(claudeManifest.hooks)) {
    throw new Error("Claude plugin manifest must declare hooks as a string array.");
  }

  const claudeHooks = claudeManifest.hooks.map((value) => {
    if (typeof value !== "string") {
      throw new Error("Claude plugin manifest hooks entries must be strings.");
    }
    return value;
  });
  assertExactPaths("Claude plugin manifest hooks", claudeHooks, EXPECTED_CLAUDE_HOOK_PATHS);

  for (const hookPath of EXPECTED_CLAUDE_HOOK_PATHS) {
    assertFileExists(root, hookPath);
    const hookConfig = readJsonFile(root, stripDotSlash(hookPath));
    const launchers = collectCommandLaunchers(hookConfig);
    if (launchers.length === 0) {
      throw new Error(`Claude hook config '${hookPath}' must declare at least one command launcher.`);
    }

    for (const launcher of launchers) {
      assertLauncherPlaceholderContract({
        root,
        hookPath,
        launcher,
        requiredPlaceholder: CLAUDE_PLACEHOLDER,
        forbiddenTokens: CLAUDE_FORBIDDEN_TOKENS,
        allowPlaceholderInCommand: false,
      });
    }
  }

  const codexManifest = readJsonFile(root, ".codex-plugin/plugin.json");
  if (typeof codexManifest.hooks !== "string") {
    throw new Error("Codex plugin manifest must declare hooks as one string path.");
  }
  if (codexManifest.hooks !== EXPECTED_CODEX_HOOK_PATH) {
    throw new Error(`Codex plugin manifest hooks must be '${EXPECTED_CODEX_HOOK_PATH}', received '${codexManifest.hooks}'.`);
  }

  assertFileExists(root, EXPECTED_CODEX_HOOK_PATH);
  const codexHookConfig = readJsonFile(root, stripDotSlash(EXPECTED_CODEX_HOOK_PATH));
  const codexLaunchers = collectCommandLaunchers(codexHookConfig);
  if (codexLaunchers.length === 0) {
    throw new Error("Codex hook bundle must declare at least one command launcher.");
  }

  for (const launcher of codexLaunchers) {
    assertLauncherPlaceholderContract({
      root,
      hookPath: EXPECTED_CODEX_HOOK_PATH,
      launcher,
      requiredPlaceholder: CODEX_PLACEHOLDER,
      forbiddenTokens: CODEX_FORBIDDEN_TOKENS,
      allowPlaceholderInCommand: true,
    });
  }
}

function assertLauncherPlaceholderContract(options: {
  root: string;
  hookPath: string;
  launcher: CommandLauncher;
  requiredPlaceholder: string;
  forbiddenTokens: readonly string[];
  allowPlaceholderInCommand: boolean;
}): void {
  const command = options.launcher.command;
  if (!command || command.trim().length === 0) {
    throw new Error(`${options.hookPath} ${options.launcher.location} must set a non-empty command string.`);
  }

  const searchableFields = [command, ...options.launcher.args];
  for (const field of searchableFields) {
    for (const token of options.forbiddenTokens) {
      if (containsToken(field, token)) {
        throw new Error(
          `${options.hookPath} ${options.launcher.location} uses forbidden token '${token}'; expected ${options.requiredPlaceholder}.`,
        );
      }
    }
  }

  if (!options.allowPlaceholderInCommand && command.includes("${")) {
    throw new Error(`${options.hookPath} ${options.launcher.location} must keep placeholder expansion out of command.`);
  }

  const resolvedTargets = new Set<string>();
  for (const field of searchableFields) {
    const matches = extractPlaceholderTargets(field, options.requiredPlaceholder);
    for (const match of matches) {
      resolvedTargets.add(match);
    }
  }

  if (resolvedTargets.size === 0) {
    throw new Error(
      `${options.hookPath} ${options.launcher.location} must reference a script path through ${options.requiredPlaceholder}.`,
    );
  }

  for (const target of resolvedTargets) {
    const resolvedPath = target.replace(options.requiredPlaceholder, options.root);
    const stat = safeStat(resolvedPath);
    if (stat === "missing") {
      throw new Error(`${options.hookPath} ${options.launcher.location} resolves missing target '${target}'.`);
    }
    if (stat === "not-file") {
      throw new Error(`${options.hookPath} ${options.launcher.location} resolves non-file target '${target}'.`);
    }
  }
}

function readJsonFile(root: string, relativePath: string): Record<string, unknown> {
  const filePath = resolve(root, relativePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (error) {
    throw new Error(`Could not parse JSON file '${relativePath}': ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Expected '${relativePath}' to contain a JSON object.`);
  }
  return parsed;
}

function collectCommandLaunchers(root: unknown, location = "root"): CommandLauncher[] {
  if (Array.isArray(root)) {
    return root.flatMap((value, index) => collectCommandLaunchers(value, `${location}[${index}]`));
  }

  if (!isRecord(root)) {
    return [];
  }

  const launchers: CommandLauncher[] = [];
  if (root.type === "command") {
    const command = typeof root.command === "string" ? root.command : null;
    const args = Array.isArray(root.args)
      ? root.args.filter((value): value is string => typeof value === "string")
      : [];
    launchers.push({ location, command, args });
  }

  for (const [key, value] of Object.entries(root)) {
    launchers.push(...collectCommandLaunchers(value, `${location}.${key}`));
  }
  return launchers;
}

function extractPlaceholderTargets(input: string, placeholder: string): string[] {
  const pattern = new RegExp(`${escapeRegExp(placeholder)}\\/[^\\s"'\\\`]+`, "g");
  return input.match(pattern) ?? [];
}

function containsToken(input: string, token: string): boolean {
  if (token.startsWith("${")) {
    return input.includes(token);
  }

  const envName = token.slice(1);
  const pattern = new RegExp(`(^|[^{$])\\$${escapeRegExp(envName)}\\b`);
  return pattern.test(input);
}

function assertPathMissing(root: string, relativePath: string, label: string): void {
  const stat = safeStat(resolve(root, relativePath));
  if (stat === "missing") {
    return;
  }

  throw new Error(`${label} '${relativePath}' must be absent.`);
}

function assertFileExists(root: string, relativePath: string): void {
  const stat = safeStat(resolve(root, stripDotSlash(relativePath)));
  if (stat === "file") {
    return;
  }

  if (stat === "missing") {
    throw new Error(`Expected file '${relativePath}' to exist.`);
  }

  throw new Error(`Expected '${relativePath}' to be a file.`);
}

function assertExactPaths(label: string, actual: string[], expected: readonly string[]): void {
  if (actual.length !== expected.length) {
    throw new Error(`${label} must contain ${expected.length} entries; received ${actual.length}.`);
  }

  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) {
      throw new Error(`${label} entry ${index + 1} must be '${expected[index]}', received '${actual[index]}'.`);
    }
  }
}

function safeStat(filePath: string): "file" | "not-file" | "missing" {
  try {
    const stat = statSync(filePath);
    return stat.isFile() ? "file" : "not-file";
  } catch {
    return "missing";
  }
}

function stripDotSlash(path: string): string {
  return path.startsWith("./") ? path.slice(2) : path;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
