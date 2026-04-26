import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import matter from "gray-matter";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

export const OPERATOR_CONFIG_OUTPUT_SCHEMA = "als-operator-config-output@1";
export const OPERATOR_CONFIG_VERSION = 1;

export const OPERATOR_PROFILES = ["operator", "als_developer", "als_architect"] as const;
export const OPERATOR_COMPANY_TYPES = ["llc", "sole_prop", "corp", "ltd", "partnership", "nonprofit", "other"] as const;
export const OPERATOR_REVENUE_BANDS = ["<100k", "100k-1M", "1M-10M", "10M+"] as const;

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must use YYYY-MM-DD");
const operatorProfileSchema = z.enum(OPERATOR_PROFILES);
const companyTypeSchema = z.enum(OPERATOR_COMPANY_TYPES);
const revenueBandSchema = z.enum(OPERATOR_REVENUE_BANDS);

function addTrimmedSingleLineIssues(value: string, ctx: z.RefinementCtx, fieldLabel: string): void {
  if (value.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${fieldLabel} must be a non-empty string`,
    });
  }

  if (value.trim() !== value) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${fieldLabel} must not start or end with whitespace`,
    });
  }

  if (/[\r\n]/.test(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${fieldLabel} must stay on one line`,
    });
  }
}

function trimmedSingleLineString(fieldLabel: string) {
  return z.string().superRefine((value, ctx) => {
    addTrimmedSingleLineIssues(value, ctx, fieldLabel);
  });
}

function trimmedEmailString(fieldLabel: string) {
  return z.string().email(`${fieldLabel} must be a valid email`).superRefine((value, ctx) => {
    addTrimmedSingleLineIssues(value, ctx, fieldLabel);
  });
}

const nullableTrimmedSingleLineString = (fieldLabel: string) =>
  z.union([trimmedSingleLineString(fieldLabel), z.null()]);

const profilesSchema = z.array(operatorProfileSchema).min(1).superRefine((value, ctx) => {
  const seenProfiles = new Set<string>();
  for (const [index, profile] of value.entries()) {
    if (seenProfiles.has(profile)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate profile ${profile}`,
        path: [index],
      });
    }
    seenProfiles.add(profile);
  }
});

