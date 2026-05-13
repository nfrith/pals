import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { codes, diag, reasons } from "./diagnostics.ts";
import { toRepoRelative } from "./system-paths.ts";
import type { CompilerDiagnostic } from "./types.ts";

const CLAUDE_PLACEHOLDER = "${CLAUDE_PLUGIN_ROOT}";
const CODEX_PLACEHOLDER = "${PLUGIN_ROOT}";
const PLACEHOLDER_PATH_PATTERN = /\$\{(?:CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT)\}[^\s"'`]+/g;

interface HookLauncherEntry {
  file_rel: string;
  location: string;
  launcher: Record<string, unknown>;
}

interface PlatformContract {
  disallowed_placeholders: Array<{
    pattern: RegExp;
    label: string;
  }>;
}

const CLAUDE_CONTRACT: PlatformContract = {
  disallowed_placeholders: [
    { pattern: /(?<!\{)\$CLAUDE_PLUGIN_ROOT\b/, label: "$CLAUDE_PLUGIN_ROOT" },
    { pattern: /(?<!\{)\$PLUGIN_ROOT\b/, label: "$PLUGIN_ROOT" },
    { pattern: /\$\{PLUGIN_ROOT\}/, label: CODEX_PLACEHOLDER },
  ],
};

const CODEX_CONTRACT: PlatformContract = {
  disallowed_placeholders: [
    { pattern: /(?<!\{)\$CLAUDE_PLUGIN_ROOT\b/, label: "$CLAUDE_PLUGIN_ROOT" },
    { pattern: /(?<!\{)\$PLUGIN_ROOT\b/, label: "$PLUGIN_ROOT" },
    { pattern: /\$\{CLAUDE_PLUGIN_ROOT\}/, label: CLAUDE_PLACEHOLDER },
  ],
};

export function validateBundledHookConfigs(systemRootAbs: string): CompilerDiagnostic[] {
  return [
    ...validateClaudeHookConfigs(systemRootAbs),
    ...validateCodexHookConfigs(systemRootAbs),
  ];
}

function validateClaudeHookConfigs(systemRootAbs: string): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const manifest = loadPluginManifest(systemRootAbs, ".claude-plugin/plugin.json", diagnostics);
  if (!manifest) {
    return diagnostics;
  }

  const hookValues = manifest.hooks;
  if (!Array.isArray(hookValues) || hookValues.some((value) => typeof value !== "string" || value.length === 0)) {
    diagnostics.push(
      diag(
        codes.SYSTEM_PLUGIN_MANIFEST_INVALID,
        "error",
        "system_config",
        toRepoRelative(resolve(systemRootAbs, ".claude-plugin/plugin.json")),
        "Claude Code plugin manifest must declare 'hooks' as a non-empty array of plugin-root-relative JSON paths",
        {
          reason: reasons.SYSTEM_PLUGIN_MANIFEST_HOOKS_INVALID,
          field: "hooks",
          expected: "string[]",
          actual: Array.isArray(hookValues) ? hookValues : typeof hookValues,
          hint: "Keep the five Claude per-hook configs listed in .claude-plugin/plugin.json.",
        },
      ),
    );
    return diagnostics;
  }

  for (const hookPath of hookValues) {
    const hookConfigAbs = resolve(systemRootAbs, hookPath);
    diagnostics.push(...validateHookConfigFile(systemRootAbs, hookConfigAbs, { require_exec_args: true }));
  }

  return diagnostics;
}

function validateCodexHookConfigs(systemRootAbs: string): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const manifest = loadPluginManifest(systemRootAbs, ".codex-plugin/plugin.json", diagnostics);
  if (!manifest) {
    return diagnostics;
  }

  const hookValue = manifest.hooks;
  if (typeof hookValue !== "string" || hookValue.length === 0) {
    diagnostics.push(
      diag(
        codes.SYSTEM_PLUGIN_MANIFEST_INVALID,
        "error",
        "system_config",
        toRepoRelative(resolve(systemRootAbs, ".codex-plugin/plugin.json")),
        "Codex plugin manifest must declare 'hooks' as one plugin-root-relative JSON path",
        {
          reason: reasons.SYSTEM_PLUGIN_MANIFEST_HOOKS_INVALID,
          field: "hooks",
          expected: "string",
          actual: hookValue === undefined ? null : typeof hookValue,
          hint: "Keep the Codex hook bundle declared as ./hooks/hooks.json.",
        },
      ),
    );
    return diagnostics;
  }

  const hookConfigAbs = resolve(systemRootAbs, hookValue);
  diagnostics.push(...validateHookConfigFile(systemRootAbs, hookConfigAbs, { require_exec_args: false }));
  return diagnostics;
}

function validateHookConfigFile(
  systemRootAbs: string,
  hookConfigAbs: string,
  options: { require_exec_args: boolean },
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const fileRel = toRepoRelative(hookConfigAbs);
  const parsed = loadJsonFile(hookConfigAbs, fileRel, "hook config", codes.SYSTEM_PLUGIN_HOOK_CONFIG_INVALID, reasons.SYSTEM_HOOK_CONFIG_JSON_INVALID, diagnostics);
  if (!parsed || !isRecord(parsed)) {
    return diagnostics;
  }

  const launchers = collectCommandLaunchers(parsed, fileRel, diagnostics);
  for (const entry of launchers) {
    if (options.require_exec_args) {
      validateClaudeLauncher(systemRootAbs, entry, diagnostics);
      continue;
    }

    validateCodexLauncher(systemRootAbs, entry, diagnostics);
  }

  return diagnostics;
}

function validateClaudeLauncher(
  systemRootAbs: string,
  entry: HookLauncherEntry,
  diagnostics: CompilerDiagnostic[],
): void {
  const command = typeof entry.launcher.command === "string" ? entry.launcher.command : null;
  if (!command || command.trim().length === 0) {
    diagnostics.push(
      diag(
        codes.SYSTEM_PLUGIN_HOOK_LAUNCHER_INVALID,
        "error",
        "system_config",
        entry.file_rel,
        `${entry.location} must set 'command' to the executable only for Claude Code hook launchers`,
        {
          reason: reasons.SYSTEM_HOOK_LAUNCHER_COMMAND_INVALID,
          field: `${entry.location}.command`,
          expected: "executable string without placeholder path expansion",
          actual: command,
        },
      ),
    );
  } else if (containsPlaceholderToken(command)) {
    diagnostics.push(
      diag(
        codes.SYSTEM_PLUGIN_HOOK_LAUNCHER_INVALID,
        "error",
        "system_config",
        entry.file_rel,
        `${entry.location}.command must stay executable-only on the Claude side; move the plugin-rooted script path into 'args' with ${CLAUDE_PLACEHOLDER}`,
        {
          reason: reasons.SYSTEM_HOOK_LAUNCHER_COMMAND_INVALID,
          field: `${entry.location}.command`,
          expected: "executable string without placeholder tokens",
          actual: command,
          hint: "Use command: \"bun\" or \"bash\" and put the script path in args[0].",
        },
      ),
    );
  }

  const args = entry.launcher.args;
  if (!Array.isArray(args) || args.length === 0 || args.some((value) => typeof value !== "string" || value.length === 0)) {
    diagnostics.push(
      diag(
        codes.SYSTEM_PLUGIN_HOOK_LAUNCHER_INVALID,
        "error",
        "system_config",
        entry.file_rel,
        `${entry.location} must declare a non-empty string[] 'args' array for Claude Code hook launchers`,
        {
          reason: reasons.SYSTEM_HOOK_LAUNCHER_ARGS_INVALID,
          field: `${entry.location}.args`,
          expected: "non-empty string[]",
          actual: Array.isArray(args) ? args : args === undefined ? null : typeof args,
          hint: `Keep the plugin-rooted script path in args using ${CLAUDE_PLACEHOLDER}.`,
        },
      ),
    );
    return;
  }

  const argsStrings = args.filter((value): value is string => typeof value === "string");
  const disallowed = findFirstDisallowedPlaceholder(argsStrings, CLAUDE_CONTRACT.disallowed_placeholders);
  if (disallowed) {
    diagnostics.push(
      diag(
        codes.SYSTEM_PLUGIN_HOOK_LAUNCHER_INVALID,
        "error",
        "system_config",
        entry.file_rel,
        `${entry.location} must use ${CLAUDE_PLACEHOLDER} in Claude Code hook args, not '${disallowed}'`,
        {
          reason: reasons.SYSTEM_HOOK_LAUNCHER_PLACEHOLDER_INVALID,
          field: `${entry.location}.args`,
          expected: CLAUDE_PLACEHOLDER,
          actual: disallowed,
        },
      ),
    );
  }

  const placeholderTargets = extractPlaceholderTargets(argsStrings, CLAUDE_PLACEHOLDER);
  if (placeholderTargets.length === 0) {
    if (!disallowed) {
      diagnostics.push(
        diag(
          codes.SYSTEM_PLUGIN_HOOK_LAUNCHER_INVALID,
          "error",
          "system_config",
          entry.file_rel,
          `${entry.location} must include a plugin-rooted script arg using ${CLAUDE_PLACEHOLDER}`,
          {
            reason: reasons.SYSTEM_HOOK_LAUNCHER_PLACEHOLDER_INVALID,
            field: `${entry.location}.args`,
            expected: `${CLAUDE_PLACEHOLDER}/hooks/<entrypoint>`,
            actual: argsStrings,
          },
        ),
      );
    }
    return;
  }

  validateResolvedTargets(systemRootAbs, entry, placeholderTargets, CLAUDE_PLACEHOLDER, diagnostics);
}

function validateCodexLauncher(
  systemRootAbs: string,
  entry: HookLauncherEntry,
  diagnostics: CompilerDiagnostic[],
): void {
  const command = typeof entry.launcher.command === "string" ? entry.launcher.command : null;
  if (!command || command.trim().length === 0) {
    diagnostics.push(
      diag(
        codes.SYSTEM_PLUGIN_HOOK_LAUNCHER_INVALID,
        "error",
        "system_config",
        entry.file_rel,
        `${entry.location} must declare a string 'command' for Codex hook launchers`,
        {
          reason: reasons.SYSTEM_HOOK_LAUNCHER_COMMAND_INVALID,
          field: `${entry.location}.command`,
          expected: "string",
          actual: command,
        },
      ),
    );
    return;
  }

  const args = Array.isArray(entry.launcher.args)
    ? entry.launcher.args.filter((value): value is string => typeof value === "string")
    : [];
  const launcherStrings = [command, ...args];
  const disallowed = findFirstDisallowedPlaceholder(launcherStrings, CODEX_CONTRACT.disallowed_placeholders);
  if (disallowed) {
    diagnostics.push(
      diag(
        codes.SYSTEM_PLUGIN_HOOK_LAUNCHER_INVALID,
        "error",
        "system_config",
        entry.file_rel,
        `${entry.location} must use ${CODEX_PLACEHOLDER} on the Codex side, not '${disallowed}'`,
        {
          reason: reasons.SYSTEM_HOOK_LAUNCHER_PLACEHOLDER_INVALID,
          field: `${entry.location}.command`,
          expected: CODEX_PLACEHOLDER,
          actual: disallowed,
        },
      ),
    );
  }

  const placeholderTargets = extractPlaceholderTargets(launcherStrings, CODEX_PLACEHOLDER);
  if (placeholderTargets.length === 0) {
    if (!disallowed) {
      diagnostics.push(
        diag(
          codes.SYSTEM_PLUGIN_HOOK_LAUNCHER_INVALID,
          "error",
          "system_config",
          entry.file_rel,
          `${entry.location} must reference a plugin-rooted script path using ${CODEX_PLACEHOLDER}`,
          {
            reason: reasons.SYSTEM_HOOK_LAUNCHER_PLACEHOLDER_INVALID,
            field: `${entry.location}.command`,
            expected: `${CODEX_PLACEHOLDER}/hooks/<entrypoint>`,
            actual: launcherStrings,
          },
        ),
      );
    }
    return;
  }

  validateResolvedTargets(systemRootAbs, entry, placeholderTargets, CODEX_PLACEHOLDER, diagnostics);
}

function validateResolvedTargets(
  systemRootAbs: string,
  entry: HookLauncherEntry,
  placeholderTargets: string[],
  placeholder: string,
  diagnostics: CompilerDiagnostic[],
): void {
  for (const target of placeholderTargets) {
    const targetAbs = resolve(target.replace(placeholder, systemRootAbs));
    const targetRel = toRepoRelative(targetAbs);

    try {
      const stat = statSync(targetAbs);
      if (!stat.isFile()) {
        diagnostics.push(
          diag(
            codes.SYSTEM_PLUGIN_HOOK_LAUNCHER_INVALID,
            "error",
            "system_config",
            entry.file_rel,
            `${entry.location} resolves to '${targetRel}', but that target is not a file`,
            {
              reason: reasons.SYSTEM_HOOK_LAUNCHER_TARGET_NOT_FILE,
              field: `${entry.location}.command`,
              expected: "existing file",
              actual: targetRel,
            },
          ),
        );
      }
    } catch (error) {
      const detail = error instanceof Error && error.message.length > 0 ? ` (${error.message})` : "";
      diagnostics.push(
        diag(
          codes.SYSTEM_PLUGIN_HOOK_LAUNCHER_INVALID,
          "error",
          "system_config",
          entry.file_rel,
          `${entry.location} resolves to missing hook entrypoint '${targetRel}'${detail}`,
          {
            reason: reasons.SYSTEM_HOOK_LAUNCHER_TARGET_MISSING,
            field: `${entry.location}.command`,
            expected: "existing file",
            actual: targetRel,
          },
        ),
      );
    }
  }
}

function collectCommandLaunchers(
  parsed: Record<string, unknown>,
  fileRel: string,
  diagnostics: CompilerDiagnostic[],
): HookLauncherEntry[] {
  const launchers: HookLauncherEntry[] = [];
  const hooksValue = parsed.hooks;
  if (!isRecord(hooksValue)) {
    diagnostics.push(
      diag(
        codes.SYSTEM_PLUGIN_HOOK_CONFIG_INVALID,
        "error",
        "system_config",
        fileRel,
        "Hook config must expose a top-level 'hooks' object",
        {
          reason: reasons.SYSTEM_HOOK_CONFIG_HOOKS_INVALID,
          field: "hooks",
          expected: "object",
          actual: hooksValue === undefined ? null : typeof hooksValue,
        },
      ),
    );
    return launchers;
  }

  for (const [eventName, eventGroups] of Object.entries(hooksValue)) {
    if (!Array.isArray(eventGroups)) {
      diagnostics.push(
        diag(
          codes.SYSTEM_PLUGIN_HOOK_CONFIG_INVALID,
          "error",
          "system_config",
          fileRel,
          `Hook event '${eventName}' must map to an array`,
          {
            reason: reasons.SYSTEM_HOOK_CONFIG_HOOKS_INVALID,
            field: `hooks.${eventName}`,
            expected: "array",
            actual: typeof eventGroups,
          },
        ),
      );
      continue;
    }

    eventGroups.forEach((groupValue, groupIndex) => {
      if (!isRecord(groupValue)) {
        diagnostics.push(
          diag(
            codes.SYSTEM_PLUGIN_HOOK_CONFIG_INVALID,
            "error",
            "system_config",
            fileRel,
            `Hook group hooks.${eventName}[${groupIndex}] must be an object`,
            {
              reason: reasons.SYSTEM_HOOK_CONFIG_HOOKS_INVALID,
              field: `hooks.${eventName}[${groupIndex}]`,
              expected: "object",
              actual: groupValue === null ? null : typeof groupValue,
            },
          ),
        );
        return;
      }

      const nestedHooks = groupValue.hooks;
      if (!Array.isArray(nestedHooks)) {
        diagnostics.push(
          diag(
            codes.SYSTEM_PLUGIN_HOOK_CONFIG_INVALID,
            "error",
            "system_config",
            fileRel,
            `Hook group hooks.${eventName}[${groupIndex}] must declare a 'hooks' array`,
            {
              reason: reasons.SYSTEM_HOOK_CONFIG_HOOKS_INVALID,
              field: `hooks.${eventName}[${groupIndex}].hooks`,
              expected: "array",
              actual: nestedHooks === undefined ? null : typeof nestedHooks,
            },
          ),
        );
        return;
      }

      nestedHooks.forEach((launcherValue, hookIndex) => {
        if (!isRecord(launcherValue)) {
          diagnostics.push(
            diag(
              codes.SYSTEM_PLUGIN_HOOK_CONFIG_INVALID,
              "error",
              "system_config",
              fileRel,
              `Hook launcher hooks.${eventName}[${groupIndex}].hooks[${hookIndex}] must be an object`,
              {
                reason: reasons.SYSTEM_HOOK_CONFIG_HOOKS_INVALID,
                field: `hooks.${eventName}[${groupIndex}].hooks[${hookIndex}]`,
                expected: "object",
                actual: launcherValue === null ? null : typeof launcherValue,
              },
            ),
          );
          return;
        }

        if (launcherValue.type !== "command") {
          return;
        }

        launchers.push({
          file_rel: fileRel,
          location: `hooks.${eventName}[${groupIndex}].hooks[${hookIndex}]`,
          launcher: launcherValue,
        });
      });
    });
  }

  return launchers;
}

function loadPluginManifest(
  systemRootAbs: string,
  manifestRelPath: string,
  diagnostics: CompilerDiagnostic[],
): Record<string, unknown> | null {
  const manifestAbs = resolve(systemRootAbs, manifestRelPath);
  try {
    statSync(manifestAbs);
  } catch {
    return null;
  }

  const fileRel = toRepoRelative(manifestAbs);

  const parsed = loadJsonFile(
    manifestAbs,
    fileRel,
    "plugin manifest",
    codes.SYSTEM_PLUGIN_MANIFEST_INVALID,
    reasons.SYSTEM_PLUGIN_MANIFEST_JSON_INVALID,
    diagnostics,
  );
  return parsed && isRecord(parsed) ? parsed : null;
}

function loadJsonFile(
  pathAbs: string,
  fileRel: string,
  label: string,
  code: string,
  reason: string,
  diagnostics: CompilerDiagnostic[],
): unknown | null {
  try {
    return JSON.parse(readFileSync(pathAbs, "utf-8"));
  } catch (error) {
    const detail = error instanceof Error && error.message.length > 0 ? ` (${error.message})` : "";
    diagnostics.push(
      diag(code, "error", "system_config", fileRel, `Could not read ${label} JSON${detail}`, {
        reason,
        expected: "valid JSON file",
        actual: fileRel,
      }),
    );
    return null;
  }
}

function extractPlaceholderTargets(values: string[], expectedPlaceholder: string): string[] {
  const targets = new Set<string>();

  for (const value of values) {
    for (const match of value.matchAll(PLACEHOLDER_PATH_PATTERN)) {
      const candidate = match[0];
      if (candidate.startsWith(expectedPlaceholder)) {
        targets.add(candidate);
      }
    }
  }

  return [...targets];
}

function findFirstDisallowedPlaceholder(
  values: string[],
  disallowedPatterns: PlatformContract["disallowed_placeholders"],
): string | null {
  for (const value of values) {
    for (const { pattern, label } of disallowedPatterns) {
      if (pattern.test(value)) {
        return label;
      }
    }
  }

  return null;
}

function containsPlaceholderToken(value: string): boolean {
  return value.includes(CLAUDE_PLACEHOLDER)
    || value.includes(CODEX_PLACEHOLDER)
    || /(?<!\{)\$CLAUDE_PLUGIN_ROOT\b/.test(value)
    || /(?<!\{)\$PLUGIN_ROOT\b/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
