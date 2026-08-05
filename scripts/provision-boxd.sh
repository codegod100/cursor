#!/usr/bin/env bash
set -euo pipefail

# Provision the Friends app on a boxd VM named "friends".
# Requires: boxd CLI authenticated (boxd auth login) or BOXD_TOKEN set.
#
# Usage:
#   ./scripts/provision-boxd.sh
#   REPO_URL=https://github.com/codegod100/friends.git ./scripts/provision-boxd.sh

VM_NAME="${BOXD_VM_NAME:-friends}"
APP_PORT="${FRIENDS_PORT:-8000}"
REPO_URL="${REPO_URL:-https://github.com/codegod100/friends.git}"
APP_DIR="/home/boxd/friends"
SERVICE_NAME="friends"

if ! command -v boxd >/dev/null 2>&1; then
  curl -fsSL https://boxd.sh/downloads/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

boxd machine get "$VM_NAME" --json >/dev/null 2>&1 || boxd machine new "$VM_NAME" --json

echo "==> Installing Erlang and Gleam on $VM_NAME"
boxd machine exec "$VM_NAME" -- bash -lc '
  set -euo pipefail
  if ! command -v mise >/dev/null 2>&1; then
    curl -fsSL https://mise.jdx.dev/install.sh | sh
  fi
  export PATH="$HOME/.local/bin:$PATH"
  eval "$(mise activate bash)"
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
  mise install
  gleam deps download
  gleam build
"

if [[ -f .env ]]; then
  echo "==> Pushing local .env to VM"
  boxd env push "$VM_NAME" --file .env --dest "$APP_DIR/.env"
else
  echo "WARN: No local .env found. Copy .env.example to .env and set production secrets first."
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
  for i in \$(seq 1 30); do
    if curl -sf http://127.0.0.1:$APP_PORT/ -o /dev/null; then
      echo HTTP OK on port $APP_PORT
      exit 0
    fi
    sleep 1
  done
  echo FAILED: app did not respond on port $APP_PORT
  sudo journalctl -u $SERVICE_NAME -n 50 --no-pager
  exit 1
"

echo
echo "Friends is live:"
echo "  https://${VM_NAME}.boxd.sh"
echo "  ssh ${VM_NAME}.boxd"
