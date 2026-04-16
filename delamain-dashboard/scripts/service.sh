#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SYSTEM_ROOT="${1:-$(pwd)}"

cd "$APP_DIR"
bun run src/index.ts service --system-root "$SYSTEM_ROOT" "${@:2}"
