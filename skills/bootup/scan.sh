#!/bin/bash
# Scan delamain fleet state for /bootup via the shared process-truth seam.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

bash "$PLUGIN_ROOT/hooks/delamain-fleet.sh" scan --cwd "$(pwd)"
