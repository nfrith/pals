#!/usr/bin/env python3
"""Deterministic, idempotent migration for experiments v1 -> v2.

- Adds `budget` frontmatter key to experiment records when missing.
- Defaulting strategy:
  - status in {active, paused, completed} -> budget = 1000
  - otherwise -> budget = null
"""

from __future__ import annotations

import pathlib
import re
from typing import Optional

ROOT = pathlib.Path("workspace/experiments/programs")

STATUS_RE = re.compile(r"^status:\s*(.+?)\s*$", re.MULTILINE)
BUDGET_RE = re.compile(r"^budget:\s*(.+?)\s*$", re.MULTILINE)


def parse_status(text: str) -> Optional[str]:
    match = STATUS_RE.search(text)
    if not match:
        return None
    value = match.group(1).strip()
    return value.strip("\"'")


def budget_line_for_status(status: Optional[str]) -> str:
    if status in {"active", "paused", "completed"}:
        return "budget: 1000"
    return "budget: null"


def migrate_file(path: pathlib.Path) -> str:
    text = path.read_text()
    if "\n---\n" not in text:
        return "skipped:no-frontmatter"

    if BUDGET_RE.search(text):
        return "unchanged"

    frontmatter_end = text.find("\n---\n", 4)
    if frontmatter_end == -1:
        return "skipped:malformed-frontmatter"

    status = parse_status(text[: frontmatter_end + 1])
    budget_line = budget_line_for_status(status)
    injected = text[:frontmatter_end] + f"\n{budget_line}" + text[frontmatter_end:]
    path.write_text(injected)
    return "updated"


def main() -> int:
    if not ROOT.exists():
        print("root-not-found")
        return 1

    changed = 0
    unchanged = 0
    skipped = 0

    for path in sorted(ROOT.glob("PRG-*/experiments/EXP-*/EXP-*.md")):
        result = migrate_file(path)
        if result == "updated":
            changed += 1
        elif result == "unchanged":
            unchanged += 1
        else:
            skipped += 1
        print(f"{result}: {path}")

    print(f"summary changed={changed} unchanged={unchanged} skipped={skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
