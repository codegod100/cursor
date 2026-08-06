#!/usr/bin/env bash
# Graduate an incubated subdirectory to its own GitHub repository.
#
# Usage:
#   graduate-project.sh --project hive --org codegod100 [--description "…"] \
#     [--secrets BOXD_TOKEN,CURSOR_API_KEY] [--dry-run]
#
# Run from the monorepo root. Requires GH_TOKEN (or OPENBAO_TOKEN + GH_TOKEN in OpenBao).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

PROJECT=""
ORG="codegod100"
DESCRIPTION=""
SECRETS=""
DRY_RUN=0
MONOREPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT=$2; shift 2 ;;
    --org) ORG=$2; shift 2 ;;
    --description) DESCRIPTION=$2; shift 2 ;;
    --secrets) SECRETS=$2; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) die "unknown arg: $1" ;;
  esac
done

[ -n "$PROJECT" ] || die "--project required"
REPO="$ORG/$PROJECT"
SRC="$MONOREPO_ROOT/$PROJECT"
[ -d "$SRC" ] || die "project directory not found: $SRC"

echo "=== Graduate $SRC → https://github.com/$REPO ==="

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] would create repo, export, push, sync secrets: $SECRETS"
  echo "[dry-run] would remove $PROJECT/ from monorepo (manual step)"
  exit 0
fi

load_gh_token
bash "$SCRIPT_DIR/create-gh-repo.sh" "$REPO" "$DESCRIPTION"

EXPORT=$(mktemp -d)
trap 'rm -rf "$EXPORT"' EXIT
tar -C "$SRC" -cf - --exclude=.venv --exclude=.git . | tar -C "$EXPORT" -xf -

cd "$EXPORT"
git init -b main
git config user.email "${GIT_AUTHOR_EMAIL:-$(git -C "$MONOREPO_ROOT" config user.email 2>/dev/null || echo noreply@example.com)}"
git config user.name "${GIT_AUTHOR_NAME:-$(git -C "$MONOREPO_ROOT" config user.name 2>/dev/null || echo incubator)}"
git config commit.gpgsign false
git add -A
git commit -m "feat: graduate $PROJECT from incubator to standalone repo"

git remote add origin "https://x-access-token:${GH_TOKEN}@github.com/$REPO.git"
git push -u origin main

if [ -n "$SECRETS" ]; then
  IFS=',' read -ra NAMES <<< "$SECRETS"
  bash "$SCRIPT_DIR/sync-gh-secrets.sh" "$REPO" "${NAMES[@]}"
fi

echo ""
echo "Graduated: https://github.com/$REPO"
echo "Next: git rm -rf $PROJECT/ on an incubator branch and close the old PR."
