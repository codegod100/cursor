#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
dest="${HOME}/.cursor/skills"
mkdir -p "$dest"
shopt -s nullglob
for skill in "$root"/.cursor/skills/*/; do
  name="$(basename "$skill")"
  target="$dest/$name"
  if [[ -e "$target" || -L "$target" ]]; then
    rm -rf "$target"
  fi
  ln -s "$skill" "$target"
  echo "linked $target -> $skill"
done
