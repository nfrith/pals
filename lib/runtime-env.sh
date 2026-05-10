#!/bin/bash
# Compatibility entrypoint for skill runners that resolve {skill-dir} to
# the shared skills directory instead of an individual skill directory.

ALS_RUNTIME_ENV_IMPL="$(cd "$(dirname "${BASH_SOURCE[0]}")/../skills/lib" && pwd -P)/runtime-env.sh"

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    exec bash "$ALS_RUNTIME_ENV_IMPL" "$@"
fi

source "$ALS_RUNTIME_ENV_IMPL"
