// Matches concrete record paths against entity path templates.
// Returns entity name + placeholder bindings, or diagnostics.

import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { ShapeModule, ParsedRecord } from "../types.js";
import { parsePathTemplate, matchPath } from "../parser/path-template.js";

export interface EntityMatch {
  entity_name: string;
  bindings: Map<string, string>;
}

// Try to match a module-relative path against all entity templates.
// Returns exactly one match, or null if zero or multiple matches.
export function matchEntityPath(
  relative_path: string,
  module: ShapeModule,
): EntityMatch | null {
  const matches: EntityMatch[] = [];

  for (const [name, entity] of module.entities) {
    const template = parsePathTemplate(entity.path_template, name);
    const bindings = matchPath(relative_path, template);
    if (bindings !== null) {
      matches.push({ entity_name: name, bindings });
    }
  }

  if (matches.length === 1) return matches[0];
  return null;
}

// Discover all .md files under a module directory (excluding MODULE.md and .schema/)
export function discoverRecordPaths(module_dir: string): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        if (entry.name === "MODULE.md") continue;
        const rel = relative(module_dir, full).replace(/\\/g, "/");
        results.push(rel);
      }
    }
  }

  walk(module_dir);
  return results.sort();
}
