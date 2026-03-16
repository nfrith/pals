#!/usr/bin/env bun

import { resolve } from "node:path";
import { validateSystem } from "./validate.ts";

const args = process.argv.slice(2);

if (args.length < 1 || args.length > 2) {
  console.error("Usage: bun src/index.ts <system-root> [module-id]");
  process.exit(2);
}

const systemRoot = resolve(args[0]);
const moduleId = args[1];

const result = validateSystem(systemRoot, moduleId);
console.log(JSON.stringify(result, null, 2));

if (result.status === "fail") {
  process.exit(1);
}
