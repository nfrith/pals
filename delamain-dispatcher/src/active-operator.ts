import { readFile } from "fs/promises";
import { join } from "path";
import type { RuntimeManifestActiveOperatorAssignment } from "./runtime-manifest.js";

const ACTIVE_OPERATOR_SELECTION_SCHEMA = "als-active-operator-selection@1";

interface ActiveOperatorSelection {
  schema: string;
  operator_id: string;
}

export interface DispatchActiveOperatorFilter {
  field: string;
  mode: RuntimeManifestActiveOperatorAssignment["mode"];
  operatorId: string;
}

export type DispatchActiveOperatorResolution =
  | { status: "not-required" }
  | { status: "ready"; filter: DispatchActiveOperatorFilter }
  | { status: "refuse"; messages: string[] };

export async function resolveDispatchActiveOperator(
  systemRoot: string,
  delamainName: string,
  assignment?: RuntimeManifestActiveOperatorAssignment,
): Promise<DispatchActiveOperatorResolution> {
  if (!assignment) {
    return { status: "not-required" };
  }

  const selectionPath = join(systemRoot, ".als", "local", "active-operator.json");
  let raw: string;
  try {
    raw = await readFile(selectionPath, "utf-8");
  } catch {
    return {
      status: "refuse",
      messages: buildRefusalMessages(delamainName, assignment, selectionPath),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      status: "refuse",
      messages: buildRefusalMessages(delamainName, assignment, selectionPath),
    };
  }

  if (!isActiveOperatorSelection(parsed)) {
    return {
      status: "refuse",
      messages: buildRefusalMessages(delamainName, assignment, selectionPath),
    };
  }

  return {
    status: "ready",
    filter: {
      field: assignment.field,
      mode: assignment.mode,
      operatorId: parsed.operator_id,
    },
  };
}

function isActiveOperatorSelection(value: unknown): value is ActiveOperatorSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const selection = value as Partial<ActiveOperatorSelection>;
  return selection.schema === ACTIVE_OPERATOR_SELECTION_SCHEMA
    && typeof selection.operator_id === "string"
    && selection.operator_id.trim().length > 0;
}

function buildRefusalMessages(
  delamainName: string,
  assignment: RuntimeManifestActiveOperatorAssignment,
  selectionPath: string,
): string[] {
  return [
    `[dispatcher] active-operator selection missing or invalid for delamain '${delamainName}'`,
    `[dispatcher] requires_active_operator.field='${assignment.field}' mode='${assignment.mode}'`,
    `[dispatcher] refusing dispatch for this delamain until ${selectionPath} is present and names a roster id`,
  ];
}
