// Frontmatter validation — Phase 3 of the record validation pipeline.
// Validates a record's frontmatter fields against the entity's field declarations.

import type { CompilerDiagnostic, ShapeField, ShapeEntity } from "../types.js";
import { diag, codes } from "./diagnostics.js";
import { parseRefUri, type ParsedRef } from "./references.js";

export function validateFrontmatter(
  frontmatter: Record<string, unknown>,
  entity: ShapeEntity,
  file: string,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const entityName = entity.name;

  // Check declared field presence
  for (const [fieldName, fieldDef] of entity.fields) {
    if (!(fieldName in frontmatter)) {
      diagnostics.push(
        diag(codes.FM_MISSING_FIELD, "error", "record_frontmatter", file, `Missing declared frontmatter field '${fieldName}'`, {
          entity: entityName,
          field: fieldName,
          expected: fieldName,
          actual: null,
        }),
      );
    }
  }

  // Check for unknown fields
  for (const key of Object.keys(frontmatter)) {
    if (!entity.fields.has(key)) {
      diagnostics.push(
        diag(codes.FM_UNKNOWN_FIELD, "error", "record_frontmatter", file, `Unknown frontmatter field '${key}'`, {
          entity: entityName,
          field: key,
          expected: [...entity.fields.keys()],
          actual: key,
        }),
      );
    }
  }

  // Type checks per field
  for (const [fieldName, fieldDef] of entity.fields) {
    if (!(fieldName in frontmatter)) continue;
    const value = frontmatter[fieldName];

    const fieldDiags = validateFieldValue(value, fieldDef, fieldName, entityName, file);
    diagnostics.push(...fieldDiags);
  }

  return diagnostics;
}

function validateFieldValue(
  value: unknown,
  field: ShapeField,
  fieldName: string,
  entityName: string,
  file: string,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  // Handle null
  if (value === null || value === undefined) {
    if (field.kind === "id") {
      diagnostics.push(
        diag(codes.FM_TYPE_MISMATCH, "error", "record_frontmatter", file, `Field '${fieldName}' cannot be null`, {
          entity: entityName,
          field: fieldName,
          expected: "non-null id",
          actual: null,
        }),
      );
    } else if (field.kind !== "id" && !("nullable" in field && field.nullable)) {
      diagnostics.push(
        diag(codes.FM_TYPE_MISMATCH, "error", "record_frontmatter", file, `Field '${fieldName}' is not nullable but is null`, {
          entity: entityName,
          field: fieldName,
          expected: `non-null ${field.kind}`,
          actual: null,
        }),
      );
    }
    return diagnostics;
  }

  switch (field.kind) {
    case "id":
      if (typeof value !== "string" || value.length === 0) {
        diagnostics.push(
          diag(codes.FM_TYPE_MISMATCH, "error", "record_frontmatter", file, `Field '${fieldName}' must be a non-empty string`, {
            entity: entityName,
            field: fieldName,
            expected: "non-empty string",
            actual: typeof value,
          }),
        );
      }
      break;

    case "string":
      if (typeof value !== "string") {
        diagnostics.push(
          diag(codes.FM_TYPE_MISMATCH, "error", "record_frontmatter", file, `Field '${fieldName}' must be a string`, {
            entity: entityName,
            field: fieldName,
            expected: "string",
            actual: typeof value,
          }),
        );
      }
      break;

    case "number":
      if (typeof value !== "number") {
        diagnostics.push(
          diag(codes.FM_TYPE_MISMATCH, "error", "record_frontmatter", file, `Field '${fieldName}' must be a number`, {
            entity: entityName,
            field: fieldName,
            expected: "number",
            actual: typeof value,
          }),
        );
      }
      break;

    case "date":
      if (typeof value === "string") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          diagnostics.push(
            diag(codes.FM_DATE_FORMAT, "error", "record_frontmatter", file, `Field '${fieldName}' must be YYYY-MM-DD format`, {
              entity: entityName,
              field: fieldName,
              expected: "YYYY-MM-DD",
              actual: value,
            }),
          );
        }
      } else if (value instanceof Date) {
        // gray-matter auto-parses dates — we accept Date objects
      } else {
        diagnostics.push(
          diag(codes.FM_TYPE_MISMATCH, "error", "record_frontmatter", file, `Field '${fieldName}' must be a date`, {
            entity: entityName,
            field: fieldName,
            expected: "date string or Date",
            actual: typeof value,
          }),
        );
      }
      break;

    case "enum":
      if (typeof value !== "string") {
        diagnostics.push(
          diag(codes.FM_TYPE_MISMATCH, "error", "record_frontmatter", file, `Field '${fieldName}' must be a string`, {
            entity: entityName,
            field: fieldName,
            expected: "string",
            actual: typeof value,
          }),
        );
      } else if (!field.allowed.includes(value)) {
        diagnostics.push(
          diag(codes.FM_ENUM_INVALID, "error", "record_frontmatter", file, `Enum value '${value}' is not in allowed set`, {
            entity: entityName,
            field: fieldName,
            expected: field.allowed,
            actual: value,
            hint: `Set ${fieldName} to one of: ${field.allowed.join(", ")}`,
          }),
        );
      }
      break;

    case "ref":
      diagnostics.push(...validateRefValue(value, field, fieldName, entityName, file));
      break;

    case "ref_array":
      if (!Array.isArray(value)) {
        diagnostics.push(
          diag(codes.FM_TYPE_MISMATCH, "error", "record_frontmatter", file, `Field '${fieldName}' must be an array`, {
            entity: entityName,
            field: fieldName,
            expected: "array",
            actual: typeof value,
          }),
        );
      } else {
        for (let i = 0; i < value.length; i++) {
          diagnostics.push(
            ...validateRefValue(value[i], field, `${fieldName}[${i}]`, entityName, file),
          );
        }
      }
      break;

    case "string_array":
      if (!Array.isArray(value)) {
        diagnostics.push(
          diag(codes.FM_TYPE_MISMATCH, "error", "record_frontmatter", file, `Field '${fieldName}' must be an array`, {
            entity: entityName,
            field: fieldName,
            expected: "array",
            actual: typeof value,
          }),
        );
      } else {
        for (let i = 0; i < value.length; i++) {
          if (typeof value[i] !== "string") {
            diagnostics.push(
              diag(codes.FM_ARRAY_ITEM, "error", "record_frontmatter", file, `Array item ${fieldName}[${i}] must be a string`, {
                entity: entityName,
                field: `${fieldName}[${i}]`,
                expected: "string",
                actual: typeof value[i],
              }),
            );
          }
        }
      }
      break;
  }

  return diagnostics;
}

function validateRefValue(
  value: unknown,
  field: { target_module?: string; target_entity: string },
  fieldName: string,
  entityName: string,
  file: string,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  if (typeof value !== "string") {
    diagnostics.push(
      diag(codes.FM_REF_FORMAT, "error", "record_frontmatter", file, `Field '${fieldName}' must be a markdown link ref string`, {
        entity: entityName,
        field: fieldName,
        expected: "[display](pals://...)",
        actual: typeof value,
      }),
    );
    return diagnostics;
  }

  const parsed = parseRefUri(value);
  if (!parsed) {
    diagnostics.push(
      diag(codes.FM_REF_FORMAT, "error", "record_frontmatter", file, `Field '${fieldName}' is not a valid ref link: ${value}`, {
        entity: entityName,
        field: fieldName,
        expected: "[display](pals://namespace/module/entity/id)",
        actual: value,
      }),
    );
  }

  return diagnostics;
}
