#!/usr/bin/env bash
# Open a Radicle patch from a Buildkite build checkout.
#
# Intended for .buildkite/pipeline.yml after CI steps pass. Uses BUILDKITE_COMMIT
# and patch.message push options (no $EDITOR).
#
# Environment:
#   RAD_REPO_RID          rad:… id — adds `rad` remote if missing (GitHub checkouts)
#   RAD_PATCH_TITLE       override patch title (default: commit subject)
#   RAD_PATCH_BODY        override patch body (default: commit body + build URL)
#   RAD_PATCH_DRAFT       set to 1 for draft patches
#   RAD_PATCH_SKIP_BRANCH prefix — skip when BUILDKITE_BRANCH starts with this (default: patch/)
#   RAD_OPEN_PATCH        set to 0 to skip (default: 1)
#   RAD_PATCH_BASE        optional patch.base commit
#   RAD_PATCH_ID          update existing patch instead of opening new
#
# Requires `rad` CLI and agent auth (RAD_HOME / rad auth) on the Buildkite agent.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PATCH_SCRIPT="$REPO_ROOT/.cursor/skills/rad-patch/scripts/create-patch.sh"
# shellcheck source=../.cursor/skills/rad-patch/scripts/lib.sh
source "$REPO_ROOT/.cursor/skills/rad-patch/scripts/lib.sh"

die() { echo "buildkite-rad-patch: $*" >&2; exit 1; }

if [[ "${RAD_OPEN_PATCH:-1}" != "1" ]]; then
  echo "RAD_OPEN_PATCH=0 — skipping patch open"
  exit 0
fi

require_cmd git
require_cmd rad
[[ -x "$PATCH_SCRIPT" ]] || die "missing $PATCH_SCRIPT"

REPO="${BUILDKITE_BUILD_CHECKOUT_PATH:-$REPO_ROOT}"
REPO="$(cd "$REPO" && pwd)"
COMMIT="${BUILDKITE_COMMIT:-HEAD}"
BRANCH="${BUILDKITE_BRANCH:-}"
SKIP_PREFIX="${RAD_PATCH_SKIP_BRANCH:-patch/}"

if [[ -n "$BRANCH" && "$BRANCH" == "$SKIP_PREFIX"* ]]; then
  echo "branch $BRANCH matches skip prefix $SKIP_PREFIX — patch build, not opening a new patch"
  exit 0
fi

if [[ -n "${RAD_REPO_RID:-}" ]] && ! git -C "$REPO" remote get-url rad >/dev/null 2>&1; then
  echo "adding rad remote for $RAD_REPO_RID"
  (
    cd "$REPO"
    rad remote add rad "$RAD_REPO_RID"
  )
fi

require_rad_repo "$REPO"

if ! git -C "$REPO" cat-file -e "${COMMIT}^{commit}" 2>/dev/null; then
  die "commit $COMMIT not found in $REPO"
fi

TITLE="${RAD_PATCH_TITLE:-}"
BODY="${RAD_PATCH_BODY:-}"

if [[ -z "$TITLE" ]]; then
  TITLE="$(git -C "$REPO" log -1 --format=%s "$COMMIT")"
fi

if [[ -z "$BODY" ]]; then
  commit_body="$(git -C "$REPO" log -1 --format=%b "$COMMIT" | sed '/^[[:space:]]*$/d')"
  BODY="$commit_body"
  if [[ -n "${BUILDKITE_BUILD_URL:-}" ]]; then
    if [[ -n "$BODY" ]]; then
      BODY="${BODY}

Buildkite: ${BUILDKITE_BUILD_URL}"
    else
      BODY="Buildkite: ${BUILDKITE_BUILD_URL}"
    fi
  fi
fi

args=(
  --repo "$REPO"
  --ref "$COMMIT"
  --title "$TITLE"
)

if [[ -n "$BODY" ]]; then
  args+=(--body "$BODY")
fi
if [[ "${RAD_PATCH_DRAFT:-0}" == "1" ]]; then
  args+=(--draft)
fi
if [[ -n "${RAD_PATCH_BASE:-}" ]]; then
  args+=(--base "$RAD_PATCH_BASE")
fi
if [[ -n "${RAD_PATCH_ID:-}" ]]; then
  args+=(--patch "$RAD_PATCH_ID")
fi

echo "Opening Radicle patch for commit $COMMIT in $REPO"
exec "$PATCH_SCRIPT" "${args[@]}"
