import { z } from "zod";

const entityName = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const fieldName = z.string().regex(/^[a-z][a-z0-9_]*$/);
const nonEmptyString = z.string().min(1);
const positiveInt = z.number().int().positive();

const targetSchema = z.object({
  namespace: nonEmptyString,
  module: entityName,
  entity: entityName,
});

const commonFieldShape = {
  required: z.boolean(),
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
    required: z.literal(true),
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
  required: z.boolean(),
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

const entitySchema = z.object({
  path: nonEmptyString,
  identity: z.object({
    id_field: z.literal("id"),
    parent: z.object({
      entity: entityName,
      ref_field: fieldName,
    }).optional(),
  }),
  fields: z.record(fieldName, fieldSchema),
  sections: z.array(sectionSchema).min(1),
}).superRefine((value, ctx) => {
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
    } else if (!parentField.required || parentField.allow_null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `parent ref field ${value.identity.parent.ref_field} must be required and non-null`,
        path: ["identity", "parent", "ref_field"],
      });
    }
  }
});

export const moduleShapeSchema = z.object({
  schema: z.literal("pals-module@1"),
  module: z.object({
    id: entityName,
    namespace: nonEmptyString,
    root: nonEmptyString,
    version: positiveInt,
  }),
  dependencies: z.array(z.object({
    namespace: nonEmptyString,
    module: entityName,
  })),
  entities: z.record(entityName, entitySchema),
}).superRefine((value, ctx) => {
  const seenDependencies = new Set<string>();
  for (const dependency of value.dependencies) {
    const key = `${dependency.namespace}/${dependency.module}`;
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

    const fieldEntries = Object.entries(entity.fields);
    for (const [fieldKey, field] of fieldEntries) {
      if (field.type === "ref" && field.target.module !== value.module.id) {
        const dependencyKey = `${field.target.namespace}/${field.target.module}`;
        if (!seenDependencies.has(dependencyKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `cross-module ref ${fieldKey} targets undeclared dependency ${dependencyKey}`,
            path: ["entities", entityKey, "fields", fieldKey],
          });
        }
      }

      if (field.type === "list" && field.items.type === "ref" && field.items.target.module !== value.module.id) {
        const dependencyKey = `${field.items.target.namespace}/${field.items.target.module}`;
        if (!seenDependencies.has(dependencyKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `cross-module list ref ${fieldKey} targets undeclared dependency ${dependencyKey}`,
            path: ["entities", entityKey, "fields", fieldKey],
          });
        }
      }
    }
  }
});

export const systemConfigSchema = z.object({
  schema: z.literal("pals-system@1"),
  namespace: nonEmptyString,
  modules: z.record(entityName, z.object({
    root: nonEmptyString,
    deployed_version: positiveInt,
    shape: nonEmptyString,
    skill: nonEmptyString,
  })),
});

export type ModuleShape = z.infer<typeof moduleShapeSchema>;
export type SystemConfig = z.infer<typeof systemConfigSchema>;
export type EntityShape = z.infer<typeof entitySchema>;
export type FieldShape = z.infer<typeof fieldSchema>;
export type SectionShape = z.infer<typeof sectionSchema>;
