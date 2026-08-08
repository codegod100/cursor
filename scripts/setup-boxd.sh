#!/usr/bin/env bash
# Provision mcp.boxd.sh golden VM (shared MCP host) and enable deploy-on-push.
#
# Prerequisites:
#   - boxd CLI authenticated: boxd auth login  (or BOXD_TOKEN=…)
#   - gh CLI for webhook registration
#
# Usage:
#   bash scripts/setup-boxd.sh
#   bash scripts/setup-boxd.sh --reuse
#   REPO_URL=https://github.com/codegod100/cursor bash scripts/setup-boxd.sh
set -euo pipefail

export PATH="${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

VM_NAME="${BOXD_VM_NAME:-mcp}"
REPO_URL="${REPO_URL:-https://github.com/codegod100/cursor.git}"
REPO_DIR="${REPO_DIR:-/home/boxd/cursor}"
BRANCH="${DEFAULT_BRANCH:-main}"
APP_PORT="${APP_PORT:-8000}"
REUSE=0

for arg in "$@"; do
  case "$arg" in
    --reuse) REUSE=1 ;;
    -h | --help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
  esac
done

if ! command -v boxd >/dev/null 2>&1; then
  echo "install boxd: curl -fsSL https://boxd.sh/downloads/install.sh | sh" >&2
  exit 1
fi

if [ -z "${BOXD_TOKEN:-}" ]; then
  if ! boxd --json auth 2>/dev/null | grep -q '"user_id"'; then
    echo "Not authenticated. Run: boxd auth login" >&2
    echo "Or set BOXD_TOKEN to a valid API key." >&2
    exit 1
  fi
fi

echo "[setup] VM=$VM_NAME repo=$REPO_URL port=$APP_PORT"

EXISTING=$(boxd --json machine list 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
for m in data:
    if m.get('name') == '$VM_NAME':
        print(m.get('name', ''))
        break
" 2>/dev/null || true)

wait_for_machine() {
  local name=$1
  for _ in $(seq 1 60); do
    local status
    status=$(boxd --json machine get "$name" 2>/dev/null \
      | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null \
      || true)
    if [ "$status" = "running" ]; then
      return 0
    fi
    sleep 5
  done
  echo "[setup] timed out waiting for $name to be running" >&2
  return 1
}

if [ -n "$EXISTING" ] && [ "$REUSE" -eq 1 ]; then
  echo "[setup] reusing existing machine $VM_NAME"
else
  if [ -n "$EXISTING" ]; then
    echo "[setup] removing stale $VM_NAME ..."
    boxd machine remove "$VM_NAME" -y
  fi
  echo "[setup] creating $VM_NAME ..."
  boxd --json new "$VM_NAME"
  wait_for_machine "$VM_NAME"
fi

echo "[setup] setting proxy port $APP_PORT ..."
boxd machine proxy set-port --vm "$VM_NAME" --port "$APP_PORT"

if [ -n "${RAD_PASSPHRASE:-}" ]; then
  boxd env set RAD_PASSPHRASE "$RAD_PASSPHRASE" --secret 2>/dev/null || true
fi

GH_TOKEN_FOR_CLONE="${GH_TOKEN:-$(gh auth token 2>/dev/null || true)}"
CLONE_URL="$REPO_URL"
if [ -n "$GH_TOKEN_FOR_CLONE" ]; then
  CLONE_URL="https://x-access-token:${GH_TOKEN_FOR_CLONE}@github.com/codegod100/cursor.git"
fi

echo "[setup] installing on VM ..."
boxd machine exec "$VM_NAME" bash -lc "
set -euo pipefail
export PATH=\"\$HOME/.radicle/bin:\$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:\$PATH\"

# Node 20+ (fnm or system node)
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell
  export PATH=\"\$HOME/.local/share/fnm:\$PATH\"
  eval \"\$(fnm env)\"
  fnm install 22
  fnm use 22
fi

mkdir -p \"\$(dirname '$REPO_DIR')\"
if [ -d '$REPO_DIR/.git' ]; then
  cd '$REPO_DIR' && git fetch origin && git checkout '$BRANCH' && git pull --ff-only origin '$BRANCH'
else
  git clone --branch '$BRANCH' '$CLONE_URL' '$REPO_DIR'
fi

cd '$REPO_DIR'
bash scripts/prep.sh

if [ -n '${GH_TOKEN_FOR_CLONE}' ]; then
  unset GH_TOKEN GITHUB_TOKEN
  printf '%s\n' '${GH_TOKEN_FOR_CLONE}' | gh auth login --with-token 2>/dev/null || true
fi

bash scripts/install-systemd.sh
loginctl enable-linger \"\$USER\" 2>/dev/null || true
bash scripts/deploy-boxd.sh
"

echo "[setup] enabling deploy-on-push ..."
boxd machine exec "$VM_NAME" bash -lc "
if [ -x /opt/boxd-platform/enable-deploy.sh ]; then
  REPO_DIR='$REPO_DIR' DEFAULT_BRANCH='$BRANCH' APP_PORT='$APP_PORT' \
    UP_CMD='bash scripts/start.sh' \
    RELOAD_CMD='systemctl --user restart radicle.service' \
    REBUILD_CMD='bash scripts/prep.sh && systemctl --user restart radicle.target' \
    REBUILD_PATHS='mcp/host/package.json mcp/host/package-lock.json mcp/host/src/** mcp/radicle/package.json mcp/radicle/package-lock.json mcp/radicle/src/**' \
    bash /opt/boxd-platform/enable-deploy.sh
else
  echo 'boxd-platform not present — skip webhook (run boxd-setup-deploy manually)'
fi
" || true

echo ""
echo "MCP host is live at https://${VM_NAME}.boxd.sh"
echo "  radicle MCP: https://${VM_NAME}.boxd.sh/radicle/mcp"
echo "  health:      https://${VM_NAME}.boxd.sh/radicle/health"
echo "Deploy log:   boxd machine exec $VM_NAME -- sudo tail -f /var/log/golden-deploy.log"
