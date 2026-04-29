import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  COMPATIBILITY_CLASSES,
  highestCompatibilityClass,
  isCompatibilityClass,
  type CompatibilityClass,
} from "./contracts.ts";

export const CHANGELOG_INSPECTION_OUTPUT_SCHEMA = "als-changelog-inspection@1" as const;
export const CHANGELOG_POINTER_LINE = "For pre-2026-04-29 release history, see git tags." as const;

const ENTRY_FIELD_ORDER = [
  "Compatibility",
  "Summary",
  "Operator action",
  "Affected surfaces",
] as const;

type EntryFieldLabel = (typeof ENTRY_FIELD_ORDER)[number];

const entryFieldLabelSet = new Set<string>(ENTRY_FIELD_ORDER);

export interface ChangelogInspectionIssue {
  code: string;
  line: number | null;
  message: string;
  expected: string | null;
  actual: unknown;
}

export interface ChangelogEntry {
  job_id: string;
  compatibility_classes: CompatibilityClass[];
  summary: string;
  operator_action: string;
  affected_surfaces: string[];
}

export interface ChangelogSection {
  kind: "unreleased" | "release";
  heading: string;
  version: string | null;
  date: string | null;
  headline_class: CompatibilityClass | null;
  entries: ChangelogEntry[];
}

export interface ChangelogInspection {
  schema: typeof CHANGELOG_INSPECTION_OUTPUT_SCHEMA;
  status: "pass" | "fail" | "missing";
  file_path: string;
  exists: boolean;
  errors: ChangelogInspectionIssue[];
  warnings: ChangelogInspectionIssue[];
  sections: ChangelogSection[];
  total_entry_count: number;
}

interface ParsedEntryFieldLine {
  label: string;
  value: string;
  line: number;
}

export function resolveChangelogPath(startPath = process.cwd()): string {
  const candidate = resolve(startPath);
  if (basename(candidate) === "CHANGELOG.md") {
    return candidate;
  }

  return join(candidate, "CHANGELOG.md");
}

export function inspectChangelogFile(startPath = process.cwd()): ChangelogInspection {
  const filePath = resolveChangelogPath(startPath);

  if (!existsSync(filePath)) {
    return {
      schema: CHANGELOG_INSPECTION_OUTPUT_SCHEMA,
      status: "missing",
      file_path: filePath,
      exists: false,
      errors: [],
      warnings: [],
      sections: [],
      total_entry_count: 0,
    };
  }

  try {
    if (!statSync(filePath).isFile()) {
      return failInspection(filePath, [
        issue(
          "changelog.path.not_file",
          null,
          "CHANGELOG target must resolve to a file",
          "file",
          "directory",
        ),
      ]);
    }
  } catch (error) {
    return failInspection(filePath, [
      issue(
        "changelog.path.unreadable",
        null,
        `Could not stat CHANGELOG target: ${error instanceof Error ? error.message : String(error)}`,
        "readable file",
        null,
      ),
    ]);
  }

  try {
    const source = readFileSync(filePath, "utf-8");
    return inspectChangelogSource(source, filePath);
  } catch (error) {
    return failInspection(filePath, [
      issue(
        "changelog.read.failed",
        null,
        `Could not read CHANGELOG file: ${error instanceof Error ? error.message : String(error)}`,
        "readable UTF-8 file",
        null,
      ),
    ]);
  }
}

