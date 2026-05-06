#!/usr/bin/env bash
set -euo pipefail

SYSTEM_ROOT_INPUT="${1:-.}"
SYSTEM_ROOT="$(cd -- "${SYSTEM_ROOT_INPUT}" && pwd)"
COMMIT_MESSAGE="chore: clean tracked runtime ephemera before ALS v2 upgrade"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
HELPER_PATH="${SCRIPT_DIR}/../../../../alsc/shared/transient-runtime.ts"

if ! git -C "${SYSTEM_ROOT}" rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "cleanup-tracked-runtime-ephemera: '${SYSTEM_ROOT}' is not a git repository" >&2
  exit 1
fi

bun "${HELPER_PATH}" cleanup \
  --system-root "${SYSTEM_ROOT}" \
  --commit-message "${COMMIT_MESSAGE}" \
  >/dev/null
