import { z } from "zod";

const entityName = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const fieldName = z.string().regex(/^[a-z][a-z0-9_]*$/);
const nonEmptyString = z.string().min(1);
const positiveInt = z.number().int().positive();

const targetSchema = z.object({
  module: entityName,
  entity: entityName,
});

const commonFieldShape = {
  allow_null: z.boolean(),
};

const listItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("string"),
  }),
  z.object({
    type: z.literal("ref"),
    target: targetSchema,
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
    allowed_values: z.array(nonEmptyString).min(1),
  }),
  z.object({
    type: z.literal("ref"),
    ...commonFieldShape,
    target: targetSchema,
  }),
  z.object({
    type: z.literal("list"),
    ...commonFieldShape,
    items: listItemSchema,
  }),
]);

const sectionSchema = z.object({
  name: nonEmptyString,
  allow_null: z.boolean(),
  content: z.object({
    allowed_blocks: z.array(z.enum(["paragraph", "bullet_list", "ordered_list"])).min(1),
    allow_subheadings: z.boolean(),
    allow_blockquotes: z.boolean(),
    allow_code_blocks: z.boolean(),
  }),
  guidance: z.object({
    include: nonEmptyString,
    exclude: nonEmptyString,
  }),
});

const sectionDefinitionSchema = z.object({
  allow_null: z.boolean(),
  content: z.object({
    allowed_blocks: z.array(z.enum(["paragraph", "bullet_list", "ordered_list"])).min(1),
    allow_subheadings: z.boolean(),
    allow_blockquotes: z.boolean(),
    allow_code_blocks: z.boolean(),
  }),
  guidance: z.object({
    include: nonEmptyString,
    exclude: nonEmptyString,
  }),
});

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

const entityBaseSchema = z.object({
  path: nonEmptyString,
  identity: z.object({
    id_field: z.literal("id"),
    parent: z.object({
      entity: entityName,
      ref_field: fieldName,
    }).optional(),
  }),
  fields: z.record(fieldName, fieldSchema),
});

const plainEntitySchema = entityBaseSchema.extend({
  sections: z.array(sectionSchema).min(1),
});

const variantEntitySchema = entityBaseSchema.extend({
  discriminator: fieldName,
  section_definitions: z.record(nonEmptyString, sectionDefinitionSchema),
  variants: z.record(nonEmptyString, variantSchema),
});

const entitySchema = z.union([plainEntitySchema, variantEntitySchema]).superRefine((value, ctx) => {
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

  if ("sections" in value) {
    const seenSectionNames = new Set<string>();
    for (const section of value.sections) {
      if (seenSectionNames.has(section.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate section name ${section.name}`,
          path: ["sections"],
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

export const moduleShapeSchema = z.object({
  schema: z.literal("pals-module@1"),
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
    if (entity.identity.parent && !value.entities[entity.identity.parent.entity]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `parent entity ${entity.identity.parent.entity} is not declared`,
        path: ["entities", entityKey, "identity", "parent", "entity"],
      });
    }
  }
});

export const systemConfigSchema = z.object({
  schema: z.literal("pals-system@1"),
  system_id: nonEmptyString,
  roots: z.array(entityName).min(1),
  modules: z.record(entityName, z.object({
    root: entityName,
    dir: entityName,
    version: positiveInt,
    skill: nonEmptyString,
  })),
}).superRefine((value, ctx) => {
  const seenRoots = new Set<string>();
  for (const [index, rootName] of value.roots.entries()) {
    if (seenRoots.has(rootName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate root ${rootName}`,
        path: ["roots", index],
      });
    }
    seenRoots.add(rootName);
  }

  for (const [moduleId, moduleConfig] of Object.entries(value.modules)) {
    if (!seenRoots.has(moduleConfig.root)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `module ${moduleId} references unknown root ${moduleConfig.root}`,
        path: ["modules", moduleId, "root"],
      });
    }
  }
});

export type ModuleShape = z.infer<typeof moduleShapeSchema>;
export type SystemConfig = z.infer<typeof systemConfigSchema>;
export type EntityShape = z.infer<typeof entitySchema>;
export type PlainEntityShape = z.infer<typeof plainEntitySchema>;
export type VariantEntityShape = z.infer<typeof variantEntitySchema>;
export type SectionDefinitionShape = z.infer<typeof sectionDefinitionSchema>;
export type EntityVariantShape = z.infer<typeof variantSchema>;
export type FieldShape = z.infer<typeof fieldSchema>;
export type SectionShape = z.infer<typeof sectionSchema>;

interface RawShapeIssue {
  path: Array<string | number>;
  message: string;
}

export function findLegacyRequiredIssues(raw: unknown): RawShapeIssue[] {
  const issues: RawShapeIssue[] = [];
  walkShapeValue(raw, [], issues);
  return issues;
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
      message: "legacy key 'required' is not allowed in pals-module@1",
    });
  }

  for (const [key, nested] of Object.entries(value)) {
    walkShapeValue(nested, path.concat(key), issues);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
