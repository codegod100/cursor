#!/usr/bin/env bash
# Deploy hive on the boxd VM (systemd user units).
#
#   bash scripts/deploy-boxd.sh
#   bash scripts/deploy-boxd.sh --skip-sync
set -euo pipefail

export PATH="${HOME}/.local/bin:/run/system-manager/sw/bin:/nix/var/nix/profiles/default/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

if [ -z "${XDG_RUNTIME_DIR:-}" ] && [ -d "/run/user/$(id -u)" ]; then
  export XDG_RUNTIME_DIR="/run/user/$(id -u)"
fi
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && [ -n "${XDG_RUNTIME_DIR:-}" ] \
  && [ -S "${XDG_RUNTIME_DIR}/bus" ]; then
  export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SKIP_SYNC=0
for arg in "$@"; do
  case "$arg" in
    --skip-sync) SKIP_SYNC=1 ;;
  esac
done

echo "[deploy] root=${ROOT} sha=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

if [ "$SKIP_SYNC" -eq 0 ]; then
  echo "[deploy] uv sync ..."
  uv sync
else
  echo "[deploy] skipping uv sync"
fi

if systemctl --user cat hive.target >/dev/null 2>&1; then
  echo "[deploy] refreshing systemd units ..."
  bash "$ROOT/scripts/install-systemd.sh" --no-enable
fi

echo "[deploy] prep ..."
bash "$ROOT/scripts/prep.sh"

echo "[deploy] restarting ..."
bash "$ROOT/scripts/start.sh"

echo "[deploy] done — https://hive.boxd.sh"
