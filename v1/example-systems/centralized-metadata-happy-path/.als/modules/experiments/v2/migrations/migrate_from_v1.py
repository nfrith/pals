#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path
import sys


def main(argv: list[str]) -> int:
    root = Path(argv[1]) if len(argv) > 1 else Path("workspace/experiments")
    if not root.exists():
        print(f"error: path does not exist: {root}", file=sys.stderr)
        return 1

    print("staged migration placeholder for experiments v1 -> v2")
    print("expected follow-up: backfill program client_ref, seed experiment budget, then validate against v2")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
