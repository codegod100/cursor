#!/usr/bin/env bash
# Create a GitHub repository (idempotent).
# Usage: create-gh-repo.sh <owner/repo> [description]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

REPO="${1:?usage: create-gh-repo.sh owner/name [description]}"
DESC="${2:-}"
OWNER="${REPO%%/*}"
NAME="${REPO#*/}"

load_gh_token

if gh_api "https://api.github.com/repos/$REPO" >/dev/null 2>&1; then
  echo "Repository $REPO already exists"
  exit 0
fi

BODY=$(python3 -c "import json; print(json.dumps({'name':'$NAME','description':'$DESC','private':False,'auto_init':False}))")
CODE=$(curl -sS -o /tmp/create-repo.json -w '%{http_code}' -X POST \
  -H "Authorization: token $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/user/repos" \
  -d "$BODY")

if [ "$CODE" = "201" ]; then
  python3 -c "import json; print(json.load(open('/tmp/create-repo.json'))['html_url'])"
  exit 0
fi

# Org-owned repo fallback
CODE=$(curl -sS -o /tmp/create-repo.json -w '%{http_code}' -X POST \
  -H "Authorization: token $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/orgs/$OWNER/repos" \
  -d "$BODY")

if [ "$CODE" = "201" ]; then
  python3 -c "import json; print(json.load(open('/tmp/create-repo.json'))['html_url'])"
else
  cat /tmp/create-repo.json >&2
  die "failed to create $REPO (HTTP $CODE)"
fi
