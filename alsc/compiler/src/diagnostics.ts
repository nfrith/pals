import type { CompilerDiagnostic, DiagnosticSeverity, ValidationPhase } from "./types.ts";

export const codes = {
  SYSTEM_INVALID: "PAL-CV-SYS-001",
  SYSTEM_FILTER_UNKNOWN: "PAL-CV-SYS-002",
  // PAL-CV-SYS-003 was retired when system roots were removed from the ALS v1 system config.
  SYSTEM_MODULE_PATH_INVALID: "PAL-CV-SYS-004",
  SYSTEM_MODULE_PATH_CONFLICT: "PAL-CV-SYS-005",
  SYSTEM_ALS_VERSION_INVALID: "PAL-CV-SYS-006",
  SYSTEM_ALS_VERSION_UNSUPPORTED: "PAL-CV-SYS-007",
  SYSTEM_MODULE_BUNDLE_INVALID: "PAL-CV-SYS-008",
  SYSTEM_MODULE_SKILLS_INVALID: "PAL-CV-SYS-009",
  SYSTEM_MODULE_MIGRATIONS_INVALID: "PAL-CV-SYS-010",
  SYSTEM_FILTER_CONTEXT_INVALID: "PAL-CV-SYS-011",
  SHAPE_INVALID: "PAL-CV-SHAPE-001",
  SHAPE_CONTRACT_INVALID: "PAL-CV-SHAPE-003",
  SHAPE_FILE_MISSING: "PAL-CV-SHAPE-004",
  DELAMAIN_INVALID: "PAL-CV-DEL-001",
  DELAMAIN_CONTRACT_INVALID: "PAL-CV-DEL-002",
  DELAMAIN_FILE_INVALID: "PAL-CV-DEL-003",
  DELAMAIN_PROMPT_INVALID: "PAL-CV-DEL-004",
  BODY_CONSTRAINT_VIOLATION: "PAL-CV-BODY-001",
  BODY_ORDER_MISMATCH: "PAL-CV-BODY-002",

  PARSE_FRONTMATTER: "PAL-RV-PARSE-001",
  PARSE_MARKDOWN: "PAL-RV-PARSE-002",
  PARSE_ENTITY_INFER: "PAL-RV-PARSE-003",
  PARSE_DISCOVERY_UNREADABLE_DIR: "PAL-RV-PARSE-004",
  PARSE_MARKDOWN_EXTENSION_CASE: "PAL-RV-PARSE-005",
  PARSE_JSONL: "PAL-RV-PARSE-006",
  PARSE_JSONL_EXTENSION_CASE: "PAL-RV-PARSE-007",

  FM_MISSING_FIELD: "PAL-RV-FM-001",
  FM_UNKNOWN_FIELD: "PAL-RV-FM-002",
  FM_ENUM_INVALID: "PAL-RV-FM-003",
  FM_TYPE_MISMATCH: "PAL-RV-FM-004",
  FM_DATE_FORMAT: "PAL-RV-FM-005",
  FM_REF_FORMAT: "PAL-RV-FM-006",
  FM_ARRAY_ITEM: "PAL-RV-FM-007",
  FM_VARIANT_UNRESOLVED: "PAL-RV-FM-008",
  FM_FILE_PATH_FORMAT: "PAL-RV-FM-009",
  FM_FILE_PATH_TARGET: "PAL-RV-FM-010",

  ROW_MISSING_FIELD: "PAL-RV-ROW-001",
  ROW_UNKNOWN_FIELD: "PAL-RV-ROW-002",
  ROW_ENUM_INVALID: "PAL-RV-ROW-003",
  ROW_TYPE_MISMATCH: "PAL-RV-ROW-004",
  ROW_DATE_FORMAT: "PAL-RV-ROW-005",
  ROW_ARRAY_ITEM: "PAL-RV-ROW-006",

  BODY_MISSING_SECTION: "PAL-RV-BODY-001",
  BODY_UNKNOWN_SECTION: "PAL-RV-BODY-002",
  BODY_NULL_NOT_ALLOWED: "PAL-RV-BODY-003",
  BODY_VARIANT_UNRESOLVED: "PAL-RV-BODY-004",
  BODY_EMPTY_MARKER: "PAL-RV-BODY-005",
  BODY_UNSUPPORTED_MARKDOWN: "PAL-RV-BODY-006",

  ID_FILENAME_MISMATCH: "PAL-RV-ID-001",
  ID_DUPLICATE: "PAL-RV-ID-002",

  REF_CONTRACT_MISMATCH: "PAL-RV-REF-002",
  REF_UNRESOLVED: "PAL-RV-REF-003",
  REF_ENTITY_MISMATCH: "PAL-RV-REF-004",
  REF_PARENT_PREFIX: "PAL-RV-REF-006",
} as const;

