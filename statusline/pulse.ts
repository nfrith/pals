#!/usr/bin/env bun

import { startPulseRuntime } from "./mcp-server/runtime.ts";

const systemRoot = process.argv[2];
if (!systemRoot) {
  console.error("pulse: SYSTEM_ROOT arg required — usage: bun run pulse.ts <SYSTEM_ROOT>");
  process.exit(2);
}

startPulseRuntime({ systemRoot });
