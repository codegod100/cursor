#!/usr/bin/env bash
# Install radicle user systemd units (templates → ~/.config/systemd/user).
#
#   bash scripts/install-systemd.sh
#   bash scripts/install-systemd.sh --no-enable
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_SRC="$ROOT/systemd/user"
UNIT_DST="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
CONFIG_DIR="${RADICLE_CONFIG_DIR:-$HOME/.config/radicle}"

ENABLE=1
for arg in "$@"; do
  case "$arg" in
    --no-enable) ENABLE=0 ;;
    -h | --help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
  esac
done

NODE="$(command -v node || true)"
NPM="$(command -v npm || true)"
if [ -z "$NODE" ] || [ -z "$NPM" ]; then
  echo "install-systemd: node and npm must be on PATH" >&2
  exit 1
fi

mkdir -p "$UNIT_DST" "$CONFIG_DIR" "$HOME/logs"
chmod 700 "$CONFIG_DIR"

UNITS=(radicle-prep.service radicle.service radicle.target)

for f in "${UNITS[@]}"; do
  src="$UNIT_SRC/$f"
  dst="$UNIT_DST/$f"
  sed \
    -e "s|@ROOT@|${ROOT//\\/\\\\}|g" \
    -e "s|@NODE@|${NODE//\\/\\\\}|g" \
    -e "s|@NPM@|${NPM//\\/\\\\}|g" \
    -e "s|@HOME@|${HOME//\\/\\\\}|g" \
    "$src" >"$dst"
  echo "[install] wrote $dst"
done

chmod +x "$ROOT/scripts/"*.sh 2>/dev/null || true

systemctl --user daemon-reload

if [ "$ENABLE" -eq 1 ]; then
  systemctl --user enable radicle.target
  echo "[install] enabled radicle.target"
fi

echo "[install] start: systemctl --user start radicle.target"
