#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"

bun run "${SCRIPT_DIR}/generate-state-labels-and-outcomes.ts" "$PWD"
