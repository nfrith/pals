import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import matter from "gray-matter";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { loadAuthoredSourceExport } from "./authored-load.ts";
import { codes } from "./diagnostics.ts";

export const OPERATOR_CONFIG_OUTPUT_SCHEMA = "als-operator-config-output@2";
export const ACTIVE_OPERATOR_SELECTION_SCHEMA = "als-active-operator-selection@1";
export const LEGACY_OPERATOR_CONFIG_VERSION = 1;

export const OPERATOR_PROFILES = ["edgerunner", "als_developer", "als_architect"] as const;
export const OPERATOR_COMPANY_TYPES = ["llc", "sole_prop", "corp", "ltd", "partnership", "nonprofit", "other"] as const;
export const OPERATOR_REVENUE_BANDS = ["<100k", "100k-1M", "1M-10M", "10M+"] as const;

const OPERATOR_ID_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OPERATOR_PATH_REGEX = /^\.\/operators\/[a-z0-9]+(?:-[a-z0-9]+)*\.ts$/;
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must use YYYY-MM-DD");
const operatorProfileEnumSchema = z.enum(OPERATOR_PROFILES);
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

const profilesSchema = z.array(operatorProfileEnumSchema).min(1).superRefine((value, ctx) => {
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

const operatorIdSchema = trimmedSingleLineString("id").superRefine((value, ctx) => {
  if (!OPERATOR_ID_REGEX.test(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "id must use lowercase slug tokens joined by hyphens",
    });
  }
});

function applyCompanyValidation(
  value: {
    owns_company: boolean;
    company_name: string | null;
    company_type: (typeof OPERATOR_COMPANY_TYPES)[number] | null;
    company_type_other: string | null;
    revenue_band: (typeof OPERATOR_REVENUE_BANDS)[number] | null;
  },
  ctx: z.RefinementCtx,
): void {
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
}

const operatorProfileShape = {
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
} as const;

const operatorConfigSchema = z.object({
  id: operatorIdSchema,
  ...operatorProfileShape,
}).strict().superRefine((value, ctx) => {
  applyCompanyValidation(value, ctx);
});

const legacyOperatorConfigSchema = z.object({
    config_version: z.number().int().positive(),
    created: isoDateSchema,
    updated: isoDateSchema,
    ...operatorProfileShape,
  }).strict().superRefine((value, ctx) => {
  if (value.config_version !== LEGACY_OPERATOR_CONFIG_VERSION) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `config_version must be ${LEGACY_OPERATOR_CONFIG_VERSION}`,
      path: ["config_version"],
    });
  }

  applyCompanyValidation(value, ctx);
});