export function inspectChangelogSource(
  source: string,
  filePath: string,
): ChangelogInspection {
  const normalized = source.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const errors: ChangelogInspectionIssue[] = [];
  const sections: ChangelogSection[] = [];
  const seenJobIds = new Set<string>();

  if (lines[0] !== "# Changelog") {
    errors.push(
      issue(
        "changelog.title.invalid",
        1,
        "CHANGELOG must start with '# Changelog'",
        "# Changelog",
        lines[0] ?? null,
      ),
    );
  }

  const pointerLineIndex = findNextNonEmptyLine(lines, 1);
  if (pointerLineIndex === null) {
    errors.push(
      issue(
        "changelog.pointer.missing",
        null,
        "CHANGELOG must declare the historical pointer line after the title",
        CHANGELOG_POINTER_LINE,
        null,
      ),
    );
    return finalizeInspection(filePath, errors, sections);
  }

  if (lines[pointerLineIndex] !== CHANGELOG_POINTER_LINE) {
    errors.push(
      issue(
        "changelog.pointer.invalid",
        pointerLineIndex + 1,
        "CHANGELOG historical pointer line does not match the accepted contract",
        CHANGELOG_POINTER_LINE,
        lines[pointerLineIndex] ?? null,
      ),
    );
  }

  let cursor = pointerLineIndex + 1;
  let sawUnreleased = false;
  let sectionIndex = 0;

  while (cursor < lines.length) {
    const nextContentIndex = findNextNonEmptyLine(lines, cursor);
    if (nextContentIndex === null) {
      break;
    }

    const heading = lines[nextContentIndex] ?? "";
    if (!heading.startsWith("## ")) {
      errors.push(
        issue(
          "changelog.section.expected",
          nextContentIndex + 1,
          "Only level-2 release headings may appear at top level after the changelog pointer",
          "## [Unreleased] or ## <version> - <date>",
          heading,
        ),
      );
      cursor = nextContentIndex + 1;
      continue;
    }

    const sectionBoundary = findNextLevelTwoHeading(lines, nextContentIndex + 1);
    const sectionLines = lines.slice(nextContentIndex + 1, sectionBoundary ?? lines.length);
    const sectionHeading = heading.slice(3).trim();

    if (sectionHeading === "[Unreleased]") {
      if (sectionIndex !== 0) {
        errors.push(
          issue(
            "changelog.unreleased.order",
            nextContentIndex + 1,
            "The [Unreleased] section must be the first release section in the file",
            "## [Unreleased] before numbered releases",
            heading,
          ),
        );
      }
      if (sawUnreleased) {
        errors.push(
          issue(
            "changelog.unreleased.duplicate",
            nextContentIndex + 1,
            "CHANGELOG must declare exactly one [Unreleased] section",
            "single [Unreleased] section",
            heading,
          ),
        );
      }

      sawUnreleased = true;
      const entries = parseSectionEntries(sectionLines, nextContentIndex + 2, errors, seenJobIds);
      sections.push({
        kind: "unreleased",
        heading: sectionHeading,
        version: null,
        date: null,
        headline_class: highestCompatibilityClass(entries.flatMap((entry) => entry.compatibility_classes)),
        entries,
      });
      cursor = sectionBoundary ?? lines.length;
      sectionIndex += 1;
      continue;
    }

    const releaseMatch = sectionHeading.match(/^(.+?) - (\d{4}-\d{2}-\d{2})$/);
    if (!releaseMatch) {
      errors.push(
        issue(
          "changelog.section.invalid_heading",
          nextContentIndex + 1,
          "Release headings must use '## <version> - YYYY-MM-DD'",
          "## <version> - YYYY-MM-DD",
          heading,
        ),
      );
      cursor = sectionBoundary ?? lines.length;
      sectionIndex += 1;
      continue;
    }

    const version = releaseMatch[1]?.trim() ?? "";
    const date = releaseMatch[2] ?? "";
    const entries = parseSectionEntries(sectionLines, nextContentIndex + 2, errors, seenJobIds);
    if (entries.length === 0) {
      errors.push(
        issue(
          "changelog.release.empty",
          nextContentIndex + 1,
          "Numbered release sections must contain at least one ALS entry",
          "at least one ### ALS-XXX entry",
          heading,
        ),
      );
    }

    sections.push({
      kind: "release",
      heading: sectionHeading,
      version,
      date,
      headline_class: highestCompatibilityClass(entries.flatMap((entry) => entry.compatibility_classes)),
      entries,
    });
    cursor = sectionBoundary ?? lines.length;
    sectionIndex += 1;
  }

  if (!sawUnreleased) {
    errors.push(
      issue(
        "changelog.unreleased.missing",
        null,
        "CHANGELOG must declare an [Unreleased] section",
        "## [Unreleased]",
        null,
      ),
    );
  }

  if (sections.length === 0) {
    errors.push(
      issue(
        "changelog.section.missing",
        null,
        "CHANGELOG must contain at least the [Unreleased] section",
        "## [Unreleased]",
        null,
      ),
    );
  }

  return finalizeInspection(filePath, errors, sections);
}

