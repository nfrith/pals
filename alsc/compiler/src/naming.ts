import { z } from "zod";

export const kebabNameSchema = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
export const fieldNameSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);
export const nonEmptyStringSchema = z.string().min(1);
