#!/bin/bash
# Resolve the ALS runtime roots shared by skills and scan scripts.
#
# Executable usage:
#   bash skills/lib/runtime-env.sh plugin [claude|codex]
#   bash skills/lib/runtime-env.sh [claude|codex] [start-dir]
#   bash skills/lib/runtime-env.sh [start-dir]
#
# Harness resolution order is:
#   explicit request / ALS_HARNESS
#   live process env (CODEX_THREAD_ID or CLAUDE_CODE_ENTRYPOINT)
#   installed plugin cache path
#   system projection roots when a system root is available
# ALS_PLATFORM_CODE is then derived from the resolved harness plus the
# strongest harness-specific live signal currently available.
#
# Source usage:
#   source "$ALS_PLUGIN_ROOT/skills/lib/runtime-env.sh"
#   als_runtime_init_plugin_env codex
#   als_runtime_init_env codex "$PWD"

als_runtime_plugin_root() {
    cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P
}

als_runtime_find_system_root() {
    local sys_root="${1:-$(pwd)}"

    sys_root="$(cd "$sys_root" 2>/dev/null && pwd -P)" || return 1

    while [[ "$sys_root" != "/" ]]; do
        [[ -f "$sys_root/.als/system.ts" ]] && {
            printf '%s\n' "$sys_root"
            return 0
        }
        sys_root=$(dirname "$sys_root")
    done

    return 1
}

als_runtime_set_manifest_paths() {
    local plugin_root="$1"
    local harness="$2"

    case "$harness" in
        claude)
            ALS_PLUGIN_MANIFEST_PATH="$plugin_root/.claude-plugin/plugin.json"
            ALS_MARKETPLACE_MANIFEST_PATH="$plugin_root/.claude-plugin/marketplace.json"
            ;;
        codex)
            ALS_PLUGIN_MANIFEST_PATH="$plugin_root/.codex-plugin/plugin.json"
            ALS_MARKETPLACE_MANIFEST_PATH="$plugin_root/.agents/plugins/marketplace.json"
            ;;
        *)
            ALS_PLUGIN_MANIFEST_PATH=""
            ALS_MARKETPLACE_MANIFEST_PATH=""
            ALS_RUNTIME_ERROR="UNKNOWN_HARNESS: $harness"
            return 1
            ;;
    esac
}

als_runtime_resolve_platform_code() {
    local harness="$1"

    case "$harness" in
        codex)
            printf '%s\n' "ALS-PLAT-CXCLI"
            ;;
        claude)
            case "${CLAUDE_CODE_ENTRYPOINT:-}" in
                cli)
                    printf '%s\n' "ALS-PLAT-CCLI"
                    ;;
                claude-desktop)
                    printf '%s\n' "ALS-PLAT-CDSK"
                    ;;
                remote)
                    printf '%s\n' "ALS-PLAT-CWEB"
                    ;;
                *)
                    printf '%s\n' ""
                    ;;
            esac
            ;;
        *)
            printf '%s\n' ""
            ;;
    esac
}