function parseSectionEntries(
  sectionLines: string[],
  firstLineNumber: number,
  errors: ChangelogInspectionIssue[],
  seenJobIds: Set<string>,
): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let cursor = 0;

  while (cursor < sectionLines.length) {
    const nextContentIndex = findNextNonEmptyLine(sectionLines, cursor);
    if (nextContentIndex === null) {
      break;
    }

    const heading = sectionLines[nextContentIndex] ?? "";
    const lineNumber = firstLineNumber + nextContentIndex;
    if (!heading.startsWith("### ")) {
      errors.push(
        issue(
          "changelog.entry.heading_expected",
          lineNumber,
          "Release sections may only contain '### ALS-XXX' entries",
          "### ALS-XXX",
          heading,
        ),
      );
      cursor = nextContentIndex + 1;
      continue;
    }

    const jobId = heading.slice(4).trim();
    if (!/^ALS-\d+$/.test(jobId)) {
      errors.push(
        issue(
          "changelog.entry.invalid_id",
          lineNumber,
          "CHANGELOG entry headings must use '### ALS-<number>'",
          "ALS-<number>",
          jobId,
        ),
      );
    }

    if (seenJobIds.has(jobId)) {
      errors.push(
        issue(
          "changelog.entry.duplicate_id",
          lineNumber,
          `CHANGELOG entry '${jobId}' appears more than once`,
          "unique ALS entry id",
          jobId,
        ),
      );
    } else {
      seenJobIds.add(jobId);
    }

    const entryBoundary = findNextEntryBoundary(sectionLines, nextContentIndex + 1);
    const entryBodyLines = sectionLines.slice(nextContentIndex + 1, entryBoundary ?? sectionLines.length);
    const parsedEntry = parseEntryBody(entryBodyLines, firstLineNumber + nextContentIndex + 1, jobId, errors);
    if (parsedEntry) {
      entries.push(parsedEntry);
    }

    cursor = entryBoundary ?? sectionLines.length;
  }

  return entries;
}

function parseEntryBody(
  entryBodyLines: string[],
  firstLineNumber: number,
  jobId: string,
  errors: ChangelogInspectionIssue[],
): ChangelogEntry | null {
  const fieldLines: ParsedEntryFieldLine[] = [];

  for (const [index, rawLine] of entryBodyLines.entries()) {
    if (rawLine.trim().length === 0) {
      continue;
    }

    const lineNumber = firstLineNumber + index;
    const match = rawLine.match(/^- ([A-Za-z ]+): (.+)$/);
    if (!match) {
      errors.push(
        issue(
          "changelog.entry.line.invalid",
          lineNumber,
          `Entry '${jobId}' contains an invalid line; only labeled single-line bullets are allowed`,
          "- Compatibility: ...",
          rawLine,
        ),
      );
      continue;
    }

    fieldLines.push({
      label: match[1]!.trim(),
      value: match[2]!.trim(),
      line: lineNumber,
    });
  }

  if (fieldLines.length !== ENTRY_FIELD_ORDER.length) {
    errors.push(
      issue(
        "changelog.entry.field_count",
        firstLineNumber,
        `Entry '${jobId}' must declare exactly ${ENTRY_FIELD_ORDER.length} labeled bullets`,
        ENTRY_FIELD_ORDER.join(", "),
        fieldLines.map((field) => field.label),
      ),
    );
  }

  const byLabel = new Map<EntryFieldLabel, ParsedEntryFieldLine>();

  for (const [index, field] of fieldLines.entries()) {
    if (!entryFieldLabelSet.has(field.label)) {
      errors.push(
        issue(
          "changelog.entry.field_unknown",
          field.line,
          `Entry '${jobId}' contains an unknown field '${field.label}'`,
          ENTRY_FIELD_ORDER.join(", "),
          field.label,
        ),
      );
      continue;
    }

    const expectedLabel = ENTRY_FIELD_ORDER[index];
    if (expectedLabel && field.label !== expectedLabel) {
      errors.push(
        issue(
          "changelog.entry.field_order",
          field.line,
          `Entry '${jobId}' field '${field.label}' is out of order`,
          expectedLabel,
          field.label,
        ),
      );
    }

    const typedLabel = field.label as EntryFieldLabel;
    if (byLabel.has(typedLabel)) {
      errors.push(
        issue(
          "changelog.entry.field_duplicate",
          field.line,
          `Entry '${jobId}' repeats the '${field.label}' field`,
          "field appears once",
          field.label,
        ),
      );
      continue;
    }

    byLabel.set(typedLabel, field);
  }

  for (const label of ENTRY_FIELD_ORDER) {
    if (!byLabel.has(label)) {
      errors.push(
        issue(
          "changelog.entry.field_missing",
          firstLineNumber,
          `Entry '${jobId}' is missing the '${label}' field`,
          label,
          null,
        ),
      );
    }
  }

  const compatibilityField = byLabel.get("Compatibility");
  const summaryField = byLabel.get("Summary");
  const operatorActionField = byLabel.get("Operator action");
  const affectedSurfacesField = byLabel.get("Affected surfaces");

  if (!compatibilityField || !summaryField || !operatorActionField || !affectedSurfacesField) {
    return null;
  }

  const compatibilityClasses = parseCompatibilityClasses(jobId, compatibilityField, errors);
  const summary = parseRequiredValue(jobId, summaryField, errors);
  const operatorAction = parseRequiredValue(jobId, operatorActionField, errors);
  const affectedSurfaces = parseAffectedSurfaces(jobId, affectedSurfacesField, errors);

  if (compatibilityClasses.length === 0 || !summary || !operatorAction || affectedSurfaces.length === 0) {
    return null;
  }

  return {
    job_id: jobId,
    compatibility_classes: compatibilityClasses,
    summary,
    operator_action: operatorAction,
    affected_surfaces: affectedSurfaces,
  };
}

