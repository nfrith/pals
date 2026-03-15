// Validation runtime — orchestrates the 7-phase pipeline from record-validation.md.
// Takes a ShapeModule + module directory, validates all records, emits CompilerOutput.

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import matter from "gray-matter";
import type {
  ShapeModule,
  CompilerOutput,
  CompilerDiagnostic,
  ParsedRecord,
} from "../types.js";
import { matchEntityPath, discoverRecordPaths } from "./path-matching.js";
import { validateFrontmatter } from "./frontmatter.js";
import { parseBodySections, validateBody } from "./body.js";
import { validateIdentity, validateUniqueness } from "./identity.js";
import { diag, codes } from "./diagnostics.js";

export function validate(shape: ShapeModule, module_dir: string): CompilerOutput {
  const all_diagnostics: CompilerDiagnostic[] = [];

  // Phase 1: Module context is the ShapeModule itself — already loaded.

  // Discover record files
  const record_paths = discoverRecordPaths(module_dir);
  const records: ParsedRecord[] = [];
  const identity_index = new Map<string, string[]>(); // canonical_id -> [file_paths]

  let files_passed = 0;
  let files_failed = 0;

  for (const rel_path of record_paths) {
    const abs_path = join(module_dir, rel_path);
    const record_diagnostics: CompilerDiagnostic[] = [];

    // Phase 2: Parse record
    let frontmatter: Record<string, unknown>;
    let body_raw: string;
    try {
      const file_content = readFileSync(abs_path, "utf-8");
      const parsed = matter(file_content);
      frontmatter = parsed.data as Record<string, unknown>;
      body_raw = parsed.content;
    } catch (err) {
      record_diagnostics.push(
        diag(codes.PARSE_FRONTMATTER, "error", "parse", rel_path, `Failed to parse frontmatter: ${err}`, {}),
      );
      all_diagnostics.push(...record_diagnostics);
      files_failed++;
      continue;
    }

    // Infer entity from path
    const entity_match = matchEntityPath(rel_path, shape);
    if (!entity_match) {
      record_diagnostics.push(
        diag(codes.PARSE_ENTITY_INFER, "error", "parse", rel_path, `Could not infer entity from path '${rel_path}' — zero or multiple template matches`, {
          expected: [...shape.entities.keys()].map((e) => shape.entities.get(e)!.path_template),
          actual: rel_path,
        }),
      );
      all_diagnostics.push(...record_diagnostics);
      files_failed++;
      continue;
    }

    const entity = shape.entities.get(entity_match.entity_name)!;

    // Parse body sections
    const body_sections = parseBodySections(body_raw);

    // Phase 3: Frontmatter validation
    record_diagnostics.push(
      ...validateFrontmatter(frontmatter, entity, rel_path),
    );

    // Phase 4: Body validation
    record_diagnostics.push(
      ...validateBody(body_sections, entity, rel_path),
    );

    // Phase 5: Identity validation
    record_diagnostics.push(
      ...validateIdentity(frontmatter, rel_path, entity.name),
    );

    // Build identity index for duplicate detection.
    // Use qualified canonical identity: include parent bindings so that
    // e.g. experiment/EXP-0001 under PRG-0001 is distinct from under PRG-0002.
    const id = frontmatter.id;
    if (typeof id === "string" && id.length > 0) {
      const canonical_key = buildCanonicalKey(entity.name, id, entity_match.bindings, shape);
      if (!identity_index.has(canonical_key)) {
        identity_index.set(canonical_key, []);
      }
      identity_index.get(canonical_key)!.push(rel_path);
    }

    // Phase 6: Reference validation (format-only for v1)
    // Already checked in frontmatter validation for ref fields.

    // Phase 7: Module consistency
    // Entity path match already done. Additional checks deferred.

    if (record_diagnostics.some((d) => d.severity === "error")) {
      files_failed++;
    } else {
      files_passed++;
    }

    all_diagnostics.push(...record_diagnostics);
  }

  // Module-level: check duplicate identities
  all_diagnostics.push(...validateUniqueness(identity_index));

  // Compute status
  const error_count = all_diagnostics.filter((d) => d.severity === "error").length;
  const warning_count = all_diagnostics.filter((d) => d.severity === "warning").length;

  let status: CompilerOutput["status"];
  if (error_count > 0) status = "fail";
  else if (warning_count > 0) status = "warn";
  else status = "pass";

  return {
    status,
    module_id: shape.module_id,
    module_path: module_dir,
    module_version: shape.version,
    schema_version: shape.version,
    generated_at: new Date().toISOString(),
    diagnostics: all_diagnostics,
    summary: {
      files_checked: record_paths.length,
      files_passed,
      files_failed,
      error_count,
      warning_count,
    },
  };
}

// Build a qualified canonical identity key.
// For flat entities: "story/STORY-0001"
// For nested entities: "program/PRG-0001/experiment/EXP-0001"
// This walks up the parent chain using path template bindings.
function buildCanonicalKey(
  entity_name: string,
  id: string,
  bindings: Map<string, string>,
  shape: ShapeModule,
): string {
  const segments: string[] = [];

  // Walk up the parent chain
  let current_entity_name: string | undefined = entity_name;
  while (current_entity_name) {
    const entity = shape.entities.get(current_entity_name);
    if (!entity) break;

    const bound_id = current_entity_name === entity_name
      ? id
      : bindings.get(current_entity_name);

    if (bound_id) {
      segments.unshift(`${current_entity_name}/${bound_id}`);
    }

    current_entity_name = entity.parent?.entity;
  }

  return segments.join("/");
}