export const operatorConfigSchema = z.object({
  config_version: z.number().int().positive(),
  created: isoDateSchema,
  updated: isoDateSchema,
  first_name: trimmedSingleLineString("first_name"),
  last_name: trimmedSingleLineString("last_name"),
  display_name: nullableTrimmedSingleLineString("display_name"),
  primary_email: trimmedEmailString("primary_email"),
  role: trimmedSingleLineString("role"),
  profiles: profilesSchema,
  owns_company: z.boolean(),
  company_name: nullableTrimmedSingleLineString("company_name"),
  company_type: z.union([companyTypeSchema, z.null()]),
  company_type_other: nullableTrimmedSingleLineString("company_type_other"),
  revenue_band: z.union([revenueBandSchema, z.null()]),
}).strict().superRefine((value, ctx) => {
  if (value.config_version !== OPERATOR_CONFIG_VERSION) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `config_version must be ${OPERATOR_CONFIG_VERSION}`,
      path: ["config_version"],
    });
  }

  if (!value.owns_company) {
    for (const fieldName of ["company_name", "company_type", "company_type_other", "revenue_band"] as const) {
      if (value[fieldName] !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${fieldName} must be null when owns_company is false`,
          path: [fieldName],
        });
      }
    }
    return;
  }

  if (value.company_name === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "company_name is required when owns_company is true",
      path: ["company_name"],
    });
  }

  if (value.company_type === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "company_type is required when owns_company is true",
      path: ["company_type"],
    });
  }

  if (value.revenue_band === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "revenue_band is required when owns_company is true",
      path: ["revenue_band"],
    });
  }

  if (value.company_type === "other" && value.company_type_other === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "company_type_other is required when company_type is other",
      path: ["company_type_other"],
    });
  }

  if (value.company_type !== "other" && value.company_type_other !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "company_type_other must be null unless company_type is other",
      path: ["company_type_other"],
    });
  }
});

export type OperatorConfig = z.infer<typeof operatorConfigSchema>;

export interface OperatorConfigDocument {
  config: OperatorConfig;
  body: string;
}

export interface OperatorConfigIssue {
  code: string;
  path: string;
  message: string;
}

export interface OperatorConfigInspection {
  schema: typeof OPERATOR_CONFIG_OUTPUT_SCHEMA;
  status: "pass" | "fail" | "missing";
  file_path: string;
  exists: boolean;
  errors: OperatorConfigIssue[];
  warnings: OperatorConfigIssue[];
  config: OperatorConfig | null;
  body: string | null;
}

interface CredentialPattern {
  code: string;
  message: string;
  regex: RegExp;
}

const CREDENTIAL_PATTERNS: CredentialPattern[] = [
  {
    code: "credential.private_key",
    message: "looks like a private key block",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    code: "credential.openai",
    message: "looks like an OpenAI-style API key",
    regex: /\bsk-[A-Za-z0-9]{16,}\b/,
  },
  {
    code: "credential.github",
    message: "looks like a GitHub token",
    regex: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/,
  },
  {
    code: "credential.slack",
    message: "looks like a Slack token",
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  },
  {
    code: "credential.aws",
    message: "looks like an AWS access key id",
    regex: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    code: "credential.google",
    message: "looks like a Google credential/token",
    regex: /\b(?:AIza[0-9A-Za-z_-]{20,}|ya29\.[0-9A-Za-z._-]+)\b/,
  },
  {
    code: "credential.jwt",
    message: "looks like a JWT or bearer token",
    regex: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/,
  },
];

export function findAlsSystemRoot(startPath: string): string | null {
  let current = resolve(startPath);

  while (true) {
    if (existsSync(join(current, ".als", "system.ts"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }

    current = parent;
  }
}

export function resolveOperatorConfigPathFromSystemRoot(systemRoot: string): string {
  return join(resolve(systemRoot), ".als", "operator.md");
}

export function resolveOperatorConfigPath(startPath = process.cwd()): string | null {
  const candidate = resolve(startPath);
  if (basename(candidate) === "operator.md") {
    return candidate;
  }

  const systemRoot = findAlsSystemRoot(candidate);
  if (!systemRoot) {
    return null;
  }

  return resolveOperatorConfigPathFromSystemRoot(systemRoot);
}

export function serializeOperatorConfigDocument(document: OperatorConfigDocument): string {
  const frontmatter = {
    config_version: document.config.config_version,
    created: document.config.created,
    updated: document.config.updated,
    first_name: document.config.first_name,
    last_name: document.config.last_name,
    display_name: document.config.display_name,
    primary_email: document.config.primary_email,
    role: document.config.role,
    profiles: document.config.profiles,
    owns_company: document.config.owns_company,
    company_name: document.config.company_name,
    company_type: document.config.company_type,
    company_type_other: document.config.company_type_other,
    revenue_band: document.config.revenue_band,
  };
  const yaml = stringifyYaml(frontmatter).trimEnd();
  const body = normalizeOperatorConfigBody(document.body);

  if (body.length === 0) {
    return `---\n${yaml}\n---\n`;
  }

  return `---\n${yaml}\n---\n\n${body}\n`;
}

export function inspectOperatorConfigFile(filePath: string): OperatorConfigInspection {
  if (!existsSync(filePath)) {
    return buildInspection("missing", filePath, false, [], [], null, null);
  }

  const source = readFileSync(filePath, "utf-8");
  return inspectOperatorConfigSource(source, filePath);
}

export function inspectOperatorConfigSource(source: string, filePath = "operator.md"): OperatorConfigInspection {
  let parsed: ReturnType<typeof matter>;

  try {
    parsed = matter(source);
  } catch (error) {
    return buildInspection(
      "fail",
      filePath,
      true,
      [{
        code: "frontmatter.parse_error",
        path: "frontmatter",
        message: `Failed to parse operator config frontmatter: ${error instanceof Error ? error.message : String(error)}`,
      }],
      [],
      null,
      null,
    );
  }

  const normalizedData = normalizeMatterValue(parsed.data);
  const parsedConfig = operatorConfigSchema.safeParse(normalizedData);
  const body = normalizeOperatorConfigBody(parsed.content);

  if (!parsedConfig.success) {
    return buildInspection("fail", filePath, true, zodIssuesToOperatorIssues(parsedConfig.error.issues), [], null, body);
  }

  const warnings = collectCredentialWarnings(parsedConfig.data, body);
  const status = warnings.length > 0 ? "fail" : "pass";

  return buildInspection(status, filePath, true, [], warnings, parsedConfig.data, body);
}

export function buildOperatorConfigSessionStartOutput(
  cwd: string,
): string {
  const systemRoot = findAlsSystemRoot(cwd);
  if (!systemRoot) {
    return "";
  }

  if (existsSync(join(systemRoot, ".als", "skip-operator-config"))) {
    return "";
  }

  const filePath = resolveOperatorConfigPathFromSystemRoot(systemRoot);
  const inspection = inspectOperatorConfigFile(filePath);
  if (inspection.status === "missing") {
    return "";
  }

  if (inspection.status === "fail" || !inspection.config) {
    return renderOperatorConfigRemediation(filePath, inspection.errors, inspection.warnings);
  }

  return renderOperatorConfigReminder(inspection.config, filePath);
}

export function renderOperatorConfigReminder(config: OperatorConfig, filePath: string): string {
  const displayName = resolveDisplayName(config);
  const lines = [
    "<system-reminder>",
    `Stable operator context loaded from ${filePath}.`,
    "Use this as ambient context for the current ALS system unless the operator says it changed.",
    `- Name: ${displayName}`,
  ];

  if (config.display_name) {
    lines.push(`- Legal name: ${config.first_name} ${config.last_name}`);
  }

  lines.push(
    `- Primary email: ${config.primary_email}`,
    `- Role: ${config.role}`,
    `- Profiles: ${config.profiles.join(", ")}`,
    `- Owns company: ${config.owns_company ? "yes" : "no"}`,
  );

  if (config.owns_company) {
    lines.push(
      `- Company name: ${config.company_name}`,
      `- Company type: ${formatCompanyType(config)}`,
      `- Revenue band: ${config.revenue_band}`,
    );
  }

  lines.push("</system-reminder>");
  return `${lines.join("\n")}\n`;
}

export function renderOperatorConfigRemediation(
  filePath: string,
  errors: OperatorConfigIssue[],
  warnings: OperatorConfigIssue[],
): string {
  const lines = [
    "<system-reminder>",
    `Operator config at ${filePath} is present but not usable.`,
    "Do not rely on partial operator-profile data from this file.",
    "Run /operator-config to repair it before using operator identity or business context from ALS.",
  ];

  if (errors.length > 0) {
    lines.push("Errors:");
    for (const issue of errors) {
      lines.push(`- ${formatIssue(issue)}`);
    }
  }

  if (warnings.length > 0) {
    lines.push("Warnings:");
    for (const issue of warnings) {
      lines.push(`- ${formatIssue(issue)}`);
    }
  }

  lines.push("</system-reminder>");
  return `${lines.join("\n")}\n`;
}

function buildInspection(
  status: OperatorConfigInspection["status"],
  filePath: string,
  exists: boolean,
  errors: OperatorConfigIssue[],
  warnings: OperatorConfigIssue[],
  config: OperatorConfig | null,
  body: string | null,
): OperatorConfigInspection {
  return {
    schema: OPERATOR_CONFIG_OUTPUT_SCHEMA,
    status,
    file_path: filePath,
    exists,
    errors,
    warnings,
    config,
    body,
  };
}

function normalizeMatterValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeMatterValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, normalizeMatterValue(entry)]),
    );
  }

  return value;
}

function zodIssuesToOperatorIssues(issues: z.ZodIssue[]): OperatorConfigIssue[] {
  return issues.map((issue) => ({
    code: issue.code,
    path: issue.path.map((segment) => String(segment)).join("."),
    message: issue.message,
  }));
}

function collectCredentialWarnings(config: OperatorConfig, body: string): OperatorConfigIssue[] {
  const candidates: Array<{ path: string; value: string }> = [
    { path: "first_name", value: config.first_name },
    { path: "last_name", value: config.last_name },
    ...(config.display_name ? [{ path: "display_name", value: config.display_name }] : []),
    { path: "primary_email", value: config.primary_email },
    { path: "role", value: config.role },
    ...(config.company_name ? [{ path: "company_name", value: config.company_name }] : []),
    ...(config.company_type_other ? [{ path: "company_type_other", value: config.company_type_other }] : []),
    ...(body.length > 0 ? [{ path: "body", value: body }] : []),
  ];

  const warnings: OperatorConfigIssue[] = [];
  const seenWarnings = new Set<string>();

  for (const candidate of candidates) {
    for (const pattern of CREDENTIAL_PATTERNS) {
      if (!pattern.regex.test(candidate.value)) {
        continue;
      }

      const warningKey = `${candidate.path}:${pattern.code}`;
      if (seenWarnings.has(warningKey)) {
        continue;
      }

      warnings.push({
        code: pattern.code,
        path: candidate.path,
        message: `${candidate.path} ${pattern.message}; operator config must not store credentials`,
      });
      seenWarnings.add(warningKey);
    }
  }

  return warnings;
}

function normalizeOperatorConfigBody(body: string): string {
  return body.replace(/^\n/, "").trimEnd();
}

function resolveDisplayName(config: OperatorConfig): string {
  return config.display_name ?? `${config.first_name} ${config.last_name}`;
}

function formatCompanyType(config: OperatorConfig): string {
  if (config.company_type !== "other") {
    return config.company_type ?? "null";
  }

  return config.company_type_other ? `other (${config.company_type_other})` : "other";
}

function formatIssue(issue: OperatorConfigIssue): string {
  if (issue.path.length === 0) {
    return issue.message;
  }

  return `${issue.path}: ${issue.message}`;
}