als_runtime_resolve_harness() {
    local requested_harness="${1:-${ALS_HARNESS:-}}"
    local plugin_root="${2:-$(als_runtime_plugin_root)}"
    local sys_root="${3:-}"
    local has_codex_projection
    local has_claude_projection
    local has_codex_env="no"
    local has_claude_env="no"

    case "$requested_harness" in
        claude|codex)
            printf '%s\n' "$requested_harness"
            ;;
        "")
            if [[ -n "${CODEX_THREAD_ID:-}" ]]; then
                has_codex_env="yes"
            fi
            if [[ "${CLAUDE_CODE_ENTRYPOINT:-}" == "cli" || "${CLAUDE_CODE_ENTRYPOINT:-}" == "claude-desktop" || "${CLAUDE_CODE_ENTRYPOINT:-}" == "remote" ]]; then
                has_claude_env="yes"
            fi

            if [[ "$has_codex_env" == "yes" && "$has_claude_env" == "no" ]]; then
                printf '%s\n' "codex"
            elif [[ "$has_claude_env" == "yes" && "$has_codex_env" == "no" ]]; then
                printf '%s\n' "claude"
            elif [[ "$has_codex_env" == "yes" && "$has_claude_env" == "yes" ]]; then
                ALS_RUNTIME_ERROR="AMBIGUOUS_HARNESS: both CODEX_THREAD_ID and CLAUDE_CODE_ENTRYPOINT are set; pass claude|codex or set ALS_HARNESS"
                printf '%s\n' "$ALS_RUNTIME_ERROR"
                return 1
            elif [[ "$plugin_root" == *"/.codex/"* ]]; then
                printf '%s\n' "codex"
            elif [[ "$plugin_root" == *"/.claude/"* ]]; then
                printf '%s\n' "claude"
            elif [[ -n "$sys_root" ]]; then
                has_codex_projection="no"
                has_claude_projection="no"

                if [[ -d "$sys_root/.codex/delamains" || -d "$sys_root/.agents/skills" || -f "$sys_root/.als/AGENTS.md" ]]; then
                    has_codex_projection="yes"
                fi
                if [[ -d "$sys_root/.claude/delamains" || -d "$sys_root/.claude/skills" || -f "$sys_root/.als/CLAUDE.md" ]]; then
                    has_claude_projection="yes"
                fi

                if [[ "$has_codex_projection" == "yes" && "$has_claude_projection" == "no" ]]; then
                    printf '%s\n' "codex"
                elif [[ "$has_claude_projection" == "yes" && "$has_codex_projection" == "no" ]]; then
                    printf '%s\n' "claude"
                elif [[ "$has_codex_projection" == "yes" && "$has_claude_projection" == "yes" ]]; then
                    ALS_RUNTIME_ERROR="AMBIGUOUS_HARNESS: both codex and claude projection surfaces exist; pass claude|codex or set ALS_HARNESS"
                    printf '%s\n' "$ALS_RUNTIME_ERROR"
                    return 1
                else
                    ALS_RUNTIME_ERROR="UNKNOWN_HARNESS: no harness signal from live env, plugin path, or system projection; pass claude|codex or set ALS_HARNESS"
                    printf '%s\n' "$ALS_RUNTIME_ERROR"
                    return 1
                fi
            else
                ALS_RUNTIME_ERROR="UNKNOWN_HARNESS: no harness signal from live env, plugin path, or system projection; pass claude|codex or set ALS_HARNESS"
                printf '%s\n' "$ALS_RUNTIME_ERROR"
                return 1
            fi
            ;;
        *)
            ALS_RUNTIME_ERROR="UNKNOWN_HARNESS: $requested_harness"
            printf '%s\n' "$ALS_RUNTIME_ERROR"
            return 1
            ;;
    esac
}

als_runtime_init_plugin_env() {
    local requested_harness="${1:-${ALS_HARNESS:-}}"
    local plugin_root
    local harness

    plugin_root="$(als_runtime_plugin_root)"
    ALS_RUNTIME_ERROR=""

    if ! harness="$(als_runtime_resolve_harness "$requested_harness" "$plugin_root")"; then
        ALS_RUNTIME_ERROR="${harness:-${ALS_RUNTIME_ERROR:-UNKNOWN_HARNESS}}"
        return 1
    fi

    ALS_PLUGIN_ROOT="$plugin_root"
    HARNESS="$harness"
    ALS_PLATFORM_CODE="$(als_runtime_resolve_platform_code "$harness")"
    if ! als_runtime_set_manifest_paths "$plugin_root" "$harness"; then
        return 1
    fi

    ALS_RUNTIME_PLUGIN_ROOT="$ALS_PLUGIN_ROOT"
    ALS_RUNTIME_HARNESS="$HARNESS"
    ALS_RUNTIME_PLATFORM_CODE="$ALS_PLATFORM_CODE"
    ALS_RUNTIME_PLUGIN_MANIFEST_PATH="$ALS_PLUGIN_MANIFEST_PATH"
    ALS_RUNTIME_MARKETPLACE_MANIFEST_PATH="$ALS_MARKETPLACE_MANIFEST_PATH"

    export ALS_PLUGIN_ROOT
    export HARNESS
    export ALS_PLATFORM_CODE
    export ALS_PLUGIN_MANIFEST_PATH
    export ALS_MARKETPLACE_MANIFEST_PATH
    return 0
}

