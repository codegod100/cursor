#!/usr/bin/env bash
# Print radicle-garden MCP secret values from OpenBao for pasting into
# Cursor Cloud Agent environment secrets (Dashboard → Environments → Secrets).
#
# Usage: OPENBAO_TOKEN=... ./scripts/print-radicle-mcp-secrets.sh
# WARNING: outputs secrets to stdout — run locally, do not log or commit.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../.cursor/skills/incubation-graduate/scripts/lib.sh
source "$SCRIPT_DIR/../.cursor/skills/incubation-graduate/scripts/lib.sh"

RAD_ID="98ef04b8-4a1d-4d60-9044-6b1139aae748"
ADDR="${OPENBAO_ADDR:-https://openbao.boxd.sh}"

[ -n "${OPENBAO_TOKEN:-}" ] || die "OPENBAO_TOKEN required"

BUILDKITE_API_TOKEN="$(openbao_key BUILDKITE_API_KEY)"
RADICLE_GARDEN_EMAIL="$(curl -fsS -H "X-Vault-Token: $OPENBAO_TOKEN" \
  "$ADDR/v1/secret/data/passwords/$RAD_ID" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['data'].get('username',''))")"
RADICLE_GARDEN_PASSWORD="$(curl -fsS -H "X-Vault-Token: $OPENBAO_TOKEN" \
  "$ADDR/v1/secret/data/passwords/$RAD_ID" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['data'].get('password',''))")"

cat <<EOF
Paste into Cursor → Cloud Agents → codegod100/cursor → Secrets (Runtime Secret):

BUILDKITE_API_TOKEN=$BUILDKITE_API_TOKEN
RADICLE_GARDEN_EMAIL=$RADICLE_GARDEN_EMAIL
RADICLE_GARDEN_PASSWORD=$RADICLE_GARDEN_PASSWORD

Or skip separate secrets: OPENBAO_TOKEN is already injected and radicle-garden-mcp
auto-hydrates from OpenBao on startup when these are unset.
EOF
