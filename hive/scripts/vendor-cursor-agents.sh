#!/usr/bin/env bash
# Vendor cursor-agents for local development (fork: codegod100/cursor-agents).
# Falls back to upstream cocolwy/cursor-agents if the fork is unavailable.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/vendor/cursor-agents"

if [[ -d "$VENDOR/.git" ]]; then
  echo "cursor-agents already vendored at vendor/cursor-agents"
  exit 0
fi

mkdir -p "$ROOT/vendor"
if git ls-remote --heads https://github.com/codegod100/cursor-agents.git main &>/dev/null; then
  REPO="https://github.com/codegod100/cursor-agents.git"
  echo "Cloning codegod100/cursor-agents fork…"
else
  REPO="https://github.com/cocolwy/cursor-agents.git"
  echo "Fork not found — cloning upstream $REPO"
  echo "  To fork: gh repo fork cocolwy/cursor-agents --org codegod100"
fi

git clone --depth 1 "$REPO" "$VENDOR"
cd "$VENDOR" && npm ci && npm run build
echo "cursor-agents ready at vendor/cursor-agents"
