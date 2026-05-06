#!/usr/bin/env bash
set -euo pipefail

SYSTEM_ROOT_INPUT="${1:-.}"
SYSTEM_ROOT="$(cd -- "${SYSTEM_ROOT_INPUT}" && pwd)"
GITIGNORE_PATH="${SYSTEM_ROOT}/.gitignore"
COMMIT_MESSAGE="chore: clean tracked runtime ephemera before ALS v2 upgrade"

if ! git -C "${SYSTEM_ROOT}" rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "cleanup-tracked-runtime-ephemera: '${SYSTEM_ROOT}' is not a git repository" >&2
  exit 1
fi

tracked_paths=()
while IFS= read -r -d '' path; do
  case "${path}" in
    .claude/delamains/*/runtime/*|.claude/delamains/*/status.json|.claude/scripts/.cache/pulse/*.json)
      tracked_paths+=("${path}")
      ;;
  esac
done < <(git -C "${SYSTEM_ROOT}" ls-files -z)

ignore_patterns=(
  ".claude/delamains/*/runtime/"
  ".claude/delamains/*/status.json"
  ".claude/scripts/.cache/pulse/*.json"
)

touch "${GITIGNORE_PATH}"

gitignore_changed=0
for pattern in "${ignore_patterns[@]}"; do
  if grep -Fxq "${pattern}" "${GITIGNORE_PATH}"; then
    continue
  fi

  printf '%s\n' "${pattern}" >> "${GITIGNORE_PATH}"
  gitignore_changed=1
done

if ((${#tracked_paths[@]} > 0)); then
  git -C "${SYSTEM_ROOT}" rm --cached -- "${tracked_paths[@]}"
fi

if ((${#tracked_paths[@]} == 0 && gitignore_changed == 0)); then
  exit 0
fi

if ((gitignore_changed == 1)); then
  git -C "${SYSTEM_ROOT}" add .gitignore
fi

if git -C "${SYSTEM_ROOT}" diff --cached --quiet; then
  exit 0
fi

git -C "${SYSTEM_ROOT}" commit --no-gpg-sign -m "${COMMIT_MESSAGE}" >/dev/null
