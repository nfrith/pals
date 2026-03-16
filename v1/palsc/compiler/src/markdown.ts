import { fromMarkdown } from "mdast-util-from-markdown";
import { codes, diag } from "./diagnostics.ts";
import type { SectionShape } from "./schema.ts";
import type { CompilerDiagnostic } from "./types.ts";

export interface ParsedBodySection {
  name: string;
  content: string;
}

export interface ParsedBody {
  ordered: ParsedBodySection[];
  by_name: Map<string, string>;
}

export function parseBodySections(body: string): ParsedBody {
  const ordered: ParsedBodySection[] = [];
  const by_name = new Map<string, string>();
  const lines = body.split("\n");

  let currentHeading: string | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^## (.+)$/);
    if (headingMatch) {
      if (currentHeading !== null) {
        const content = currentContent.join("\n").trim();
        ordered.push({ name: currentHeading, content });
        by_name.set(currentHeading, content);
      }
      currentHeading = headingMatch[1];
      currentContent = [];
      continue;
    }

    if (currentHeading !== null) {
      currentContent.push(line);
    }
  }

  if (currentHeading !== null) {
    const content = currentContent.join("\n").trim();
    ordered.push({ name: currentHeading, content });
    by_name.set(currentHeading, content);
  }

  return { ordered, by_name };
}

export function validateSectionMarkdown(
  section: SectionShape,
  content: string,
  file: string,
  module_id: string,
  entity: string,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const trimmed = content.trim();

  if (trimmed === "null") {
    if (!section.allow_null) {
      diagnostics.push(
        diag(codes.BODY_NULL_NOT_ALLOWED, "error", "record_body", file, `Section '${section.name}' is not nullable but contains null`, {
          module_id,
          entity,
          field: section.name,
          expected: "non-null content",
          actual: "null",
        }),
      );
    }
    return diagnostics;
  }

  if (trimmed.length === 0) {
    diagnostics.push(
      diag(codes.BODY_EMPTY_MARKER, "error", "record_body", file, `Section '${section.name}' is empty`, {
        module_id,
        entity,
        field: section.name,
        expected: section.allow_null ? "content or explicit null" : "content",
        actual: "empty",
      }),
    );
    return diagnostics;
  }

  const tree = fromMarkdown(trimmed) as { children?: Array<Record<string, unknown>> };

  walkNode(tree, (node) => {
    if (node.type === "heading" && !section.content.allow_subheadings) {
      diagnostics.push(
        diag(codes.BODY_CONSTRAINT_VIOLATION, "error", "record_body", file, `Subheadings are not allowed in section '${section.name}'`, {
          module_id,
          entity,
          field: section.name,
          expected: { allow_subheadings: false },
          actual: node.type,
        }),
      );
    }

    if (node.type === "blockquote" && !section.content.allow_blockquotes) {
      diagnostics.push(
        diag(codes.BODY_CONSTRAINT_VIOLATION, "error", "record_body", file, `Blockquotes are not allowed in section '${section.name}'`, {
          module_id,
          entity,
          field: section.name,
          expected: { allow_blockquotes: false },
          actual: node.type,
        }),
      );
    }

    if (node.type === "code" && !section.content.allow_code_blocks) {
      diagnostics.push(
        diag(codes.BODY_CONSTRAINT_VIOLATION, "error", "record_body", file, `Code blocks are not allowed in section '${section.name}'`, {
          module_id,
          entity,
          field: section.name,
          expected: { allow_code_blocks: false },
          actual: node.type,
        }),
      );
    }
  });

  for (const child of tree.children ?? []) {
    const blockName = topLevelBlockName(child);
    if (blockName && section.content.allowed_blocks.includes(blockName)) {
      continue;
    }

    if (child.type === "heading" && section.content.allow_subheadings) {
      continue;
    }

    if (child.type === "blockquote" && section.content.allow_blockquotes) {
      continue;
    }

    if (child.type === "code" && section.content.allow_code_blocks) {
      continue;
    }

    diagnostics.push(
      diag(codes.BODY_CONSTRAINT_VIOLATION, "error", "record_body", file, `Section '${section.name}' contains unsupported markdown block '${String(child.type)}'`, {
        module_id,
        entity,
        field: section.name,
        expected: {
          allowed_blocks: section.content.allowed_blocks,
          allow_subheadings: section.content.allow_subheadings,
          allow_blockquotes: section.content.allow_blockquotes,
          allow_code_blocks: section.content.allow_code_blocks,
        },
        actual: child.type,
      }),
    );
  }

  return dedupeDiagnostics(diagnostics);
}

function topLevelBlockName(node: Record<string, unknown>): "paragraph" | "bullet_list" | "ordered_list" | null {
  if (node.type === "paragraph") return "paragraph";
  if (node.type === "list") {
    return node.ordered === true ? "ordered_list" : "bullet_list";
  }
  return null;
}

function walkNode(node: Record<string, unknown>, visit: (node: Record<string, unknown>) => void): void {
  visit(node);
  const children = node.children;
  if (!Array.isArray(children)) return;
  for (const child of children) {
    if (child && typeof child === "object") {
      walkNode(child as Record<string, unknown>, visit);
    }
  }
}

function dedupeDiagnostics(diagnostics: CompilerDiagnostic[]): CompilerDiagnostic[] {
  const seen = new Set<string>();
  const deduped: CompilerDiagnostic[] = [];

  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}:${diagnostic.file}:${diagnostic.field}:${diagnostic.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(diagnostic);
  }

  return deduped;
}
