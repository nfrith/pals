// Identity validation — Phase 5 of the record validation pipeline.
// Validates that record IDs are consistent with filenames and unique within module scope.

import { basename } from "node:path";
import type { CompilerDiagnostic } from "../types.js";
import { diag, codes } from "./diagnostics.js";

export function validateIdentity(
  frontmatter: Record<string, unknown>,
  file: string,
  entity_name: string,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const id = frontmatter.id;

  // id must exist and be non-empty (already checked by frontmatter validation,
  // but identity phase re-checks for the filename match)
  if (typeof id !== "string" || id.length === 0) {
    return diagnostics; // skip filename check if id is invalid
  }

  // Filename stem must equal frontmatter id
  const filename = basename(file);
  const stem = filename.replace(/\.md$/, "");

  if (stem !== id) {
    diagnostics.push(
      diag(codes.ID_FILENAME_MISMATCH, "error", "identity", file, `Filename stem '${stem}' does not match frontmatter id '${id}'`, {
        entity: entity_name,
        field: "id",
        expected: id,
        actual: stem,
        hint: `Rename file to '${id}.md' or update frontmatter id to '${stem}'`,
      }),
    );
  }

  return diagnostics;
}

// Check for duplicate canonical identities within module scope.
// Called after all records are parsed.
export function validateUniqueness(
  identity_index: Map<string, string[]>,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  for (const [canonical_id, files] of identity_index) {
    if (files.length > 1) {
      for (const file of files) {
        diagnostics.push(
          diag(codes.ID_DUPLICATE, "error", "identity", file, `Duplicate canonical identity '${canonical_id}' also found in: ${files.filter((f) => f !== file).join(", ")}`, {
            expected: "unique identity",
            actual: canonical_id,
          }),
        );
      }
    }
  }

  return diagnostics;
}
