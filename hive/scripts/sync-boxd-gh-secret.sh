#!/usr/bin/env bash
# Sync BOXD_API_KEY from OpenBao → GitHub Actions secret BOXD_TOKEN.
# Requires: OPENBAO_TOKEN, GH_TOKEN (or gh auth) with repo secret write access.
set -euo pipefail

REPO="${1:-codegod100/cursor}"
OPENBAO_ADDR="${OPENBAO_ADDR:-https://openbao.boxd.sh}"

if [ -z "${OPENBAO_TOKEN:-}" ]; then
  echo "OPENBAO_TOKEN required" >&2
  exit 1
fi

BOXD_KEY=$(curl -fsS -H "X-Vault-Token: $OPENBAO_TOKEN" \
  "$OPENBAO_ADDR/v1/secret/data/ai-api-keys" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['data']['BOXD_API_KEY'])")

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  printf '%s' "$BOXD_KEY" | gh secret set BOXD_TOKEN --repo "$REPO"
  echo "Set BOXD_TOKEN on $REPO via gh CLI"
  exit 0
fi

GH_TOKEN=$(curl -fsS -H "X-Vault-Token: $OPENBAO_TOKEN" \
  "$OPENBAO_ADDR/v1/secret/data/ai-api-keys" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['data'].get('GH_TOKEN',''))")

python3 - "$REPO" "$GH_TOKEN" "$BOXD_KEY" <<'PY'
import base64, json, os, sys
from urllib.request import Request, urlopen
from nacl import encoding, public

repo, gh_token, boxd_key = sys.argv[1:4]
owner, name = repo.split("/", 1)

pk_req = Request(
    f"https://api.github.com/repos/{owner}/{name}/actions/secrets/public-key",
    headers={"Authorization": f"token {gh_token}", "Accept": "application/vnd.github+json"},
)
with urlopen(pk_req) as resp:
    pk = json.load(resp)

sealed = public.SealedBox(
    public.PublicKey(pk["key"].encode(), encoding.Base64Encoder())
).encrypt(boxd_key.encode())
body = json.dumps({"encrypted_value": base64.b64encode(sealed).decode(), "key_id": pk["key_id"]}).encode()

put = Request(
    f"https://api.github.com/repos/{owner}/{name}/actions/secrets/BOXD_TOKEN",
    data=body, method="PUT",
    headers={"Authorization": f"token {gh_token}", "Accept": "application/vnd.github+json", "Content-Type": "application/json"},
)
with urlopen(put) as resp:
    print(f"Set BOXD_TOKEN on {repo} — HTTP {resp.status}")
PY
