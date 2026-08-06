#!/usr/bin/env bash
# Publish hive/ as a standalone github.com/codegod100/hive repository.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

git clone --depth 1 "file://$ROOT" "$TMP" -b "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"
cd "$TMP/hive"
git filter-repo --subdirectory-filter hive 2>/dev/null || {
  # fallback without git-filter-repo
  cd "$TMP"
  mkdir standalone && mv hive/* hive/.[!.]* standalone/ 2>/dev/null || true
  rm -rf hive
  mv standalone hive
  cd hive
  git init -b main
  git add -A
  git commit -m "feat: distributed hive orchestrator webapp"
}

if ! gh repo view codegod100/hive &>/dev/null; then
  gh repo create codegod100/hive --public \
    --description "Distributed hive orchestrator: prime-agent queen + cursor-agent workers"
fi

git remote add origin https://github.com/codegod100/hive.git 2>/dev/null || \
  git remote set-url origin https://github.com/codegod100/hive.git
git push -u origin main
echo "Published to https://github.com/codegod100/hive"
