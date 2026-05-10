#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path
import subprocess
import sys


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
