#!/usr/bin/env bun

import { buildOperatorConfigSessionStart } from "../alsc/compiler/src/hook-runtime.ts";
import {
  derivePluginRootFromEntrypoint,
  parseHookInput,
} from "./hook-adapter.ts";

interface SessionStartPayload {
  cwd?: string;
}

try {
  const input = await parseHookInput<SessionStartPayload>();
  const output = buildOperatorConfigSessionStart({
    context: {
      plugin_root: derivePluginRootFromEntrypoint(import.meta.url),
    },
    cwd: typeof input?.cwd === "string" && input.cwd.length > 0
      ? input.cwd
      : process.cwd(),
  });

  if (output.length > 0) {
    process.stdout.write(output);
  }
} catch {
  process.exit(0);
}
