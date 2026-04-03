import { z } from "zod";
import { parsePathTemplate } from "./parser/path-template.ts";

const entityName = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const fieldName = z.string().regex(/^[a-z][a-z0-9_]*$/);
const moduleMountPath = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*$/);
const nonEmptyString = z.string().min(1);
const positiveInt = z.number().int().positive();

export interface GuidanceShape {
  include?: string;
  exclude?: string;
}

export interface CountConstraintShape {
  min_count?: number;
  max_count?: number;
}

export interface ItemConstraintShape {
  min_items?: number;
  max_items?: number;
}

export interface HeadingConstraintShape {
  min_depth?: number;
  max_depth?: number;
}

export interface CodeConstraintShape {
  require_language?: boolean;
}

export interface TableBlockShape {
  syntax: "gfm";
}

export interface FreeformBlocksShape {
  paragraph?: CountConstraintShape;
  bullet_list?: ItemConstraintShape;
  ordered_list?: ItemConstraintShape;
  table?: TableBlockShape;
  heading?: HeadingConstraintShape;
  blockquote?: CountConstraintShape;
  code?: CodeConstraintShape;
}

export interface FreeformContentShape {
  mode: "freeform";
  blocks: FreeformBlocksShape;
}

export type TitleTemplatePartShape =
  | { kind: "field"; field: string }
  | { kind: "literal"; value: string };

export type TitleSourceShape =
  | { kind: "field"; field: string }
  | { kind: "authored" }
  | { kind: "template"; parts: TitleTemplatePartShape[] };

export interface TitleShape {
  source: TitleSourceShape;
}

export type ContentShape = FreeformContentShape | OutlineContentShape;

export interface BodyRegionShape {
  allow_null: boolean;
  content: ContentShape;
  guidance?: GuidanceShape;
}

export interface OutlineNodeShape {
  heading: {
    depth: number;
    text: string;
  };
  content: FreeformContentShape;
}

export interface OutlineContentShape {
  mode: "outline";
  preamble?: BodyRegionShape;
  nodes: OutlineNodeShape[];
}

export interface SectionShape extends BodyRegionShape {
  name: string;
}

export type SectionDefinitionShape = BodyRegionShape;

export interface SharedBodyShape {
  title?: TitleShape;
  preamble?: BodyRegionShape;
}

export interface BodyShape extends SharedBodyShape {
  sections: SectionShape[];
}

export interface JsonlRowsShape {
  fields: Record<string, JsonlRowFieldShape>;
}

export function splitModuleMountPath(modulePath: string): string[] {
  return modulePath.split("/");
}

export function isPathPrefix(prefix: string[], full: string[]): boolean {
  if (prefix.length > full.length) return false;

  for (let index = 0; index < prefix.length; index += 1) {
    if (prefix[index] !== full[index]) {
      return false;
    }
  }

  return true;
}

export function modulePathsOverlap(left: string[], right: string[]): boolean {
  return isPathPrefix(left, right) || isPathPrefix(right, left);
}

const targetSchema = z.object({
  module: entityName,
  entity: entityName,
});

const filePathBaseSchema = z.enum(["system_root", "host_absolute"]);

const commonFieldShape = {
  allow_null: z.boolean(),
};

