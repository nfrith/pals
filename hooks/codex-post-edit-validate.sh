#!/bin/bash
# Codex PostToolUse validation adapter.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$script_dir/codex-post-edit-dispatch.sh" "$script_dir/als-validate.sh"
