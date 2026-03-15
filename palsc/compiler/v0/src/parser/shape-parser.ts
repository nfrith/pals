// Parses a SHAPE.yaml file into the internal ShapeModule model.

import { parse as parseYaml } from "yaml";
import { readFileSync } from "node:fs";
import type {
  ShapeModule,
  ShapeEntity,
  ShapeField,
  ShapeBodySection,
  ExternalModuleRef,
} from "../types.js";
import { parseFieldShorthand } from "./field-shorthand.js";
import { parseBodyType } from "./field-shorthand.js";

export function parseShapeFile(file_path: string): ShapeModule {
  const content = readFileSync(file_path, "utf-8");
  return parseShapeYaml(content);
}

export function parseShapeYaml(content: string): ShapeModule {
  const raw = parseYaml(content);

  if (!raw || typeof raw !== "object") {
    throw new Error("SHAPE.yaml must be a YAML object");
  }

  const module_id = requireString(raw, "module");
  const namespace = requireString(raw, "namespace");
  const version = requirePositiveInt(raw, "version");

  // Parse refs: string[] like ["workspace/people"]
  const refs = parseRefs(raw.refs);

  // Parse entities
  const entities = new Map<string, ShapeEntity>();
  const rawEntities = raw.entities;
  if (!rawEntities || typeof rawEntities !== "object") {
    throw new Error("SHAPE.yaml must have an 'entities' object");
  }

  for (const [name, def] of Object.entries(rawEntities)) {
    entities.set(name, parseEntity(name, def as Record<string, unknown>));
  }

  return { module_id, namespace, version, refs, entities };
}

function parseRefs(raw: unknown): ExternalModuleRef[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error("'refs' must be an array");
  return raw.map((r) => {
    if (typeof r !== "string") throw new Error("each ref must be a string like 'namespace/module'");
    const parts = r.split("/");
    if (parts.length !== 2) throw new Error(`ref must be 'namespace/module', got: "${r}"`);
    return { namespace: parts[0], module_id: parts[1] };
  });
}

function parseEntity(name: string, raw: Record<string, unknown>): ShapeEntity {
  const path_template = requireString(raw, "path");

  // Parse parent: "epic via epic_ref"
  let parent: ShapeEntity["parent"] = undefined;
  if (raw.parent !== undefined) {
    const parentStr = requireString(raw, "parent");
    const match = parentStr.match(/^(\S+)\s+via\s+(\S+)$/);
    if (!match) {
      throw new Error(`parent must be 'entity via field', got: "${parentStr}"`);
    }
    parent = { entity: match[1], via_field: match[2] };
  }

  // Parse fields
  const fields = new Map<string, ShapeField>();
  const rawFields = raw.fields;
  if (!rawFields || typeof rawFields !== "object") {
    throw new Error(`entity '${name}' must have a 'fields' object`);
  }
  for (const [fieldName, fieldType] of Object.entries(rawFields as Record<string, unknown>)) {
    if (typeof fieldType !== "string") {
      throw new Error(`field '${name}.${fieldName}' must be a type string`);
    }
    fields.set(fieldName, parseFieldShorthand(fieldType));
  }

  // Parse body sections
  const body_sections = new Map<string, ShapeBodySection>();
  const rawBody = raw.body;
  if (rawBody !== undefined) {
    if (typeof rawBody !== "object" || rawBody === null) {
      throw new Error(`entity '${name}' body must be an object`);
    }
    for (const [sectionName, sectionType] of Object.entries(rawBody as Record<string, unknown>)) {
      if (typeof sectionType !== "string") {
        throw new Error(`body section '${name}.${sectionName}' must be a type string`);
      }
      const parsed = parseBodyType(sectionType);
      body_sections.set(sectionName, { name: sectionName, ...parsed });
    }
  }

  return { name, path_template, parent, fields, body_sections };
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const val = obj[key];
  if (typeof val !== "string" || val.length === 0) {
    throw new Error(`'${key}' must be a non-empty string`);
  }
  return val;
}

function requirePositiveInt(obj: Record<string, unknown>, key: string): number {
  const val = obj[key];
  if (typeof val !== "number" || !Number.isInteger(val) || val < 1) {
    throw new Error(`'${key}' must be a positive integer`);
  }
  return val;
}
