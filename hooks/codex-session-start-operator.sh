#!/bin/bash
# Codex SessionStart adapter for the shared ALS operator-profile hook.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugin_root="${ALS_PLUGIN_ROOT:-}"
if [[ -z "$plugin_root" ]]; then
  plugin_root="$(cd "$script_dir/.." && pwd)"
fi
export ALS_PLUGIN_ROOT="$plugin_root"

exec bash "$script_dir/operator-config-session-start.sh"
