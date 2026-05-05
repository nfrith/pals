#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
PLUGIN_ROOT="$(cd -- "${SCRIPT_DIR}/../../../.." && pwd)"

bun run "${SCRIPT_DIR}/apply-dispatcher-cutover.ts" "$PWD" "$PLUGIN_ROOT"