const operatorRosterSchema = z.object({
  operator_paths: z.array(trimmedSingleLineString("operator_paths")).min(1).superRefine((value, ctx) => {
    const seenPaths = new Set<string>();
    for (const [index, entry] of value.entries()) {
      if (!OPERATOR_PATH_REGEX.test(entry)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "operator_paths entries must be relative './operators/{id}.ts' paths",
          path: [index],
        });
      }

      if (seenPaths.has(entry)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate operator path ${entry}`,
          path: [index],
        });
      }
      seenPaths.add(entry);
    }
  }),
}).strict();

const activeOperatorSelectionSchema = z.object({
  schema: z.literal(ACTIVE_OPERATOR_SELECTION_SCHEMA),
  operator_id: operatorIdSchema,
}).strict();

export type OperatorConfig = z.infer<typeof operatorConfigSchema>;
export type LegacyOperatorConfig = z.infer<typeof legacyOperatorConfigSchema>;
export type OperatorRoster = z.infer<typeof operatorRosterSchema>;
export type ActiveOperatorSelection = z.infer<typeof activeOperatorSelectionSchema>;

export interface LegacyOperatorConfigDocument {
  config: LegacyOperatorConfig;
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
  system_root: string;
  file_path: string;
  exists: boolean;
  skip_operator_config: boolean;
  errors: OperatorConfigIssue[];
  warnings: OperatorConfigIssue[];
  config: OperatorConfig | null;
  roster: {
    file_path: string;
    exists: boolean;
    operator_paths: string[] | null;
    operator_ids: string[];
  };
  active_selection: {
    file_path: string;
    exists: boolean;
    schema: string | null;
    operator_id: string | null;
  };
  operators: Array<{
    id: string;
    file_path: string;
    display_name: string;
    legal_name: string;
  }>;
  legacy: {
    file_path: string;
    exists: boolean;
    status: "pass" | "fail" | "missing";
    errors: OperatorConfigIssue[];
    warnings: OperatorConfigIssue[];
    config: LegacyOperatorConfig | null;
    body: string | null;
  };
}

export interface ActiveOperatorSelectionWriteResult {
  status: "pass" | "fail";
  file_path: string;
  operator_id: string | null;
  error: string | null;
}

interface CredentialPattern {
  code: string;
  message: string;
  regex: RegExp;
}

export interface LoadedOperatorEntry {
  file_path: string;
  config: OperatorConfig;
}

export interface LoadedOperatorRoster {
  file_path: string;
  exists: boolean;
  roster: OperatorRoster | null;
  operators: LoadedOperatorEntry[];
  errors: OperatorConfigIssue[];
  warnings: OperatorConfigIssue[];
}

interface ActiveSelectionInspection {
  file_path: string;
  exists: boolean;
  schema: string | null;
  operator_id: string | null;
  selection: ActiveOperatorSelection | null;
  errors: OperatorConfigIssue[];
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
  return join(resolve(systemRoot), ".als", "operator-roster.ts");
}

export function resolveOperatorConfigPath(startPath = process.cwd()): string | null {
  const systemRoot = findAlsSystemRoot(startPath);
  if (!systemRoot) {
    return null;
  }

  return resolveOperatorConfigPathFromSystemRoot(systemRoot);
}

export function resolveLegacyOperatorConfigPathFromSystemRoot(systemRoot: string): string {
  return join(resolve(systemRoot), ".als", "operator.md");
}

export function resolveActiveOperatorSelectionPathFromSystemRoot(systemRoot: string): string {
  return join(resolve(systemRoot), ".als", "local", "active-operator.json");
}

export function resolveOperatorEntryPathFromSystemRoot(systemRoot: string, operatorId: string): string {
  return join(resolve(systemRoot), ".als", "operators", `${operatorId}.ts`);
}

export function serializeLegacyOperatorConfigDocument(document: LegacyOperatorConfigDocument): string {
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
  const body = normalizeLegacyOperatorConfigBody(document.body);

  if (body.length === 0) {
    return `---\n${yaml}\n---\n`;
  }

  return `---\n${yaml}\n---\n\n${body}\n`;
}

export function serializeOperatorConfigSource(config: OperatorConfig): string {
  return [
    "import { defineOperator } from \"als:authoring\";",
    "",
    `export const operator = defineOperator(${JSON.stringify(config, null, 2)} as const);`,
    "",
    "export default operator;",
    "",
  ].join("\n");
}

export function serializeOperatorRosterSource(roster: OperatorRoster): string {
  return [
    "import { defineOperatorRoster } from \"als:authoring\";",
    "",
    `export const operatorRoster = defineOperatorRoster(${JSON.stringify(roster, null, 2)} as const);`,
    "",
    "export default operatorRoster;",
    "",
  ].join("\n");
}

export function serializeActiveOperatorSelection(selection: ActiveOperatorSelection): string {
  return `${JSON.stringify(selection, null, 2)}\n`;
}

export function inspectLegacyOperatorConfigFile(filePath: string): {
  status: "pass" | "fail" | "missing";
  errors: OperatorConfigIssue[];
  warnings: OperatorConfigIssue[];
  config: LegacyOperatorConfig | null;
  body: string | null;
} {
  if (!existsSync(filePath)) {
    return {
      status: "missing",
      errors: [],
      warnings: [],
      config: null,
      body: null,
    };
  }

  const source = readFileSync(filePath, "utf-8");
  return inspectLegacyOperatorConfigSource(source, filePath);
}

export function inspectLegacyOperatorConfigSource(
  source: string,
  filePath = "operator.md",
): {
  status: "pass" | "fail";
  errors: OperatorConfigIssue[];
  warnings: OperatorConfigIssue[];
  config: LegacyOperatorConfig | null;
  body: string | null;
} {
  let parsed: ReturnType<typeof matter>;

  try {
    parsed = matter(source);
  } catch (error) {
    return {
      status: "fail",
      errors: [{
        code: "frontmatter.parse_error",
        path: "frontmatter",
        message: `Failed to parse operator config frontmatter: ${error instanceof Error ? error.message : String(error)}`,
      }],
      warnings: [],
      config: null,
      body: null,
    };
  }

  const normalizedData = normalizeMatterValue(parsed.data);
  const parsedConfig = legacyOperatorConfigSchema.safeParse(normalizedData);
  const body = normalizeLegacyOperatorConfigBody(parsed.content);

  if (!parsedConfig.success) {
    return {
      status: "fail",
      errors: zodIssuesToOperatorIssues(parsedConfig.error.issues),
      warnings: [],
      config: null,
      body,
    };
  }

  const warnings = collectCredentialWarnings(parsedConfig.data, body);
  const status = warnings.length > 0 ? "fail" : "pass";
  return {
    status,
    errors: [],
    warnings,
    config: parsedConfig.data,
    body,
  };
}

export function inspectOperatorConfig(startPath = process.cwd()): OperatorConfigInspection | null {
  const systemRoot = findAlsSystemRoot(startPath);
  if (!systemRoot) {
    return null;
  }

  return inspectOperatorConfigFromSystemRoot(systemRoot);
}

export function buildOperatorConfigSessionStartOutput(cwd: string): string {
  const systemRoot = findAlsSystemRoot(cwd);
  if (!systemRoot) {
    return "";
  }

  if (existsSync(join(systemRoot, ".als", "skip-operator-config"))) {
    return "";
  }

  const inspection = inspectOperatorConfigFromSystemRoot(systemRoot);
  if (inspection.status === "pass" && inspection.config) {
    return renderOperatorConfigReminder(
      inspection.config,
      inspection.roster.file_path,
      inspection.active_selection.file_path,
    );
  }

  return renderOperatorConfigRemediation(inspection);
}

export function renderOperatorConfigReminder(
  config: OperatorConfig,
  rosterPath: string,
  activeSelectionPath: string,
): string {
  const displayName = resolveDisplayName(config);
  const lines = [
    "<system-reminder>",
    `Stable operator context loaded from ${rosterPath}.`,
    `Active operator selected from ${activeSelectionPath}.`,
    "Use this as ambient context for the current ALS system unless the operator says it changed.",
    `- Operator ID: ${config.id}`,
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

export function renderOperatorConfigRemediation(inspection: OperatorConfigInspection): string {
  const lines = [
    "<system-reminder>",
    "Operator config is not usable for SessionStart identity injection.",
    "Do not rely on partial operator-profile data from this ALS system.",
    "Run /configure-operator to author or repair the roster and local active-operator selection.",
  ];

  if (inspection.legacy.exists && !inspection.exists) {
    lines.push(
      `Legacy migration input is still present at ${inspection.legacy.file_path}.`,
      "Run /update or /upgrade-language to convert the legacy `.als/operator.md` surface before relying on operator identity.",
    );
  }

  lines.push("Problems:");
  if (inspection.errors.length === 0 && inspection.warnings.length === 0) {
    lines.push(`- No operator roster found at ${inspection.file_path}.`);
  }
  for (const issue of inspection.errors) {
    lines.push(`- ${formatIssue(issue)}`);
  }
  for (const issue of inspection.warnings) {
    lines.push(`- ${formatIssue(issue)}`);
  }

  lines.push("</system-reminder>");
  return `${lines.join("\n")}\n`;
}

export function deriveLegacyOperatorId(config: LegacyOperatorConfig): string {
  const label = resolveLegacyDisplayName(config);
  const operatorId = slugifyOperatorId(label);
  if (operatorId.length === 0) {
    throw new Error(`Could not derive a stable operator id from legacy label '${label}'.`);
  }
  return operatorId;
}

export function slugifyOperatorId(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function convertLegacyOperatorConfig(config: LegacyOperatorConfig): OperatorConfig {
  return {
    id: deriveLegacyOperatorId(config),
    first_name: config.first_name,
    last_name: config.last_name,
    display_name: config.display_name,
    primary_email: config.primary_email,
    role: config.role,
    profiles: [...config.profiles],
    owns_company: config.owns_company,
    company_name: config.company_name,
    company_type: config.company_type,
    company_type_other: config.company_type_other,
    revenue_band: config.revenue_band,
  };
}

export function writeActiveOperatorSelection(startPath: string, operatorId: string): ActiveOperatorSelectionWriteResult {
  const systemRoot = findAlsSystemRoot(startPath);
  if (!systemRoot) {
    return {
      status: "fail",
      file_path: resolve(startPath, ".als", "local", "active-operator.json"),
      operator_id: null,
      error: "No ALS system root found.",
    };
  }

  const roster = loadOperatorRoster(systemRoot);
  if (!roster.exists) {
    return {
      status: "fail",
      file_path: resolveActiveOperatorSelectionPathFromSystemRoot(systemRoot),
      operator_id: null,
      error: "No operator roster exists for this ALS system.",
    };
  }

  if (roster.errors.length > 0 || roster.warnings.length > 0) {
    return {
      status: "fail",
      file_path: resolveActiveOperatorSelectionPathFromSystemRoot(systemRoot),
      operator_id: null,
      error: "Operator roster is invalid; repair it before selecting an active operator.",
    };
  }

  if (!roster.operators.some((entry) => entry.config.id === operatorId)) {
    return {
      status: "fail",
      file_path: resolveActiveOperatorSelectionPathFromSystemRoot(systemRoot),
      operator_id: null,
      error: `Operator id '${operatorId}' is not present in the roster.`,
    };
  }

  return writeActiveOperatorSelectionFile(systemRoot, operatorId);
}

export function selectSingletonActiveOperator(startPath: string): ActiveOperatorSelectionWriteResult {
  const systemRoot = findAlsSystemRoot(startPath);
  if (!systemRoot) {
    return {
      status: "fail",
      file_path: resolve(startPath, ".als", "local", "active-operator.json"),
      operator_id: null,
      error: "No ALS system root found.",
    };
  }

  const roster = loadOperatorRoster(systemRoot);
  if (!roster.exists) {
    return {
      status: "fail",
      file_path: resolveActiveOperatorSelectionPathFromSystemRoot(systemRoot),
      operator_id: null,
      error: "No operator roster exists for this ALS system.",
    };
  }

  if (roster.errors.length > 0 || roster.warnings.length > 0) {
    return {
      status: "fail",
      file_path: resolveActiveOperatorSelectionPathFromSystemRoot(systemRoot),
      operator_id: null,
      error: "Operator roster is invalid; repair it before writing a local selector.",
    };
  }

  if (roster.operators.length !== 1) {
    return {
      status: "fail",
      file_path: resolveActiveOperatorSelectionPathFromSystemRoot(systemRoot),
      operator_id: null,
      error: `Expected exactly one roster entry for automatic local selection, found ${roster.operators.length}.`,
    };
  }

  return writeActiveOperatorSelectionFile(systemRoot, roster.operators[0]!.config.id);
}

function inspectOperatorConfigFromSystemRoot(systemRoot: string): OperatorConfigInspection {
  const roster = loadOperatorRoster(systemRoot);
  const selection = inspectActiveSelection(systemRoot);
  const legacyPath = resolveLegacyOperatorConfigPathFromSystemRoot(systemRoot);
  const legacy = inspectLegacyOperatorConfigFile(legacyPath);
  const skipOperatorConfig = existsSync(join(systemRoot, ".als", "skip-operator-config"));
  const errors = [...roster.errors, ...selection.errors];
  const warnings = [...roster.warnings];
  let activeConfig: OperatorConfig | null = null;

  if (!roster.exists) {
    if (selection.exists) {
      errors.push({
        code: "active_selection.roster_missing",
        path: "active_selection",
        message: `Local active-operator selector exists at ${selection.file_path}, but ${roster.file_path} is missing.`,
      });
    } else if (!skipOperatorConfig && legacy.exists) {
      errors.push({
        code: "legacy.migration_required",
        path: "legacy",
        message: `Legacy operator config at ${legacyPath} is migration input only and no operator roster exists yet.`,
      });
    }
  } else if (roster.errors.length === 0) {
    if (!selection.exists) {
      errors.push({
        code: "active_selection.missing",
        path: "active_selection",
        message: `Machine-local active-operator selector is missing at ${selection.file_path}.`,
      });
    } else if (selection.selection) {
      const matchedOperator = roster.operators.find((entry) => entry.config.id === selection.selection!.operator_id);
      if (!matchedOperator) {
        errors.push({
          code: "active_selection.unknown_operator",
          path: "active_selection.operator_id",
          message: `Active operator id '${selection.selection.operator_id}' does not exist in the roster.`,
        });
      } else {
        activeConfig = matchedOperator.config;
      }
    }
  }

  let status: OperatorConfigInspection["status"] = "missing";
  if (activeConfig && errors.length === 0 && warnings.length === 0) {
    status = "pass";
  } else if (errors.length > 0 || warnings.length > 0 || roster.exists || selection.exists || legacy.exists) {
    status = "fail";
  }

  return {
    schema: OPERATOR_CONFIG_OUTPUT_SCHEMA,
    status,
    system_root: systemRoot,
    file_path: roster.file_path,
    exists: roster.exists,
    skip_operator_config: skipOperatorConfig,
    errors,
    warnings,
    config: activeConfig,
    roster: {
      file_path: roster.file_path,
      exists: roster.exists,
      operator_paths: roster.roster?.operator_paths ?? null,
      operator_ids: roster.operators.map((entry) => entry.config.id),
    },
    active_selection: {
      file_path: selection.file_path,
      exists: selection.exists,
      schema: selection.schema,
      operator_id: selection.operator_id,
    },
    operators: roster.operators.map((entry) => ({
      id: entry.config.id,
      file_path: entry.file_path,
      display_name: resolveDisplayName(entry.config),
      legal_name: `${entry.config.first_name} ${entry.config.last_name}`,
    })),
    legacy: {
      file_path: legacyPath,
      exists: legacy.status !== "missing",
      status: legacy.status,
      errors: legacy.errors,
      warnings: legacy.warnings,
      config: legacy.config,
      body: legacy.body,
    },
  };
}

export function loadOperatorRoster(systemRoot: string): LoadedOperatorRoster {
  const filePath = resolveOperatorConfigPathFromSystemRoot(systemRoot);
  if (!existsSync(filePath)) {
    return {
      file_path: filePath,
      exists: false,
      roster: null,
      operators: [],
      errors: [],
      warnings: [],
    };
  }

  const loadedRoster = loadAuthoredSourceExport(
    filePath,
    "operatorRoster",
    "operator_roster",
    codes.SHAPE_INVALID,
    null,
  );
  if (!loadedRoster.success) {
    return {
      file_path: filePath,
      exists: true,
      roster: null,
      operators: [],
      errors: authoredDiagnosticsToIssues(loadedRoster.diagnostics),
      warnings: [],
    };
  }

  const parsedRoster = operatorRosterSchema.safeParse(loadedRoster.data);
  if (!parsedRoster.success) {
    return {
      file_path: filePath,
      exists: true,
      roster: null,
      operators: [],
      errors: zodIssuesToOperatorIssues(parsedRoster.error.issues, "roster"),
      warnings: [],
    };
  }

  const errors: OperatorConfigIssue[] = [];
  const warnings: OperatorConfigIssue[] = [];
  const operators: LoadedOperatorEntry[] = [];
  const seenIds = new Map<string, string>();

  for (const [index, operatorPath] of parsedRoster.data.operator_paths.entries()) {
    const operatorFilePath = resolve(dirname(filePath), operatorPath);
    const operatorRelativeToSystem = relative(join(systemRoot, ".als"), operatorFilePath);
    if (operatorRelativeToSystem.startsWith("..") || operatorRelativeToSystem === ".." || !operatorRelativeToSystem.startsWith(`operators${sep}`)) {
      errors.push({
        code: "roster.operator_path_escape",
        path: `roster.operator_paths.${index}`,
        message: `Operator path '${operatorPath}' must stay under .als/operators/.`,
      });
      continue;
    }

    const loadedOperator = loadAuthoredSourceExport(
      operatorFilePath,
      "operator",
      "operator_profile",
      codes.SHAPE_INVALID,
      null,
    );
    if (!loadedOperator.success) {
      errors.push(...authoredDiagnosticsToIssues(loadedOperator.diagnostics));
      continue;
    }

    const parsedOperator = operatorConfigSchema.safeParse(loadedOperator.data);
    if (!parsedOperator.success) {
      errors.push(...zodIssuesToOperatorIssues(parsedOperator.error.issues, `operator:${operatorPath}`));
      continue;
    }

    const operatorConfig = parsedOperator.data;
    const expectedBasename = `${operatorConfig.id}.ts`;
    if (basename(operatorFilePath) !== expectedBasename) {
      errors.push({
        code: "operator.basename_mismatch",
        path: `operator:${operatorPath}`,
        message: `Operator file basename '${basename(operatorFilePath)}' must match id '${operatorConfig.id}' as '${expectedBasename}'.`,
      });
    }

    const existingPath = seenIds.get(operatorConfig.id);
    if (existingPath) {
      errors.push({
        code: "operator.id_duplicate",
        path: `operator:${operatorPath}`,
        message: `Duplicate operator id '${operatorConfig.id}' appears in '${existingPath}' and '${operatorPath}'.`,
      });
    } else {
      seenIds.set(operatorConfig.id, operatorPath);
    }

    warnings.push(...collectCredentialWarnings(operatorConfig, "").map((issue) => ({
      ...issue,
      path: issue.path.length > 0 ? `operator:${operatorPath}.${issue.path}` : `operator:${operatorPath}`,
    })));
    operators.push({
      file_path: operatorFilePath,
      config: operatorConfig,
    });
  }

  return {
    file_path: filePath,
    exists: true,
    roster: parsedRoster.data,
    operators,
    errors,
    warnings,
  };
}

function inspectActiveSelection(systemRoot: string): ActiveSelectionInspection {
  const filePath = resolveActiveOperatorSelectionPathFromSystemRoot(systemRoot);
  if (!existsSync(filePath)) {
    return {
      file_path: filePath,
      exists: false,
      schema: null,
      operator_id: null,
      selection: null,
      errors: [],
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (error) {
    return {
      file_path: filePath,
      exists: true,
      schema: null,
      operator_id: null,
      selection: null,
      errors: [{
        code: "active_selection.parse_error",
        path: "active_selection",
        message: `Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      }],
    };
  }

  const parsedSelection = activeOperatorSelectionSchema.safeParse(parsedJson);
  if (!parsedSelection.success) {
    return {
      file_path: filePath,
      exists: true,
      schema: typeof parsedJson === "object" && parsedJson !== null && "schema" in (parsedJson as Record<string, unknown>)
        ? String((parsedJson as Record<string, unknown>).schema)
        : null,
      operator_id: typeof parsedJson === "object" && parsedJson !== null && "operator_id" in (parsedJson as Record<string, unknown>)
        ? String((parsedJson as Record<string, unknown>).operator_id)
        : null,
      selection: null,
      errors: zodIssuesToOperatorIssues(parsedSelection.error.issues, "active_selection"),
    };
  }

  return {
    file_path: filePath,
    exists: true,
    schema: parsedSelection.data.schema,
    operator_id: parsedSelection.data.operator_id,
    selection: parsedSelection.data,
    errors: [],
  };
}

