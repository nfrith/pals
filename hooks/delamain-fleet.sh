#!/bin/bash
# Shared dispatcher fleet scan/cleanup seam for /bootup and SessionEnd.

set -euo pipefail

usage() {
    cat >&2 <<'EOF'
Usage:
  delamain-fleet.sh scan [--cwd <path>] [--system-root <path>]
  delamain-fleet.sh cleanup --system-root <path> [--caller <name>] [--quiet]
  delamain-fleet.sh resolve-system-root [--cwd <path>]
EOF
    exit 1
}

join_lines() {
    awk 'NF' | paste -sd' ' -
}

walk_system_root() {
    local start_dir="$1"
    local dir="$start_dir"

    while [[ "$dir" != "/" ]]; do
        if [[ -f "$dir/.als/system.ts" ]]; then
            printf '%s\n' "$dir"
            return 0
        fi
        dir=$(dirname "$dir")
    done

    return 1
}

all_delamain_names() {
    local system_root="$1"

    for dy in "$system_root"/.claude/delamains/*/delamain.yaml; do
        [[ -f "$dy" ]] || continue
        local d_dir
        d_dir=$(dirname "$dy")
        [[ -d "$d_dir/dispatcher" ]] || continue
        basename "$d_dir"
    done | sort
}

scan_process_rows() {
    local system_root="$1"

    ps -axo pid=,ppid=,command= | awk -v system_root="$system_root" '
        {
            pid = $1
            ppid = $2
            $1 = ""
            $2 = ""
            sub(/^[[:space:]]+/, "", $0)

            if (!match($0, /\/\.claude\/delamains\/[^[:space:]]+\/dispatcher\/src\/index\.ts/)) {
                next
            }

            path = substr($0, RSTART, RLENGTH)
            root_prefix = system_root "/.claude/delamains/"
            if (index(path, root_prefix) != 1) {
                next
            }

            name = substr(path, length(root_prefix) + 1)
            sub(/\/dispatcher\/src\/index\.ts$/, "", name)

            kind = ($0 ~ /(^|[[:space:]])bun([[:space:]]|$)/) ? "runtime" : "wrapper"
            printf "%s\t%s\t%s\t%s\t%s\n", kind, pid, ppid, name, $0
        }
    ' | sort -u
}

runtime_parent_wrapper_pids() {
    local rows="$1"

    printf '%s\n' "$rows" | awk -F '\t' '$1 == "runtime" { print $3 }' | awk 'NF' | sort -u | while IFS= read -r parent_pid; do
        [[ -n "$parent_pid" ]] || continue
        local parent_cmd
        parent_cmd=$(ps -p "$parent_pid" -o command= 2>/dev/null || true)
        [[ -n "$parent_cmd" ]] || continue
        if printf '%s\n' "$parent_cmd" | grep -Fq "dispatcher/src/index.ts" && \
           printf '%s\n' "$parent_cmd" | grep -Eq '(^|/)(zsh|bash|sh)([[:space:]]|$).* -c '; then
            printf '%s\n' "$parent_pid"
        fi
    done | sort -u
}

scan_runtime_pids() {
    local rows="$1"
    printf '%s\n' "$rows" | awk -F '\t' '$1 == "runtime" { print $2 }' | awk 'NF' | sort -u
}

scan_wrapper_pids() {
    local rows="$1"

    {
        printf '%s\n' "$rows" | awk -F '\t' '$1 == "wrapper" { print $2 }'
        runtime_parent_wrapper_pids "$rows"
    } | awk 'NF' | sort -u
}

count_runtime_pids_for_name() {
    local rows="$1"
    local target_name="$2"

    printf '%s\n' "$rows" | awk -F '\t' -v target_name="$target_name" '
        $1 == "runtime" && $4 == target_name { count += 1 }
        END { print count + 0 }
    '
}

removed_status_file_count() {
    local system_root="$1"
    local removed=0

    for sf in "$system_root"/.claude/delamains/*/status.json; do
        [[ -f "$sf" ]] || continue
        rm -f "$sf"
        removed=$((removed + 1))
    done

    printf '%s\n' "$removed"
}

alive_pid_list() {
    local pid_list="$1"

    printf '%s\n' "$pid_list" | awk 'NF' | while IFS= read -r pid; do
        [[ -n "$pid" ]] || continue
        if kill -0 "$pid" 2>/dev/null; then
            printf '%s\n' "$pid"
        fi
    done | sort -u
}

log_line() {
    if [[ "${QUIET}" == "1" ]]; then
        return 0
    fi
    printf '[delamain-cleanup][%s] %s\n' "$CALLER" "$1"
}

