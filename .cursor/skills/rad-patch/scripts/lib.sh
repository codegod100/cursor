#!/usr/bin/env bash
# Shared helpers for rad-patch scripts.
set -euo pipefail

die() { echo "rad-patch: $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 not found on PATH (install Radicle: https://radicle.xyz)"
}

require_rad_repo() {
  local repo=$1
  [[ -d "$repo" ]] || die "repo path not found: $repo"
  git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || die "not a git repo: $repo"
  if ! git -C "$repo" remote get-url rad >/dev/null 2>&1; then
    die "remote 'rad' missing in $repo — run rad clone or rad remote add rad <rid>"
  fi
}

# Extract patch id from git push / rad output (40-char hex or shortened prefix).
extract_patch_id() {
  local text=$1
  if [[ "$text" =~ Patch[[:space:]]+([0-9a-f]{7,40}) ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi
  if [[ "$text" =~ patches/([0-9a-f]{7,40}) ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

extract_patch_url() {
  local text=$1
  if [[ "$text" =~ (https://app\.radicle\.xyz[^[:space:]]+) ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}
