#!/usr/bin/env bash
# Provision hive.boxd.sh golden VM and enable deploy-on-push.
#
# Prerequisites:
#   - boxd CLI authenticated: boxd auth login  (or BOXD_TOKEN=…)
#   - gh CLI for webhook registration
#
# Usage:
#   bash scripts/setup-boxd.sh
#   bash scripts/setup-boxd.sh --reuse          # skip `boxd new` if hive exists
#   REPO_URL=https://github.com/codegod100/hive bash scripts/setup-boxd.sh
set -euo pipefail

export PATH="${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

VM_NAME="${BOXD_VM_NAME:-hive}"
REPO_URL="${REPO_URL:-https://github.com/codegod100/hive.git}"
REPO_DIR="${REPO_DIR:-/home/boxd/hive}"
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

if ! boxd --json auth 2>/dev/null | grep -q '"authenticated":true'; then
  if [ -z "${BOXD_TOKEN:-}" ]; then
    echo "Not authenticated. Run: boxd auth login" >&2
    echo "Or set BOXD_TOKEN to a valid API key." >&2
    exit 1
  fi
fi

echo "[setup] VM=$VM_NAME repo=$REPO_URL"

EXISTING=$(boxd --json machine list 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
for m in data:
    if m.get('name') == '$VM_NAME':
        print(m.get('id',''))
        break
" 2>/dev/null || true)

if [ -n "$EXISTING" ] && [ "$REUSE" -eq 1 ]; then
  echo "[setup] reusing existing machine $VM_NAME ($EXISTING)"
else
  if [ -n "$EXISTING" ]; then
    echo "[setup] removing stale $VM_NAME ..."
    boxd machine remove "$VM_NAME" -y
  fi
  echo "[setup] creating $VM_NAME ..."
  boxd --json new --name "$VM_NAME"
  boxd machine wait-until-ready "$VM_NAME" 2>/dev/null || sleep 5
fi

echo "[setup] setting proxy port $APP_PORT ..."
boxd machine proxy set-port --vm "$VM_NAME" --port "$APP_PORT" 2>/dev/null \
  || boxd machine proxy set-port "$VM_NAME" "$APP_PORT" 2>/dev/null \
  || true

# Push API keys from local env / OpenBao if available
if [ -n "${CURSOR_API_KEY:-}" ]; then
  boxd env set CURSOR_API_KEY "$CURSOR_API_KEY" --secret 2>/dev/null || true
fi
if [ -n "${PRIME_API_KEY:-}" ]; then
  boxd env set PRIME_API_KEY "$PRIME_API_KEY" --secret 2>/dev/null || true
fi

GH_TOKEN_FOR_CLONE="${GH_TOKEN:-$(gh auth token 2>/dev/null || true)}"
CLONE_AUTH=""
if [ -n "$GH_TOKEN_FOR_CLONE" ]; then
  CLONE_AUTH="Authorization: Bearer ${GH_TOKEN_FOR_CLONE}"
fi

echo "[setup] installing on VM ..."
boxd machine exec "$VM_NAME" -- bash -lc "
set -euo pipefail
export PATH=\"\$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:\$PATH\"

# uv
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH=\"\$HOME/.local/bin:\$PATH\"
fi

mkdir -p \"\$(dirname '$REPO_DIR')\"
if [ -d '$REPO_DIR/.git' ]; then
  cd '$REPO_DIR' && git fetch origin && git checkout '$BRANCH' && git pull --ff-only origin '$BRANCH'
else
  if [ -n '$CLONE_AUTH' ]; then
    git -c http.extraHeader='$CLONE_AUTH' clone --branch '$BRANCH' '$REPO_URL' '$REPO_DIR'
  else
    git clone --branch '$BRANCH' '$REPO_URL' '$REPO_DIR'
  fi
fi

cd '$REPO_DIR'
uv sync

# Persist gh auth for deploy webhooks
if [ -n '${GH_TOKEN_FOR_CLONE}' ]; then
  unset GH_TOKEN GITHUB_TOKEN
  printf '%s\n' '${GH_TOKEN_FOR_CLONE}' | gh auth login --with-token 2>/dev/null || true
fi

bash scripts/install-systemd.sh
loginctl enable-linger \"\$USER\" 2>/dev/null || true
bash scripts/deploy-boxd.sh
"

echo "[setup] enabling deploy-on-push ..."
boxd machine exec "$VM_NAME" -- bash -lc "
if [ -x /opt/boxd-platform/enable-deploy.sh ]; then
  REPO_DIR='$REPO_DIR' DEFAULT_BRANCH='$BRANCH' APP_PORT='$APP_PORT' \
    UP_CMD='bash scripts/start.sh' \
    RELOAD_CMD='systemctl --user restart hive.service' \
    REBUILD_CMD='uv sync && systemctl --user restart hive.target' \
    REBUILD_PATHS='pyproject.toml uv.lock src/**' \
    bash /opt/boxd-platform/enable-deploy.sh
else
  echo 'boxd-platform not present — skip webhook (run boxd-setup-deploy manually)'
fi
" || true

echo ""
echo "Hive is live at https://${VM_NAME}.boxd.sh"
echo "Deploy log: boxd machine exec $VM_NAME -- sudo tail -f /var/log/golden-deploy.log"
