// Body section validation — Phase 4 of the record validation pipeline.
// Validates markdown body sections against the entity's body section contracts.

import type { CompilerDiagnostic, ShapeEntity, ShapeBodySection } from "../types.js";
import { diag, codes } from "./diagnostics.js";

// Parse markdown body into sections keyed by ## heading.
// Returns Map<heading_text, section_content>.
export function parseBodySections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = body.split("\n");

  let currentHeading: string | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^## (.+)$/);
    if (headingMatch) {
      // Save previous section
      if (currentHeading !== null) {
        sections.set(currentHeading, currentContent.join("\n").trim());
      }
      currentHeading = headingMatch[1];
      currentContent = [];
    } else if (currentHeading !== null) {
      currentContent.push(line);
    }
    // Lines before first ## heading are ignored (preamble, H1 title, etc.)
  }

  // Save last section
  if (currentHeading !== null) {
    sections.set(currentHeading, currentContent.join("\n").trim());
  }

  return sections;
}

export function validateBody(
  body_sections: Map<string, string>,
  entity: ShapeEntity,
  file: string,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const entityName = entity.name;

  // Check declared section presence
  for (const [sectionName] of entity.body_sections) {
    if (!body_sections.has(sectionName)) {
      diagnostics.push(
        diag(codes.BODY_MISSING_SECTION, "error", "record_body", file, `Missing declared body section '## ${sectionName}'`, {
          entity: entityName,
          field: sectionName,
          expected: sectionName,
          actual: null,
        }),
      );
    }
  }

  // Check for unknown sections
  for (const [sectionName] of body_sections) {
    if (!entity.body_sections.has(sectionName)) {
      diagnostics.push(
        diag(codes.BODY_UNKNOWN_SECTION, "error", "record_body", file, `Unknown body section '## ${sectionName}'`, {
          entity: entityName,
          field: sectionName,
          expected: [...entity.body_sections.keys()],
          actual: sectionName,
        }),
      );
    }
  }

  // Validate each declared section
  for (const [sectionName, contract] of entity.body_sections) {
    const content = body_sections.get(sectionName);
    if (content === undefined) continue; // already reported as missing

    diagnostics.push(...validateSectionContent(content, contract, entityName, file));
  }

  return diagnostics;
}

function validateSectionContent(
  content: string,
  contract: ShapeBodySection,
  entityName: string,
  file: string,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const trimmed = content.trim();

  // Check null marker
  const isNull = trimmed === "null";

  if (isNull) {
    if (!contract.nullable) {
      diagnostics.push(
        diag(codes.BODY_NULL_NOT_ALLOWED, "error", "record_body", file, `Section '${contract.name}' is not nullable but contains null marker`, {
          entity: entityName,
          field: contract.name,
          expected: "non-null content",
          actual: "null",
        }),
      );
    }
    return diagnostics;
  }

  // Empty content (no null marker, just whitespace)
  if (trimmed.length === 0) {
    diagnostics.push(
      diag(codes.BODY_EMPTY_MARKER, "error", "record_body", file, `Section '${contract.name}' is empty — use explicit null marker if nullable`, {
        entity: entityName,
        field: contract.name,
        expected: contract.nullable ? "content or explicit null" : "content",
        actual: "empty",
      }),
    );
    return diagnostics;
  }

  // Value type check (simple heuristic per TODO item 13)
  const contentType = classifyContent(trimmed);

  if (contract.value_type === "markdown_string" && contentType === "list") {
    diagnostics.push(
      diag(codes.BODY_VALUE_TYPE, "error", "record_body", file, `Section '${contract.name}' expects prose but contains only list items`, {
        entity: entityName,
        field: contract.name,
        expected: "markdown_string (prose)",
        actual: "markdown_list",
      }),
    );
  } else if (contract.value_type === "markdown_list" && contentType === "prose") {
    diagnostics.push(
      diag(codes.BODY_VALUE_TYPE, "error", "record_body", file, `Section '${contract.name}' expects a list but contains prose`, {
        entity: entityName,
        field: contract.name,
        expected: "markdown_list",
        actual: "markdown_string (prose)",
      }),
    );
  }
  // markdown_string_or_list accepts anything

  return diagnostics;
}

// Simple content type classification.
// Returns "list" if all non-empty lines start with list markers (- or *).
// Returns "prose" if no lines are list items.
// Returns "mixed" if both are present.
function classifyContent(content: string): "list" | "prose" | "mixed" {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return "prose";

  let listLines = 0;
  let proseLines = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || /^\d+\.\s/.test(trimmed)) {
      listLines++;
    } else {
      proseLines++;
    }
  }

  if (listLines > 0 && proseLines === 0) return "list";
  if (proseLines > 0 && listLines === 0) return "prose";
  return "mixed";
}
