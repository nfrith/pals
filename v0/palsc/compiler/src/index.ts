#!/usr/bin/env npx tsx
// shapec — PALS shape compiler CLI
//
// Usage:
//   npx tsx src/index.ts <SHAPE.yaml> <module-dir>
//   npx tsx src/index.ts shapes/backlog.yaml ../../example-systems/pristine-happy-path/workspace/backlog

import { resolve } from "node:path";
import { parseShapeFile } from "./parser/shape-parser.js";
import { validate } from "./validator/runtime.js";

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error("Usage: shapec <SHAPE.yaml> <module-dir>");
  console.error("  <SHAPE.yaml>  Path to shape definition file");
  console.error("  <module-dir>  Path to module directory to validate");
  process.exit(2);
}

const shape_path = resolve(args[0]);
const module_dir = resolve(args[1]);

try {
  const shape = parseShapeFile(shape_path);
  const result = validate(shape, module_dir);

  console.log(JSON.stringify(result, null, 2));

  if (result.status === "fail") process.exit(1);
  if (result.status === "warn") process.exit(0);
  process.exit(0);
} catch (err) {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(2);
}
