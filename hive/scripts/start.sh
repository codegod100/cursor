#!/usr/bin/env bash
# Start hive via systemd user units when installed; else foreground uvicorn.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

if [ -z "${XDG_RUNTIME_DIR:-}" ] && [ -d "/run/user/$(id -u)" ]; then
  export XDG_RUNTIME_DIR="/run/user/$(id -u)"
fi

if systemctl --user cat hive.target >/dev/null 2>&1; then
  echo "[start] systemd: restarting hive.target"
  systemctl --user restart hive.target
  systemctl --user --no-pager status hive.service || true
  exit 0
fi

echo "[start] no systemd units — foreground mode"
bash "$ROOT/scripts/prep.sh"
exec uv run hive --host 0.0.0.0 --port "${HIVE_PORT:-8000}"
