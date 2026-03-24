#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path
import sys


def resolve_module_root(system_root: Path, module_id: str) -> Path:
    system_config_path = system_root / ".als" / "system.yaml"
    if not system_config_path.exists():
        raise ValueError(f"expected ALS system root with .als/system.yaml, got: {system_root}")

    in_modules = False
    in_target = False

    for raw_line in system_config_path.read_text().splitlines():
        if raw_line == "modules:":
            in_modules = True
            continue

        if not in_modules:
            continue

        if raw_line.startswith("  ") and not raw_line.startswith("    "):
            in_target = raw_line.strip() == f"{module_id}:"
            continue

        if in_target and raw_line.startswith("    path: "):
            module_path = raw_line.split(": ", 1)[1]
            return system_root / module_path

    raise ValueError(f"module '{module_id}' is missing from {system_config_path}")


def main(argv: list[str]) -> int:
    system_root = Path(argv[1]) if len(argv) > 1 else Path(".")

    try:
        module_root = resolve_module_root(system_root, "experiments")
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if not module_root.exists():
        print(f"error: module path does not exist: {module_root}", file=sys.stderr)
        return 1

    print("staged migration placeholder for experiments v1 -> v2")
    print("expected follow-up: backfill program client_ref, seed experiment budget, then validate against v2")
    print(f"system root: {system_root.resolve()}")
    print(f"target module path: {module_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
