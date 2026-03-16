// Parses SHAPE.yaml field shorthand notation into ShapeField types.
//
// Grammar:
//   field_type  = base_type modifier*
//   base_type   = "id" | "string" | "number" | "date" | enum_type | ref_type
//   enum_type   = "enum(" value ("," value)* ")"
//   ref_type    = "ref(" ref_target ")"
//   ref_target  = entity_name | module "/" entity_name
//   modifier    = "?" | "[]"
//
// Examples:
//   "string"              -> { kind: "string", nullable: false }
//   "string?"             -> { kind: "string", nullable: true }
//   "enum(draft, active)" -> { kind: "enum", nullable: false, allowed: ["draft", "active"] }
//   "ref(epic)"           -> { kind: "ref", nullable: false, target_entity: "epic", is_array: false }
//   "ref(people/person)[]?" -> { kind: "ref_array", nullable: true, target_module: "people", target_entity: "person" }
//   "string[]?"           -> { kind: "string_array", nullable: true }

import type { ShapeField, BodyValueType } from "../types.js";

export function parseFieldShorthand(input: string): ShapeField {
  let s = input.trim();

  // Extract trailing modifiers
  const nullable = s.endsWith("?");
  if (nullable) s = s.slice(0, -1);

  const isArray = s.endsWith("[]");
  if (isArray) s = s.slice(0, -2);

  // Parse base type
  if (s === "id") {
    if (isArray || nullable) {
      throw new Error(`"id" fields cannot be nullable or arrays: "${input}"`);
    }
    return { kind: "id" };
  }

  if (s === "string") {
    if (isArray) return { kind: "string_array", nullable };
    return { kind: "string", nullable };
  }

  if (s === "number") {
    if (isArray) throw new Error(`number arrays not supported: "${input}"`);
    return { kind: "number", nullable };
  }

  if (s === "date") {
    if (isArray) throw new Error(`date arrays not supported: "${input}"`);
    return { kind: "date", nullable };
  }

  // enum(value1, value2, ...)
  const enumMatch = s.match(/^enum\((.+)\)$/);
  if (enumMatch) {
    if (isArray) throw new Error(`enum arrays not supported: "${input}"`);
    const allowed = enumMatch[1].split(",").map((v) => v.trim());
    if (allowed.length === 0 || allowed.some((v) => v === "")) {
      throw new Error(`enum must have at least one non-empty value: "${input}"`);
    }
    return { kind: "enum", nullable, allowed };
  }

  // ref(target) or ref(module/entity)
  const refMatch = s.match(/^ref\((.+)\)$/);
  if (refMatch) {
    const target = refMatch[1].trim();
    const parts = target.split("/");
    if (parts.length === 1) {
      // same-module ref
      if (isArray) return { kind: "ref_array", nullable, target_entity: parts[0] };
      return { kind: "ref", nullable, target_entity: parts[0], is_array: false };
    }
    if (parts.length === 2) {
      // cross-module ref
      if (isArray)
        return { kind: "ref_array", nullable, target_module: parts[0], target_entity: parts[1] };
      return {
        kind: "ref",
        nullable,
        target_module: parts[0],
        target_entity: parts[1],
        is_array: false,
      };
    }
    throw new Error(`ref target must be "entity" or "module/entity": "${input}"`);
  }

  throw new Error(`unknown field type: "${input}"`);
}

export function parseBodyType(input: string): { value_type: BodyValueType; nullable: boolean } {
  let s = input.trim();

  const nullable = s.endsWith("?");
  if (nullable) s = s.slice(0, -1);

  const mapping: Record<string, BodyValueType> = {
    prose: "markdown_string",
    list: "markdown_list",
    "prose|list": "markdown_string_or_list",
  };

  const value_type = mapping[s];
  if (!value_type) {
    throw new Error(`unknown body type: "${input}" (expected prose, list, or prose|list)`);
  }

  return { value_type, nullable };
}
