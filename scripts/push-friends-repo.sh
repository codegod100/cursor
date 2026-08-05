#!/usr/bin/env bash
set -euo pipefail

# Push this tree to github.com/codegod100/friends once the empty repo exists.
#
# Create the repo first (GitHub UI or: gh repo create codegod100/friends --public)
# Then run: ./scripts/push-friends-repo.sh

REMOTE_NAME="friends"
REMOTE_URL="https://github.com/codegod100/friends.git"
BRANCH="${1:-main}"

if git remote | grep -qx "$REMOTE_NAME"; then
  git remote set-url "$REMOTE_NAME" "$REMOTE_URL"
else
  git remote add "$REMOTE_NAME" "$REMOTE_URL"
fi

git push -u "$REMOTE_NAME" "HEAD:$BRANCH"