// Stable machine-readable subcodes are being rolled out incrementally.
// Older diagnostics still emit null for reason until each call site is upgraded.
export const reasons = {
  AUTHORED_SOURCE_READ_FAILED: "authored_source.read_failed",
  AUTHORED_SOURCE_LOAD_FAILED: "authored_source.load_failed",
  AUTHORED_SOURCE_EXPORT_MISSING: "authored_source.export_missing",
  AUTHORED_SOURCE_VALUE_UNSUPPORTED: "authored_source.value_unsupported",
  SYSTEM_ALS_VERSION_INVALID: "system.als_version.invalid",
  SYSTEM_ALS_VERSION_UNSUPPORTED: "system.als_version.unsupported",
  SYSTEM_FILTER_CONTEXT_INVALID: "system.filter_context.invalid",
  SYSTEM_SKILL_REMOVED: "system.skill.removed",
  SYSTEM_SKILLS_DUPLICATE: "system.skills.duplicate",
  SYSTEM_SKILLS_GLOBAL_DUPLICATE: "system.skills.global_duplicate",
  SYSTEM_SCHEMA_REMOVED: "system.schema.removed",
  SYSTEM_MODULE_BUNDLE_MISSING: "system.module_bundle.missing",
  SYSTEM_MODULE_BUNDLE_NOT_DIRECTORY: "system.module_bundle.not_directory",
  SYSTEM_SHAPE_FILE_MISSING: "system.shape_file.missing",
  SYSTEM_SHAPE_FILE_NOT_FILE: "system.shape_file.not_file",
  SYSTEM_SKILLS_DIR_MISSING: "system.skills_dir.missing",
  SYSTEM_SKILLS_DIR_NOT_DIRECTORY: "system.skills_dir.not_directory",
  SYSTEM_SKILLS_DIR_UNREADABLE: "system.skills_dir.unreadable",
  SYSTEM_SKILL_ENTRY_MISSING: "system.skill_entry.missing",
  SYSTEM_SKILL_ENTRY_NOT_FILE: "system.skill_entry.not_file",
  SYSTEM_SKILLS_UNLISTED_DIRECTORY: "system.skills.unlisted_directory",
  SYSTEM_SKILLS_UNEXPECTED_ROOT_FILE: "system.skills.unexpected_root_file",
  SYSTEM_MIGRATIONS_DIR_MISSING: "system.migrations_dir.missing",
  SYSTEM_MIGRATIONS_DIR_NOT_DIRECTORY: "system.migrations_dir.not_directory",
  SYSTEM_MIGRATION_MANIFEST_MISSING: "system.migration_manifest.missing",
  SYSTEM_MIGRATION_MANIFEST_NOT_FILE: "system.migration_manifest.not_file",
  SYSTEM_MIGRATION_ASSET_MISSING: "system.migration_asset.missing",
  MODULE_SHAPE_SCHEMA_REMOVED: "module_shape.schema.removed",
  DELAMAIN_BUNDLE_TARGET_MISSING: "delamain.bundle.target_missing",
  DELAMAIN_BUNDLE_TARGET_NOT_FILE: "delamain.bundle.target_not_file",
  DELAMAIN_BUNDLE_TARGET_UNREADABLE: "delamain.bundle.target_unreadable",
  DELAMAIN_BUNDLE_PATH_ESCAPE: "delamain.bundle.path_escape",
  DELAMAIN_ASSET_TARGET_MISSING: "delamain.asset.target_missing",
  DELAMAIN_ASSET_TARGET_NOT_FILE: "delamain.asset.target_not_file",
  DELAMAIN_ASSET_TARGET_UNREADABLE: "delamain.asset.target_unreadable",
  DELAMAIN_ASSET_PATH_ESCAPE: "delamain.asset.path_escape",
  DELAMAIN_BINDING_UNRESOLVED: "delamain.binding.unresolved",
  DELAMAIN_SESSION_FIELD_COLLISION: "delamain.session_field.collision",
  DELAMAIN_EFFECTIVE_FIELD_CONFLICT: "delamain.effective_field.conflict",
  SHAPE_LEGACY_REQUIRED_KEY: "shape.legacy_required_key",
  BODY_TITLE_MULTIPLE_H1: "body.title.multiple_h1",
  BODY_TITLE_CONTENT_BEFORE_DECLARED: "body.title.content_before_declared",
  BODY_TITLE_MISSING_DECLARED: "body.title.missing_declared",
  BODY_TITLE_SOURCE_INVALID: "body.title.source_invalid",
  BODY_TITLE_MISMATCH: "body.title.mismatch",
  BODY_TITLE_UNDECLARED: "body.title.undeclared",
  BODY_PREAMBLE_UNDECLARED: "body.preamble.undeclared",
  BODY_SECTION_DUPLICATE: "body.section.duplicate_top_level",
  BODY_REGION_LIST_MIN_ITEMS: "body.region.list.min_items",
  BODY_REGION_LIST_MAX_ITEMS: "body.region.list.max_items",
  BODY_REGION_HEADING_STRUCTURAL_DEPTH: "body.region.heading.structural_depth",
  BODY_REGION_HEADING_MIN_DEPTH: "body.region.heading.min_depth",
  BODY_REGION_HEADING_MAX_DEPTH: "body.region.heading.max_depth",
  BODY_REGION_CODE_LANGUAGE_REQUIRED: "body.region.code.language_required",
  BODY_OUTLINE_NODE_MISSING: "body.outline.node.missing",
  BODY_OUTLINE_NODE_STRUCTURAL_DEPTH: "body.outline.node.structural_depth",
  BODY_OUTLINE_PREAMBLE_UNDECLARED: "body.outline.preamble.undeclared",
  BODY_REGION_BLOCK_COUNT_MIN: "body.region.block.min_count",
  BODY_REGION_BLOCK_COUNT_MAX: "body.region.block.max_count",
  BODY_REGION_BLOCK_UNSUPPORTED: "body.region.block.unsupported",
  BODY_MARKDOWN_REFERENCE_STYLE_UNSUPPORTED: "body.markdown.reference_style_unsupported",
  BODY_MARKDOWN_FLOW_HTML_UNSUPPORTED: "body.markdown.flow_html_unsupported",
  BODY_MARKDOWN_INLINE_HTML_UNSUPPORTED: "body.markdown.inline_html_unsupported",
  BODY_MARKDOWN_THEMATIC_BREAK_UNSUPPORTED: "body.markdown.thematic_break_unsupported",
  FRONTMATTER_LIST_ITEM_DUPLICATE: "frontmatter.list_item.duplicate",
  JSONL_LINE_INVALID: "jsonl.line.invalid",
  JSONL_LINE_NOT_OBJECT: "jsonl.line.not_object",
  ROW_LIST_ITEM_DUPLICATE: "row.list_item.duplicate",
  FRONTMATTER_FILE_PATH_INVALID: "frontmatter.file_path.invalid",
  FRONTMATTER_FILE_PATH_TARGET_MISSING: "frontmatter.file_path.target_missing",
  FRONTMATTER_FILE_PATH_TARGET_NOT_FILE: "frontmatter.file_path.target_not_file",
  FRONTMATTER_FILE_PATH_TARGET_UNREADABLE: "frontmatter.file_path.target_unreadable",
} as const;

export function diag(
  code: string,
  severity: DiagnosticSeverity,
  phase: ValidationPhase,
  file: string,
  message: string,
  opts: {
    module_id?: string;
    entity?: string;
    field?: string;
    reason?: string;
    expected?: unknown;
    actual?: unknown;
    hint?: string;
    line?: number;
    column?: number;
  } = {},
): CompilerDiagnostic {
  return {
    code,
    reason: opts.reason ?? null,
    severity,
    phase,
    file,
    location: {
      line: opts.line ?? null,
      column: opts.column ?? null,
    },
    module_id: opts.module_id ?? null,
    entity: opts.entity ?? null,
    field: opts.field ?? null,
    message,
    expected: opts.expected ?? null,
    actual: opts.actual ?? null,
    hint: opts.hint ?? null,
  };
}

export function computeStatus(diagnostics: CompilerDiagnostic[]): "pass" | "warn" | "fail" {
  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  if (hasErrors) return "fail";
  const hasWarnings = diagnostics.some((diagnostic) => diagnostic.severity === "warning");
  return hasWarnings ? "warn" : "pass";
}