const allowedValuesSchema = z.array(nonEmptyString).min(1).superRefine((value, ctx) => {
  const seenValues = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (seenValues.has(entry)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate allowed value ${entry}`,
        path: [index],
      });
    }
    seenValues.add(entry);
  }
});

const listItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("string"),
  }),
  z.object({
    type: z.literal("enum"),
    allowed_values: allowedValuesSchema,
  }),
  z.object({
    type: z.literal("ref"),
    target: targetSchema,
  }),
  z.object({
    type: z.literal("file_path"),
    base: filePathBaseSchema,
  }),
]);

const jsonlRowListItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("string"),
  }),
  z.object({
    type: z.literal("enum"),
    allowed_values: allowedValuesSchema,
  }),
]);

const fieldSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("id"),
    allow_null: z.literal(false),
  }),
  z.object({
    type: z.literal("string"),
    ...commonFieldShape,
  }),
  z.object({
    type: z.literal("number"),
    ...commonFieldShape,
  }),
  z.object({
    type: z.literal("date"),
    ...commonFieldShape,
  }),
  z.object({
    type: z.literal("enum"),
    ...commonFieldShape,
    allowed_values: allowedValuesSchema,
  }),
  z.object({
    type: z.literal("ref"),
    ...commonFieldShape,
    target: targetSchema,
  }),
  z.object({
    type: z.literal("file_path"),
    ...commonFieldShape,
    base: filePathBaseSchema,
  }),
  z.object({
    type: z.literal("list"),
    ...commonFieldShape,
    items: listItemSchema,
  }),
]);

const jsonlRowFieldSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("string"),
    ...commonFieldShape,
  }),
  z.object({
    type: z.literal("number"),
    ...commonFieldShape,
  }),
  z.object({
    type: z.literal("date"),
    ...commonFieldShape,
  }),
  z.object({
    type: z.literal("enum"),
    ...commonFieldShape,
    allowed_values: allowedValuesSchema,
  }),
  z.object({
    type: z.literal("list"),
    ...commonFieldShape,
    items: jsonlRowListItemSchema,
  }),
]);

const headingDepth = z.number().int().min(1).max(6);

const guidanceSchema: z.ZodType<GuidanceShape> = z.object({
  include: nonEmptyString.optional(),
  exclude: nonEmptyString.optional(),
}).superRefine((value, ctx) => {
  if (!value.include && !value.exclude) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "guidance must include at least one of include or exclude",
    });
  }
});

const countConstraintSchema: z.ZodType<CountConstraintShape> = z.object({
  min_count: positiveInt.optional(),
  max_count: positiveInt.optional(),
}).superRefine((value, ctx) => {
  if (value.min_count !== undefined && value.max_count !== undefined && value.min_count > value.max_count) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "min_count cannot be greater than max_count",
      path: ["min_count"],
    });
  }
});

const itemConstraintSchema: z.ZodType<ItemConstraintShape> = z.object({
  min_items: positiveInt.optional(),
  max_items: positiveInt.optional(),
}).superRefine((value, ctx) => {
  if (value.min_items !== undefined && value.max_items !== undefined && value.min_items > value.max_items) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "min_items cannot be greater than max_items",
      path: ["min_items"],
    });
  }
});

const headingConstraintSchema: z.ZodType<HeadingConstraintShape> = z.object({
  min_depth: headingDepth.optional(),
  max_depth: headingDepth.optional(),
}).superRefine((value, ctx) => {
  if (value.min_depth !== undefined && value.max_depth !== undefined && value.min_depth > value.max_depth) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "min_depth cannot be greater than max_depth",
      path: ["min_depth"],
    });
  }
});

const codeConstraintSchema: z.ZodType<CodeConstraintShape> = z.object({
  require_language: z.boolean().optional(),
});

const tableBlockSchema: z.ZodType<TableBlockShape> = z.object({
  syntax: z.literal("gfm"),
});

const freeformBlocksSchema: z.ZodType<FreeformBlocksShape> = z.object({
  paragraph: countConstraintSchema.optional(),
  bullet_list: itemConstraintSchema.optional(),
  ordered_list: itemConstraintSchema.optional(),
  table: tableBlockSchema.optional(),
  heading: headingConstraintSchema.optional(),
  blockquote: countConstraintSchema.optional(),
  code: codeConstraintSchema.optional(),
}).superRefine((value, ctx) => {
  if (Object.keys(value).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "freeform content must declare at least one block type",
      path: ["blocks"],
    });
  }
});

const freeformContentSchema: z.ZodType<FreeformContentShape> = z.object({
  mode: z.literal("freeform"),
  blocks: freeformBlocksSchema,
});

const titleTemplatePartSchema: z.ZodType<TitleTemplatePartShape> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("field"),
    field: fieldName,
  }),
  z.object({
    kind: z.literal("literal"),
    value: nonEmptyString,
  }),
]);

const titleSourceSchema: z.ZodType<TitleSourceShape> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("field"),
    field: fieldName,
  }),
  z.object({
    kind: z.literal("authored"),
  }),
  z.object({
    kind: z.literal("template"),
    parts: z.array(titleTemplatePartSchema).min(1),
  }),
]);

const titleSchema: z.ZodType<TitleShape> = z.object({
  source: titleSourceSchema,
});

let regionDefinitionSchema: z.ZodType<BodyRegionShape>;
let contentSchema: z.ZodType<ContentShape>;

const outlineNodeSchema: z.ZodType<OutlineNodeShape> = z.object({
  heading: z.object({
    depth: headingDepth,
    text: nonEmptyString,
  }),
  content: freeformContentSchema,
});

const outlineContentSchema: z.ZodType<OutlineContentShape> = z.lazy(() => z.object({
  mode: z.literal("outline"),
  preamble: regionDefinitionSchema.optional(),
  nodes: z.array(outlineNodeSchema).min(1),
}));

contentSchema = z.lazy(() => z.union([freeformContentSchema, outlineContentSchema]));

regionDefinitionSchema = z.lazy(() => z.object({
  allow_null: z.boolean(),
  content: contentSchema,
  guidance: guidanceSchema.optional(),
}));

const sectionSchema: z.ZodType<SectionShape> = z.lazy(() => z.object({
  name: nonEmptyString,
  allow_null: z.boolean(),
  content: contentSchema,
  guidance: guidanceSchema.optional(),
}));

const sharedBodySchema: z.ZodType<SharedBodyShape> = z.object({
  title: titleSchema.optional(),
  preamble: regionDefinitionSchema.optional(),
});

const plainBodySchema: z.ZodType<BodyShape> = sharedBodySchema.extend({
  sections: z.array(sectionSchema).min(1),
});

const sectionDefinitionSchema: z.ZodType<SectionDefinitionShape> = regionDefinitionSchema;

const variantSchema = z.object({
  fields: z.record(fieldName, fieldSchema),
  sections: z.array(nonEmptyString).min(1),
}).superRefine((value, ctx) => {
  const seenSectionNames = new Set<string>();
  for (const [index, sectionName] of value.sections.entries()) {
    if (seenSectionNames.has(sectionName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate variant section name ${sectionName}`,
        path: ["sections", index],
      });
    }
    seenSectionNames.add(sectionName);
  }
});