scan_command() {
    local system_root="${SYSTEM_ROOT:-}"
    if [[ -z "$system_root" ]]; then
        system_root=$(walk_system_root "${START_CWD}" 2>/dev/null || true)
    fi

    if [[ -z "$system_root" ]]; then
        echo "NO_SYSTEM"
        return 0
    fi

    echo "SYSTEM_ROOT: $system_root"

    if [[ ! -d "$system_root/.claude/delamains" ]]; then
        echo "NO_DELAMAINS"
        return 0
    fi

    local names
    names=$(all_delamain_names "$system_root")
    if [[ -z "$names" ]]; then
        echo "NO_DELAMAINS"
        return 0
    fi

    echo "ALL_DELAMAINS: $(printf '%s\n' "$names" | join_lines)"

    local rows
    rows=$(scan_process_rows "$system_root")

    local runtime_pids
    runtime_pids=$(scan_runtime_pids "$rows")
    if [[ -n "$runtime_pids" ]]; then
        echo "RUNNING_PIDS: $(printf '%s\n' "$runtime_pids" | join_lines)"
    fi

    local wrapper_pids
    wrapper_pids=$(scan_wrapper_pids "$rows")
    if [[ -n "$wrapper_pids" ]]; then
        echo "WRAPPER_PIDS: $(printf '%s\n' "$wrapper_pids" | join_lines)"
    fi

    while IFS= read -r name; do
        [[ -n "$name" ]] || continue
        echo "PROCESS_COUNT: $name $(count_runtime_pids_for_name "$rows" "$name")"
    done <<< "$names"
}

cleanup_command() {
    local system_root="${SYSTEM_ROOT:-}"
    [[ -n "$system_root" ]] || {
        echo "cleanup requires --system-root" >&2
        return 1
    }
    [[ -f "$system_root/.als/system.ts" ]] || {
        echo "cleanup requires an ALS system root" >&2
        return 1
    }

    local rows
    rows=$(scan_process_rows "$system_root")

    local runtime_pids
    runtime_pids=$(scan_runtime_pids "$rows")
    local wrapper_pids
    wrapper_pids=$(scan_wrapper_pids "$rows")

    local target_pids
    target_pids=$({
        printf '%s\n' "$runtime_pids"
        printf '%s\n' "$wrapper_pids"
    } | awk 'NF' | sort -u)

    if [[ -n "$runtime_pids" ]]; then
        log_line "runtime pids: $(printf '%s\n' "$runtime_pids" | join_lines)"
    else
        log_line "runtime pids: none"
    fi

    if [[ -n "$wrapper_pids" ]]; then
        log_line "wrapper pids: $(printf '%s\n' "$wrapper_pids" | join_lines)"
    else
        log_line "wrapper pids: none"
    fi

    if [[ -n "$target_pids" ]]; then
        kill -9 $(printf '%s\n' "$target_pids" | join_lines) 2>/dev/null || true
    fi

    local removed
    removed=$(removed_status_file_count "$system_root")
    log_line "removed heartbeat files: $removed"

    if [[ -z "$target_pids" ]]; then
        log_line "no live dispatcher processes found"
        return 0
    fi

    sleep 0.5

    local survivors
    survivors=$(alive_pid_list "$target_pids")
    if [[ -n "$survivors" ]]; then
        echo "DELAMAIN CLEANUP ABORT: PIDs still alive after SIGKILL: $(printf '%s\n' "$survivors" | join_lines)" >&2
        return 1
    fi

    log_line "verified process exit for: $(printf '%s\n' "$target_pids" | join_lines)"
}

resolve_system_root_command() {
    walk_system_root "${START_CWD}"
}

SUBCOMMAND="${1:-}"
[[ -n "$SUBCOMMAND" ]] || usage
shift

START_CWD="$(pwd)"
SYSTEM_ROOT=""
CALLER="cleanup"
QUIET="0"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --cwd)
            START_CWD="$2"
            shift 2
            ;;
        --system-root)
            SYSTEM_ROOT="$2"
            shift 2
            ;;
        --caller)
            CALLER="$2"
            shift 2
            ;;
        --quiet)
            QUIET="1"
            shift
            ;;
        *)
            usage
            ;;
    esac
done

case "$SUBCOMMAND" in
    scan)
        scan_command
        ;;
    cleanup)
        cleanup_command
        ;;
    resolve-system-root)
        resolve_system_root_command
        ;;
    *)
        usage
        ;;
esac