function writeActiveOperatorSelectionFile(systemRoot: string, operatorId: string): ActiveOperatorSelectionWriteResult {
  const filePath = resolveActiveOperatorSelectionPathFromSystemRoot(systemRoot);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, serializeActiveOperatorSelection({
    schema: ACTIVE_OPERATOR_SELECTION_SCHEMA,
    operator_id: operatorId,
  }), "utf-8");

  return {
    status: "pass",
    file_path: filePath,
    operator_id: operatorId,
    error: null,
  };
}

function authoredDiagnosticsToIssues(
  diagnostics: Array<{
    code: string;
    reason: string | null;
    field: string | null;
    file: string;
    message: string;
  }>,
): OperatorConfigIssue[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.reason ?? diagnostic.code,
    path: diagnostic.field ?? "",
    message: `${diagnostic.file}: ${diagnostic.message}`,
  }));
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

function zodIssuesToOperatorIssues(issues: z.ZodIssue[], prefix = ""): OperatorConfigIssue[] {
  return issues.map((issue) => ({
    code: issue.code,
    path: [prefix, issue.path.map((segment) => String(segment)).join(".")].filter(Boolean).join("."),
    message: issue.message,
  }));
}

function collectCredentialWarnings(config: OperatorConfig | LegacyOperatorConfig, body: string): OperatorConfigIssue[] {
  const candidates: Array<{ path: string; value: string }> = [
    ...("id" in config ? [{ path: "id", value: config.id }] : []),
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

function normalizeLegacyOperatorConfigBody(body: string): string {
  return body.replace(/^\n/, "").trimEnd();
}

function resolveDisplayName(config: OperatorConfig): string {
  return config.display_name ?? `${config.first_name} ${config.last_name}`;
}

function resolveLegacyDisplayName(config: LegacyOperatorConfig): string {
  return config.display_name ?? `${config.first_name} ${config.last_name}`;
}

function formatCompanyType(config: Pick<OperatorConfig, "company_type" | "company_type_other">): string {
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
