#!/usr/bin/env bash
# Start radicle MCP via systemd user units when installed; else foreground HTTP.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.radicle/bin:${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

if [ -z "${XDG_RUNTIME_DIR:-}" ] && [ -d "/run/user/$(id -u)" ]; then
  export XDG_RUNTIME_DIR="/run/user/$(id -u)"
fi

if systemctl --user cat radicle.target >/dev/null 2>&1; then
  echo "[start] systemd: restarting radicle.target"
  systemctl --user restart radicle.target
  systemctl --user --no-pager status radicle.service || true
  exit 0
fi

echo "[start] no systemd units — foreground HTTP mode"
bash "$ROOT/scripts/prep.sh"
cd "$ROOT/mcp/radicle"
exec npm run start:http