const markdownEntityBaseSchema = z.object({
  source_format: z.literal("markdown"),
  path: nonEmptyString,
  identity: z.object({
    id_field: z.literal("id"),
    parent: z.object({
      entity: entityName,
      ref_field: fieldName,
    }).optional(),
  }),
  fields: z.record(fieldName, fieldSchema),
}).passthrough();

const plainMarkdownEntitySchema = markdownEntityBaseSchema.extend({
  body: plainBodySchema,
});

const variantMarkdownEntitySchema = markdownEntityBaseSchema.extend({
  discriminator: fieldName,
  body: sharedBodySchema.optional(),
  section_definitions: z.record(nonEmptyString, sectionDefinitionSchema),
  variants: z.record(nonEmptyString, variantSchema),
});

const markdownEntitySchema = z.union([plainMarkdownEntitySchema, variantMarkdownEntitySchema]).superRefine((value, ctx) => {
  if (!("id" in value.fields) || value.fields.id.type !== "id") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "entity.fields must declare id as type=id",
      path: ["fields", "id"],
    });
  }

  if (!value.path.includes("{id}")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "entity.path must contain {id}",
      path: ["path"],
    });
  }

  if (!value.path.endsWith(".md")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "markdown entity paths must end with .md",
      path: ["path"],
    });
  }

  if ("rows" in value) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "markdown entities must not declare rows",
      path: ["rows"],
    });
  }

  if (value.body?.title) {
    validateTitleSource(value.body.title.source, value.fields, ctx, ["body", "title", "source"]);
  }

  if (!("discriminator" in value)) {
    const seenSectionNames = new Set<string>();
    for (const section of value.body.sections) {
      if (seenSectionNames.has(section.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate section name ${section.name}`,
          path: ["body", "sections"],
        });
      }
      seenSectionNames.add(section.name);
    }
  } else {
    const discriminatorField = value.fields[value.discriminator];
    if (!discriminatorField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `discriminator field ${value.discriminator} is not declared`,
        path: ["discriminator"],
      });
    } else if (discriminatorField.type !== "enum") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `discriminator field ${value.discriminator} must be type=enum`,
        path: ["discriminator"],
      });
    } else {
      if (discriminatorField.allow_null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `discriminator field ${value.discriminator} must be non-null`,
          path: ["discriminator"],
        });
      }

      const expectedVariants = new Set(discriminatorField.allowed_values);
      const actualVariants = new Set(Object.keys(value.variants));
      for (const variantName of discriminatorField.allowed_values) {
        if (!actualVariants.has(variantName)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `missing variant ${variantName} for discriminator field ${value.discriminator}`,
            path: ["variants", variantName],
          });
        }
      }
      for (const variantName of Object.keys(value.variants)) {
        if (!expectedVariants.has(variantName)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `variant ${variantName} is not declared in discriminator enum ${value.discriminator}`,
            path: ["variants", variantName],
          });
        }
      }
    }

    for (const [variantName, variant] of Object.entries(value.variants)) {
      for (const fieldName of Object.keys(variant.fields)) {
        if (fieldName in value.fields) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `variant field ${variantName}.${fieldName} collides with root field ${fieldName}`,
            path: ["variants", variantName, "fields", fieldName],
          });
        }
      }

      for (const [index, sectionName] of variant.sections.entries()) {
        if (!(sectionName in value.section_definitions)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `variant ${variantName} references unknown section definition ${sectionName}`,
            path: ["variants", variantName, "sections", index],
          });
        }
      }
    }
  }

  if (value.identity.parent) {
    const parentField = value.fields[value.identity.parent.ref_field];
    if (!parentField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `parent ref field ${value.identity.parent.ref_field} is not declared`,
        path: ["identity", "parent", "ref_field"],
      });
    } else if (parentField.type !== "ref") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `parent ref field ${value.identity.parent.ref_field} must be type=ref`,
        path: ["identity", "parent", "ref_field"],
      });
    } else if (parentField.allow_null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `parent ref field ${value.identity.parent.ref_field} must be non-null`,
        path: ["identity", "parent", "ref_field"],
      });
    }
  }
});

const jsonlRowsSchema: z.ZodType<JsonlRowsShape> = z.object({
  fields: z.record(fieldName, jsonlRowFieldSchema),
}).superRefine((value, ctx) => {
  if (Object.keys(value.fields).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "jsonl rows.fields must declare at least one field",
      path: ["fields"],
    });
  }
});

const jsonlEntitySchema = z.object({
  source_format: z.literal("jsonl"),
  path: nonEmptyString,
  rows: jsonlRowsSchema,
}).passthrough().superRefine((value, ctx) => {
  if (!value.path.includes("{id}")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "entity.path must contain {id}",
      path: ["path"],
    });
  }

  if (!value.path.endsWith(".jsonl")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "jsonl entity paths must end with .jsonl",
      path: ["path"],
    });
  }

  for (const forbiddenKey of ["identity", "fields", "body", "discriminator", "section_definitions", "variants"]) {
    if (forbiddenKey in value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `jsonl entities must not declare ${forbiddenKey}`,
        path: [forbiddenKey],
      });
    }
  }
});

const entitySourceFormatGateSchema = z.object({
  source_format: z.unknown().optional(),
}).passthrough().superRefine((value, ctx) => {
  if (value.source_format === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "entity.source_format is required",
      path: ["source_format"],
    });
    return;
  }

  if (value.source_format !== "markdown" && value.source_format !== "jsonl") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "entity.source_format must be one of: markdown, jsonl",
      path: ["source_format"],
    });
  }
});

// This stays as a gate-plus-pipe instead of a discriminatedUnion because ALS has
// two markdown entity subshapes that both legitimately use source_format=markdown.
const entitySchema = entitySourceFormatGateSchema.pipe(z.union([markdownEntitySchema, jsonlEntitySchema]));

export const moduleShapeSchema = z.object({
  dependencies: z.array(z.object({
    module: entityName,
  })),
  entities: z.record(entityName, entitySchema),
}).superRefine((value, ctx) => {
  const seenDependencies = new Set<string>();
  for (const dependency of value.dependencies) {
    const key = dependency.module;
    if (seenDependencies.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate dependency ${key}`,
        path: ["dependencies"],
      });
    }
    seenDependencies.add(key);
  }

  for (const [entityKey, entity] of Object.entries(value.entities)) {
    if (entity.source_format === "markdown") {
      if (entity.identity.parent && !value.entities[entity.identity.parent.entity]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `parent entity ${entity.identity.parent.entity} is not declared`,
          path: ["entities", entityKey, "identity", "parent", "entity"],
        });
      } else if (
        entity.identity.parent
        && value.entities[entity.identity.parent.entity]
        && value.entities[entity.identity.parent.entity].source_format !== "markdown"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `markdown parent entity ${entity.identity.parent.entity} must also use source_format=markdown`,
          path: ["entities", entityKey, "identity", "parent", "entity"],
        });
      }
      continue;
    }

    const pathTemplate = parsePathTemplate(entity.path, entityKey);
    const seenAncestorNames = new Set<string>();
    for (const segment of pathTemplate.segments) {
      if (segment.kind !== "placeholder" || !segment.entity_name || segment.entity_name === entityKey) continue;
      if (seenAncestorNames.has(segment.entity_name)) continue;
      seenAncestorNames.add(segment.entity_name);

      if (!value.entities[segment.entity_name]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `jsonl path placeholder ${segment.entity_name} does not name a declared entity`,
          path: ["entities", entityKey, "path"],
        });
      }
    }
  }
});