function parseCompatibilityClasses(
  jobId: string,
  field: ParsedEntryFieldLine,
  errors: ChangelogInspectionIssue[],
): CompatibilityClass[] {
  const values = field.value.split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) {
    errors.push(
      issue(
        "changelog.entry.compatibility.empty",
        field.line,
        `Entry '${jobId}' must declare at least one compatibility class`,
        COMPATIBILITY_CLASSES.join(", "),
        field.value,
      ),
    );
    return [];
  }

  const seen = new Set<string>();
  const classes: CompatibilityClass[] = [];

  for (const value of values) {
    if (!isCompatibilityClass(value)) {
      errors.push(
        issue(
          "changelog.entry.compatibility.invalid",
          field.line,
          `Entry '${jobId}' contains an unknown compatibility class '${value}'`,
          COMPATIBILITY_CLASSES.join(", "),
          value,
        ),
      );
      continue;
    }

    if (seen.has(value)) {
      errors.push(
        issue(
          "changelog.entry.compatibility.duplicate",
          field.line,
          `Entry '${jobId}' duplicates compatibility class '${value}'`,
          "unique compatibility classes",
          value,
        ),
      );
      continue;
    }

    seen.add(value);
    classes.push(value);
  }

  return classes;
}

function parseRequiredValue(
  jobId: string,
  field: ParsedEntryFieldLine,
  errors: ChangelogInspectionIssue[],
): string | null {
  if (field.value.trim().length > 0) {
    return field.value.trim();
  }

  errors.push(
    issue(
      "changelog.entry.value.empty",
      field.line,
      `Entry '${jobId}' field '${field.label}' must not be empty`,
      "non-empty single-line text",
      field.value,
    ),
  );
  return null;
}

function parseAffectedSurfaces(
  jobId: string,
  field: ParsedEntryFieldLine,
  errors: ChangelogInspectionIssue[],
): string[] {
  const values = field.value.split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length > 0) {
    return values;
  }

  errors.push(
    issue(
      "changelog.entry.affected_surfaces.empty",
      field.line,
      `Entry '${jobId}' must list at least one affected surface`,
      "comma-separated non-empty values",
      field.value,
    ),
  );
  return [];
}

function findNextNonEmptyLine(lines: string[], startIndex: number): number | null {
  for (let index = startIndex; index < lines.length; index += 1) {
    if ((lines[index] ?? "").trim().length > 0) {
      return index;
    }
  }

  return null;
}

function findNextLevelTwoHeading(lines: string[], startIndex: number): number | null {
  for (let index = startIndex; index < lines.length; index += 1) {
    if ((lines[index] ?? "").startsWith("## ")) {
      return index;
    }
  }

  return null;
}

function findNextEntryBoundary(lines: string[], startIndex: number): number | null {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith("### ") || line.startsWith("## ")) {
      return index;
    }
  }

  return null;
}

function finalizeInspection(
  filePath: string,
  errors: ChangelogInspectionIssue[],
  sections: ChangelogSection[],
): ChangelogInspection {
  return {
    schema: CHANGELOG_INSPECTION_OUTPUT_SCHEMA,
    status: errors.length > 0 ? "fail" : "pass",
    file_path: filePath,
    exists: true,
    errors,
    warnings: [],
    sections,
    total_entry_count: sections.reduce((sum, section) => sum + section.entries.length, 0),
  };
}

function failInspection(
  filePath: string,
  errors: ChangelogInspectionIssue[],
): ChangelogInspection {
  return {
    schema: CHANGELOG_INSPECTION_OUTPUT_SCHEMA,
    status: "fail",
    file_path: filePath,
    exists: true,
    errors,
    warnings: [],
    sections: [],
    total_entry_count: 0,
  };
}

function issue(
  code: string,
  line: number | null,
  message: string,
  expected: string | null,
  actual: unknown,
): ChangelogInspectionIssue {
  return {
    code,
    line,
    message,
    expected,
    actual,
  };
}
