#!/usr/bin/env bash
# Open or update a Radicle patch from local commits.
#
# Usage:
#   create-patch.sh --repo /path/to/rad-repo \
#     --title "Fix option parsing" \
#     [--body "Details…"] [--branch fix/options] \
#     [--ref HEAD] [--draft] [--no-sync] [--force] \
#     [--patch PATCH_ID] [--base COMMIT] \
#     [--commit "message"] [--dry-run]
#
# With --commit, stages all changes and creates a commit before opening the patch.
# Without --commit, HEAD (or --ref) must already point at the commits to propose.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

REPO=""
TITLE=""
BODY=""
BRANCH=""
REF="HEAD"
PATCH_ID=""
BASE=""
DRAFT=0
SYNC=1
FORCE=0
COMMIT_MSG=""
DRY_RUN=0

usage() {
  sed -n '2,14p' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO=$2; shift 2 ;;
    --title) TITLE=$2; shift 2 ;;
    --body|--message) BODY=$2; shift 2 ;;
    --branch) BRANCH=$2; shift 2 ;;
    --ref) REF=$2; shift 2 ;;
    --patch) PATCH_ID=$2; shift 2 ;;
    --base) BASE=$2; shift 2 ;;
    --draft) DRAFT=1; shift ;;
    --sync) SYNC=1; shift ;;
    --no-sync) SYNC=0; shift ;;
    --force) FORCE=1; shift ;;
    --commit) COMMIT_MSG=$2; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

if [[ -z "$REPO" ]]; then
  REPO="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi
REPO="$(cd "$REPO" && pwd)"

require_cmd git
require_cmd rad
require_rad_repo "$REPO"

if [[ -z "$TITLE" && -z "$COMMIT_MSG" ]]; then
  die "--title required (or use --commit with a message that becomes the title)"
fi
if [[ -z "$TITLE" ]]; then
  TITLE="$COMMIT_MSG"
fi

cd "$REPO"

if [[ -n "$BRANCH" ]]; then
  if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git checkout "$BRANCH"
  else
    git checkout -b "$BRANCH"
  fi
fi

if [[ -n "$COMMIT_MSG" ]]; then
  if [[ -z "$(git status --porcelain)" ]]; then
    die "working tree clean — omit --commit or make changes first"
  fi
  git add -A
  git commit -m "$COMMIT_MSG"
  REF="HEAD"
fi

if [[ -n "$PATCH_ID" ]]; then
  rad patch set "$PATCH_ID" || die "could not set upstream for patch $PATCH_ID"
  PUSH_TARGET=""
  UPDATE_MODE=1
else
  PUSH_TARGET="refs/patches"
  UPDATE_MODE=0
fi

push_opts=()
if [[ "$SYNC" -eq 1 ]]; then
  push_opts+=(-o sync)
else
  push_opts+=(-o no-sync)
fi
if [[ "$DRAFT" -eq 1 ]]; then
  push_opts+=(-o patch.draft)
fi
if [[ -n "$BASE" ]]; then
  push_opts+=(-o "patch.base=$BASE")
fi
push_opts+=(-o "patch.message=$TITLE")
if [[ -n "$BODY" ]]; then
  push_opts+=(-o "patch.message=$BODY")
fi

git_args=(push)
if [[ "$FORCE" -eq 1 ]]; then
  git_args+=(--force)
fi
git_args+=("${push_opts[@]}" rad)

if [[ "$UPDATE_MODE" -eq 1 ]]; then
  git_args+=("$REF")
else
  git_args+=("$REF:$PUSH_TARGET")
fi

cmd=(git "${git_args[@]}")
printf 'repo: %s\n' "$REPO"
printf 'cmd:  %s\n' "$(printf '%q ' "${cmd[@]}")"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] would run push above"
  exit 0
fi

# Non-interactive: patch.message avoids $EDITOR for title/description.
export GIT_TERMINAL_PROMPT=0
out="$(mktemp)"
err="$(mktemp)"
rc=0
if ! "${cmd[@]}" >"$out" 2>"$err"; then
  rc=1
  cat "$out"
  cat "$err" >&2
  rm -f "$out" "$err"
  exit "$rc"
fi

combined="$(cat "$out"; cat "$err")"
cat "$out"
cat "$err" >&2

patch_id=""
if extract_patch_id "$combined" >/dev/null 2>&1; then
  patch_id="$(extract_patch_id "$combined")"
fi
patch_url=""
if extract_patch_url "$combined" >/dev/null 2>&1; then
  patch_url="$(extract_patch_url "$combined")"
fi

rm -f "$out" "$err"

echo ""
echo "=== Radicle patch ==="
if [[ -n "$patch_id" ]]; then
  echo "patch_id: $patch_id"
  rad patch show "$patch_id" 2>/dev/null | sed -n '1,20p' || true
fi
if [[ -n "$patch_url" ]]; then
  echo "url: $patch_url"
fi
if [[ -z "$patch_id" && -z "$patch_url" ]]; then
  echo "status: push completed (parse patch id from output above)"
fi
