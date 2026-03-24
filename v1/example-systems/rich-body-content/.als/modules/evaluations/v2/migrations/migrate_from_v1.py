#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path
import sys


OWNER_BY_CATEGORY = {
    "infrastructure": "platform-infra",
    "tooling": "developer-experience",
    "vendor": "platform-operations",
    "library": "developer-experience",
}


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
    root = Path(argv[1]) if len(argv) > 1 else Path("governance/evaluations")
    if not root.exists():
        print(f"error: path does not exist: {root}", file=sys.stderr)
        return 1

    changed = 0
    for record_path in sorted(root.glob("*.md")):
        changed += int(migrate_record(record_path))

    print(f"done: migrated {changed} record(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
