import { readFile } from "fs/promises";
import { join } from "path";

export interface RuntimeManifest {
  schema: string;
  delamain_name: string;
  module_id: string;
  module_version: number;
  module_mount_path: string;
  entity_name: string;
  entity_path: string;
  status_field: string;
  discriminator_field: string | null;
  discriminator_value: string | null;
  submodules: string[];
}

const DELAMAIN_RUNTIME_MANIFEST_SCHEMA = "als-delamain-runtime-manifest@1";

function requireStringField(
  manifest: Partial<RuntimeManifest>,
  field: keyof Pick<
    RuntimeManifest,
    "schema"
      | "delamain_name"
      | "module_id"
      | "module_mount_path"
      | "entity_name"
      | "entity_path"
      | "status_field"
  >,
): string {
  return manifest[field] as string;
}

export async function loadRuntimeManifest(bundleRoot: string): Promise<RuntimeManifest> {
  const manifestPath = join(bundleRoot, "runtime-manifest.json");
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf-8");
  } catch {
    throw new Error(
      `Missing runtime-manifest.json in '${bundleRoot}'. Redeploy this Delamain bundle with 'alsc deploy claude'.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid runtime-manifest.json in '${bundleRoot}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid runtime-manifest.json in '${bundleRoot}': expected an object`);
  }

  const manifest = parsed as Partial<RuntimeManifest>;
  const requiredStringFields: Array<keyof Pick<
    RuntimeManifest,
    "schema"
      | "delamain_name"
      | "module_id"
      | "module_mount_path"
      | "entity_name"
      | "entity_path"
      | "status_field"
  >> = [
    "schema",
    "delamain_name",
    "module_id",
    "module_mount_path",
    "entity_name",
    "entity_path",
    "status_field",
  ];

  for (const field of requiredStringFields) {
    if (typeof manifest[field] !== "string" || manifest[field]!.length === 0) {
      throw new Error(
        `Invalid runtime-manifest.json in '${bundleRoot}': '${field}' must be a non-empty string`,
      );
    }
  }

  if (manifest.schema !== DELAMAIN_RUNTIME_MANIFEST_SCHEMA) {
    throw new Error(
      `Invalid runtime-manifest.json in '${bundleRoot}': unsupported schema '${manifest.schema}'`,
    );
  }

  if (typeof manifest.module_version !== "number" || !Number.isInteger(manifest.module_version)) {
    throw new Error(
      `Invalid runtime-manifest.json in '${bundleRoot}': 'module_version' must be an integer`,
    );
  }

  for (const field of ["discriminator_field", "discriminator_value"] as const) {
    if (manifest[field] !== null && manifest[field] !== undefined && typeof manifest[field] !== "string") {
      throw new Error(
        `Invalid runtime-manifest.json in '${bundleRoot}': '${field}' must be string or null`,
      );
    }
  }

  const submodules = normalizeSubmodules(bundleRoot, manifest.submodules);

  return {
    schema: requireStringField(manifest, "schema"),
    delamain_name: requireStringField(manifest, "delamain_name"),
    module_id: requireStringField(manifest, "module_id"),
    module_version: manifest.module_version,
    module_mount_path: requireStringField(manifest, "module_mount_path"),
    entity_name: requireStringField(manifest, "entity_name"),
    entity_path: requireStringField(manifest, "entity_path"),
    status_field: requireStringField(manifest, "status_field"),
    discriminator_field: manifest.discriminator_field ?? null,
    discriminator_value: manifest.discriminator_value ?? null,
    submodules,
  };
}

function normalizeSubmodules(bundleRoot: string, value: unknown): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(
      `Invalid runtime-manifest.json in '${bundleRoot}': 'submodules' must be an array of repo-relative paths`,
    );
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new Error(
        `Invalid runtime-manifest.json in '${bundleRoot}': 'submodules' entries must be non-empty strings`,
      );
    }

    const candidate = entry.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "");
    if (
      candidate.length === 0
      || candidate === "."
      || candidate.startsWith("/")
      || candidate.startsWith("../")
      || candidate.includes("/../")
      || candidate.endsWith("/..")
    ) {
      throw new Error(
        `Invalid runtime-manifest.json in '${bundleRoot}': submodule path '${entry}' must be repo-relative`,
      );
    }

    if (seen.has(candidate)) continue;
    seen.add(candidate);
    normalized.push(candidate);
  }

  return normalized;
}
