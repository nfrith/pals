#!/bin/bash
# Ensures compiler dependencies are installed. Called by skill preprocessors.
cd "${CLAUDE_PLUGIN_ROOT}/alsc/compiler" || exit 0
if [ -d node_modules ]; then
  echo "deps ready"
else
  bun install 2>&1
fi