als_runtime_init_env() {
    local requested_harness="${1:-${ALS_HARNESS:-}}"
    local start_dir="${2:-$(pwd)}"
    local plugin_root
    local sys_root
    local harness
    local skills_root
    local delamains_root
    local delamain_roots_file
    local system_instruction_path
    local transaction_roots
    local statusline_cache_root
    local statusline_supported
    local session_end_cleanup_supported

    plugin_root="$(als_runtime_plugin_root)"
    ALS_RUNTIME_ERROR=""

    if ! sys_root="$(als_runtime_find_system_root "$start_dir")"; then
        ALS_RUNTIME_ERROR="NO_SYSTEM"
        return 1
    fi

    if ! harness="$(als_runtime_resolve_harness "$requested_harness" "$plugin_root" "$sys_root")"; then
        ALS_RUNTIME_ERROR="${harness:-${ALS_RUNTIME_ERROR:-UNKNOWN_HARNESS}}"
        return 1
    fi

    case "$harness" in
        claude)
            skills_root="$sys_root/.claude/skills"
            delamains_root="$sys_root/.claude/delamains"
            delamain_roots_file="$sys_root/.claude/delamain-roots"
            system_instruction_path="$sys_root/.als/CLAUDE.md"
            transaction_roots=".als .claude"
            statusline_cache_root="$sys_root/.claude/scripts/.cache/pulse"
            statusline_supported="yes"
            session_end_cleanup_supported="yes"
            ;;
        codex)
            skills_root="$sys_root/.agents/skills"
            delamains_root="$sys_root/.codex/delamains"
            delamain_roots_file="$sys_root/.codex/delamain-roots"
            system_instruction_path="$sys_root/.als/AGENTS.md"
            transaction_roots=".als .agents .codex"
            statusline_cache_root=""
            statusline_supported="no"
            session_end_cleanup_supported="no"
            ;;
    esac

    ALS_PLUGIN_ROOT="$plugin_root"
    SYSTEM_ROOT="$sys_root"
    HARNESS="$harness"
    ALS_PLATFORM_CODE="$(als_runtime_resolve_platform_code "$harness")"
    if ! als_runtime_set_manifest_paths "$plugin_root" "$harness"; then
        return 1
    fi
    SKILLS_ROOT="$skills_root"
    DELAMAINS_ROOT="$delamains_root"
    DELAMAIN_ROOTS_FILE="$delamain_roots_file"
    SYSTEM_INSTRUCTION_PATH="$system_instruction_path"
    TRANSACTION_ROOTS="$transaction_roots"
    STATUSLINE_CACHE_ROOT="$statusline_cache_root"
    STATUSLINE_SUPPORTED="$statusline_supported"
    SESSION_END_CLEANUP_SUPPORTED="$session_end_cleanup_supported"

    ALS_RUNTIME_PLUGIN_ROOT="$ALS_PLUGIN_ROOT"
    ALS_RUNTIME_SYSTEM_ROOT="$SYSTEM_ROOT"
    ALS_RUNTIME_HARNESS="$HARNESS"
    ALS_RUNTIME_PLATFORM_CODE="$ALS_PLATFORM_CODE"
    ALS_RUNTIME_PLUGIN_MANIFEST_PATH="$ALS_PLUGIN_MANIFEST_PATH"
    ALS_RUNTIME_MARKETPLACE_MANIFEST_PATH="$ALS_MARKETPLACE_MANIFEST_PATH"
    ALS_RUNTIME_SKILLS_ROOT="$SKILLS_ROOT"
    ALS_RUNTIME_DELAMAINS_ROOT="$DELAMAINS_ROOT"
    ALS_RUNTIME_DELAMAIN_ROOTS_FILE="$DELAMAIN_ROOTS_FILE"
    ALS_RUNTIME_SYSTEM_INSTRUCTION_PATH="$SYSTEM_INSTRUCTION_PATH"
    ALS_RUNTIME_TRANSACTION_ROOTS="$TRANSACTION_ROOTS"
    ALS_RUNTIME_STATUSLINE_CACHE_ROOT="$STATUSLINE_CACHE_ROOT"
    ALS_RUNTIME_STATUSLINE_SUPPORTED="$STATUSLINE_SUPPORTED"
    ALS_RUNTIME_SESSION_END_CLEANUP_SUPPORTED="$SESSION_END_CLEANUP_SUPPORTED"

    export ALS_PLUGIN_ROOT
    export SYSTEM_ROOT
    export HARNESS
    export ALS_PLATFORM_CODE
    export ALS_PLUGIN_MANIFEST_PATH
    export ALS_MARKETPLACE_MANIFEST_PATH
    export SKILLS_ROOT
    export DELAMAINS_ROOT
    export DELAMAIN_ROOTS_FILE
    export SYSTEM_INSTRUCTION_PATH
    export TRANSACTION_ROOTS
    export STATUSLINE_CACHE_ROOT
    export STATUSLINE_SUPPORTED
    export SESSION_END_CLEANUP_SUPPORTED
    return 0
}

