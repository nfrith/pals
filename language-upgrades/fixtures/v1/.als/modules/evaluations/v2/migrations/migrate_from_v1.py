#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path
import subprocess
import sys


OWNER_BY_CATEGORY = {
    "infrastructure": "platform-infra",
    "tooling": "developer-experience",
    "vendor": "platform-operations",
    "library": "developer-experience",
}


def resolve_module_root(system_root: Path, module_id: str) -> Path:
    system_config_path = system_root / ".als" / "system.ts"
    if not system_config_path.exists():
        raise ValueError(f"expected ALS system root with .als/system.ts, got: {system_root}")

    script = """
const [systemPath, moduleId] = process.argv.slice(1);
try {
  const requireFn = require;
  const resolvedPath = requireFn.resolve(systemPath);
  delete requireFn.cache?.[resolvedPath];
  const loaded = requireFn(resolvedPath);
  const system = loaded.system ?? loaded.default;
  const moduleConfig = system?.modules?.[moduleId];
  if (!moduleConfig?.path) {
    throw new Error(`module '${moduleId}' is missing from ${systemPath}`);
  }
  process.stdout.write(String(moduleConfig.path));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message);
  process.exit(1);
}
"""

    try:
        result = subprocess.run(
            ["bun", "-e", script, str(system_config_path), module_id],
            capture_output=True,
            check=False,
            text=True,
        )
    except FileNotFoundError as exc:
        raise ValueError("bun is required to resolve ALS module mounts from system.ts") from exc

    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "unknown bun error"
        raise ValueError(f"could not resolve module '{module_id}' from {system_config_path}: {detail}")

    module_path = result.stdout.strip()
    if not module_path:
        raise ValueError(f"module '{module_id}' is missing from {system_config_path}")

    return system_root / module_path


def split_frontmatter(text: str) -> tuple[list[str], list[str]]:
    lines = text.splitlines()
    if len(lines) < 3 or lines[0] != "---":
        raise ValueError("record is missing YAML frontmatter start fence")

    try:
        closing_index = lines.index("---", 1)
    except ValueError as exc:
        raise ValueError("record is missing YAML frontmatter end fence") from exc

    return lines[1:closing_index], lines[closing_index + 1 :]


def rewrite_frontmatter(frontmatter_lines: list[str]) -> tuple[list[str], bool]:
    updated: list[str] = []
    changed = False
    category: str | None = None
    saw_owner = False

    for line in frontmatter_lines:
        if line.startswith("category: "):
            category = line.split(": ", 1)[1]
            updated.append(line)
            continue

        if line.startswith("owner: "):
            saw_owner = True
            updated.append(line)
            continue

        if line.startswith("decision: "):
            updated.append(line.replace("decision:", "outcome:", 1))
            changed = True
            continue

        updated.append(line)

    if not saw_owner:
        if category is None:
            raise ValueError("record is missing required category field for owner backfill")
        owner = OWNER_BY_CATEGORY.get(category, "governance")
        insert_at = next(
            (index + 1 for index, line in enumerate(updated) if line.startswith("category: ")),
            len(updated),
        )
        updated.insert(insert_at, f"owner: {owner}")
        changed = True

    return updated, changed


def rewrite_body(body_lines: list[str]) -> tuple[list[str], bool]:
    updated: list[str] = []
    changed = False

    for line in body_lines:
        if line == "## DECISION":
            updated.append("## OUTCOME")
            changed = True
            continue
        updated.append(line)

    return updated, changed


def migrate_record(path: Path) -> bool:
    original = path.read_text()
    frontmatter_lines, body_lines = split_frontmatter(original)
    next_frontmatter, fm_changed = rewrite_frontmatter(frontmatter_lines)
    next_body, body_changed = rewrite_body(body_lines)

    if not fm_changed and not body_changed:
        print(f"SKIP {path}")
        return False

    migrated = "---\n" + "\n".join(next_frontmatter) + "\n---\n" + "\n".join(next_body)
    if original.endswith("\n"):
        migrated += "\n"
    path.write_text(migrated)
    print(f"MIGRATE {path}")
    return True


def main(argv: list[str]) -> int:
    system_root = Path(argv[1]) if len(argv) > 1 else Path(".")

    try:
        root = resolve_module_root(system_root, "evaluations")
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if not root.exists():
        print(f"error: module path does not exist: {root}", file=sys.stderr)
        return 1

    changed = 0
    for record_path in sorted(root.glob("*.md")):
        changed += int(migrate_record(record_path))

    print(f"system root: {system_root.resolve()}")
    print(f"done: migrated {changed} record(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
