#!/usr/bin/env bash
set -euo pipefail

# Provision the Friends app on a boxd VM named "friends".
# Requires: boxd CLI authenticated (boxd auth login) or BOXD_TOKEN set.
#
# Usage:
#   ./scripts/provision-boxd.sh

VM_NAME="${BOXD_VM_NAME:-friends}"
APP_PORT="${FRIENDS_PORT:-8000}"
REPO_URL="${REPO_URL:-https://github.com/codegod100/friends.git}"
APP_DIR="/home/boxd/friends"
SERVICE_NAME="friends"
export PATH="${HOME}/.local/bin:${PATH}"

if ! command -v boxd >/dev/null 2>&1; then
  curl -fsSL https://boxd.sh/downloads/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

boxd machine get "$VM_NAME" --json >/dev/null 2>&1 || boxd machine new "$VM_NAME" --json

echo "==> Installing mise, Erlang, and Gleam on $VM_NAME"
boxd machine exec "$VM_NAME" -- bash -lc '
  set -euo pipefail
  if ! command -v mise >/dev/null 2>&1; then
    curl -fsSL https://mise.jdx.dev/install.sh | sh
  fi
  export PATH="$HOME/.local/bin:$PATH"
  eval "$(mise activate bash)"
  mise --version
'

echo "==> Cloning or updating repository"
boxd machine exec "$VM_NAME" -- bash -lc "
  set -euo pipefail
  export PATH=\"\$HOME/.local/bin:\$PATH\"
  eval \"\$(mise activate bash)\"
  if [[ -d $APP_DIR/.git ]]; then
    git -C $APP_DIR fetch origin
    git -C $APP_DIR reset --hard origin/main
  else
    git clone $REPO_URL $APP_DIR
  fi
  cd $APP_DIR
  mise trust
  mise install
  gleam deps download
  gleam build
"

echo "==> Writing production .env from OpenBao (or local .env)"
if [[ -f .env ]]; then
  boxd env push "$VM_NAME" --file .env --dest "$APP_DIR/.env"
else
  python3 - <<'PY' | boxd machine exec "$VM_NAME" -- bash -lc "cat > $APP_DIR/.env && chmod 600 $APP_DIR/.env"
import json, urllib.request, os
BAO = "https://openbao.boxd.sh"
tok = os.environ["OPENBAO_TOKEN"]
req = urllib.request.Request(
    BAO + "/v1/secret/data/friends/production",
    headers={"X-Vault-Token": tok},
)
with urllib.request.urlopen(req) as f:
    data = json.load(f)["data"]["data"]
for k in (
    "FRIENDS_OIDC_CLIENT_ID",
    "FRIENDS_OIDC_CLIENT_SECRET",
    "FRIENDS_OIDC_ISSUER",
    "FRIENDS_BASE_URL",
    "FRIENDS_OIDC_REDIRECT_URI",
    "FRIENDS_SECRET_KEY_BASE",
    "FRIENDS_PORT",
):
    print(f"{k}={data[k]}")
print("FRIENDS_DATA_PATH=data/handles.json")
PY
fi

echo "==> Installing systemd service"
boxd machine exec "$VM_NAME" -- bash -lc "
  set -euo pipefail
  sudo cp $APP_DIR/deploy/friends.service /etc/systemd/system/$SERVICE_NAME.service
  sudo systemctl daemon-reload
  sudo systemctl enable $SERVICE_NAME
  sudo systemctl restart $SERVICE_NAME
"

echo "==> Setting proxy port to $APP_PORT"
boxd machine proxy set-port --vm "$VM_NAME" --port "$APP_PORT"

echo "==> Verifying app responds"
boxd machine exec "$VM_NAME" -- bash -lc "
  for i in \$(seq 1 45); do
    if curl -sf http://127.0.0.1:$APP_PORT/ -o /dev/null; then
      echo HTTP OK on port $APP_PORT
      exit 0
    fi
    sleep 1
  done
  echo FAILED: app did not respond on port $APP_PORT
  sudo journalctl -u $SERVICE_NAME -n 80 --no-pager
  exit 1
"

echo
echo "Friends is live:"
echo "  https://${VM_NAME}.boxd.sh"
echo "  ssh ${VM_NAME}.boxd"