als_runtime_emit_plugin_env() {
    echo "ALS_PLUGIN_ROOT: $ALS_PLUGIN_ROOT"
    echo "HARNESS: $HARNESS"
    echo "ALS_PLATFORM_CODE: $ALS_PLATFORM_CODE"
    echo "ALS_PLUGIN_MANIFEST_PATH: $ALS_PLUGIN_MANIFEST_PATH"
    echo "ALS_MARKETPLACE_MANIFEST_PATH: $ALS_MARKETPLACE_MANIFEST_PATH"
}

als_runtime_emit_env() {
    echo "ALS_PLUGIN_ROOT: $ALS_PLUGIN_ROOT"
    echo "SYSTEM_ROOT: $SYSTEM_ROOT"
    echo "HARNESS: $HARNESS"
    echo "ALS_PLATFORM_CODE: $ALS_PLATFORM_CODE"
    echo "SKILLS_ROOT: $SKILLS_ROOT"
    echo "DELAMAINS_ROOT: $DELAMAINS_ROOT"
    echo "DELAMAIN_ROOTS_FILE: $DELAMAIN_ROOTS_FILE"
    echo "SYSTEM_INSTRUCTION_PATH: $SYSTEM_INSTRUCTION_PATH"
    echo "TRANSACTION_ROOTS: $TRANSACTION_ROOTS"
    echo "STATUSLINE_CACHE_ROOT: $STATUSLINE_CACHE_ROOT"
    echo "STATUSLINE_SUPPORTED: $STATUSLINE_SUPPORTED"
    echo "SESSION_END_CLEANUP_SUPPORTED: $SESSION_END_CLEANUP_SUPPORTED"
}

als_runtime_print_plugin_env() {
    if ! als_runtime_init_plugin_env "${1:-${ALS_HARNESS:-}}"; then
        echo "$ALS_RUNTIME_ERROR"
        return 0
    fi

    als_runtime_emit_plugin_env
}

als_runtime_print_env() {
    if ! als_runtime_init_env "${1:-${ALS_HARNESS:-}}" "${2:-$(pwd)}"; then
        echo "$ALS_RUNTIME_ERROR"
        return 0
    fi

    als_runtime_emit_env
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    case "${1:-}" in
        plugin)
            als_runtime_print_plugin_env "${2:-}"
            ;;
        claude|codex|"")
            als_runtime_print_env "${1:-}" "${2:-$(pwd)}"
            ;;
        *)
            als_runtime_print_env "" "$1"
            ;;
    esac
fi