const systemModuleConfigSchema = z.object({
  path: moduleMountPath,
  version: positiveInt,
  skills: z.array(entityName),
});

export type SystemModuleConfig = z.infer<typeof systemModuleConfigSchema>;

export const systemConfigSchema = z.object({
  als_version: positiveInt,
  system_id: nonEmptyString,
  modules: z.record(entityName, systemModuleConfigSchema),
}).superRefine((value, ctx) => {
  const seenModulePaths: Array<{ module_id: string; path: string; segments: string[] }> = [];
  const seenActiveSkills = new Map<string, { module_id: string }>();

  for (const [moduleId, moduleConfig] of Object.entries(value.modules)) {
    const modulePathSegments = splitModuleMountPath(moduleConfig.path);
    const overlappingModule = seenModulePaths.find((existing) => modulePathsOverlap(modulePathSegments, existing.segments));
    if (overlappingModule) {
      const issueMessage = moduleConfig.path === overlappingModule.path
        ? `module ${moduleId} duplicates module mount path ${moduleConfig.path} already used by ${overlappingModule.module_id}`
        : `module ${moduleId} mount path ${moduleConfig.path} overlaps with ${overlappingModule.module_id} at ${overlappingModule.path}`;

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: issueMessage,
        path: ["modules", moduleId, "path"],
      });
      continue;
    }

    seenModulePaths.push({
      module_id: moduleId,
      path: moduleConfig.path,
      segments: modulePathSegments,
    });

    const seenSkills = new Set<string>();
    moduleConfig.skills.forEach((skillId, skillIndex) => {
      if (seenSkills.has(skillId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate skill ${skillId}`,
          path: ["modules", moduleId, "skills", skillIndex],
        });
      }
      seenSkills.add(skillId);

      const firstOwner = seenActiveSkills.get(skillId);
      if (firstOwner && firstOwner.module_id !== moduleId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `active skill ${skillId} is already used by module ${firstOwner.module_id}`,
          path: ["modules", moduleId, "skills", skillIndex],
        });
        return;
      }

      if (!firstOwner) {
        seenActiveSkills.set(skillId, { module_id: moduleId });
      }
    });
  }
});

export type ModuleShape = z.infer<typeof moduleShapeSchema>;
export type SystemConfig = z.infer<typeof systemConfigSchema>;
export type EntityShape = z.infer<typeof entitySchema>;
export type MarkdownEntityShape = z.infer<typeof markdownEntitySchema>;
export type PlainEntityShape = z.infer<typeof plainMarkdownEntitySchema>;
export type VariantEntityShape = z.infer<typeof variantMarkdownEntitySchema>;
export type JsonlEntityShape = z.infer<typeof jsonlEntitySchema>;
export type EntityVariantShape = z.infer<typeof variantSchema>;
export type FilePathBase = z.infer<typeof filePathBaseSchema>;
export type FieldShape = z.infer<typeof fieldSchema>;
export type JsonlRowFieldShape = z.infer<typeof jsonlRowFieldSchema>;
export type JsonlRowListItemShape = z.infer<typeof jsonlRowListItemSchema>;

interface RawShapeIssue {
  path: Array<string | number>;
  message: string;
}

export function findLegacyRequiredIssues(raw: unknown): RawShapeIssue[] {
  const issues: RawShapeIssue[] = [];
  walkShapeValue(raw, [], issues);
  return issues;
}

function validateTitleSource(
  titleSource: z.infer<typeof titleSourceSchema>,
  fields: Record<string, z.infer<typeof fieldSchema>>,
  ctx: z.RefinementCtx,
  path: Array<string | number>,
): void {
  const referencedFields = collectTitleSourceFieldNames(titleSource);

  for (const referencedField of referencedFields) {
    const targetField = fields[referencedField];
    if (!targetField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `title source field ${referencedField} is not declared`,
        path,
      });
      continue;
    }

    if (targetField.type !== "id" && targetField.type !== "string") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `title source field ${referencedField} must be type=id or type=string`,
        path,
      });
    }

    if (targetField.allow_null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `title source field ${referencedField} must be non-null`,
        path,
      });
    }
  }
}

function collectTitleSourceFieldNames(titleSource: z.infer<typeof titleSourceSchema>): string[] {
  if (titleSource.kind === "field") {
    return [titleSource.field];
  }

  if (titleSource.kind === "template") {
    return titleSource.parts
      .filter((part): part is Extract<z.infer<typeof titleTemplatePartSchema>, { kind: "field" }> => part.kind === "field")
      .map((part) => part.field);
  }

  return [];
}

function walkShapeValue(
  value: unknown,
  path: Array<string | number>,
  issues: RawShapeIssue[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkShapeValue(item, path.concat(index), issues));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if ("required" in value) {
    issues.push({
      path: path.concat("required"),
      message: "legacy key 'required' is not allowed in ALS v1 shape files",
    });
  }

  for (const [key, nested] of Object.entries(value)) {
    walkShapeValue(nested, path.concat(key), issues);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
