#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_URL="${DELAMAIN_DASHBOARD_URL:-${1:-http://127.0.0.1:4646}}"

cd "$APP_DIR"
bun run src/index.ts tui --service-url "$SERVICE_URL" "${@:2}"
