#!/usr/bin/env bash
# Sync secrets from OpenBao ai-api-keys → GitHub Actions repo secrets.
#
# Usage:
#   sync-gh-secrets.sh <owner/repo> SECRET_NAME [SECRET_NAME…]
#
# By default each GitHub secret name equals the OpenBao key name.
# Override mapping: SECRET_MAP='BOXD_TOKEN=BOXD_API_KEY,FOO=BAR'
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_cmd python3
pip install -q pynacl 2>/dev/null || true

REPO="${1:?usage: sync-gh-secrets.sh owner/repo NAME [NAME…]}"
shift

if [ "$#" -eq 0 ]; then
  die "at least one secret name required"
fi

load_gh_token
OWNER="${REPO%%/*}"
NAME="${REPO#*/}"

python3 - "$REPO" "$GH_TOKEN" "$@" <<'PY'
import json, os, sys, base64
from urllib.request import Request, urlopen

try:
    from nacl import encoding, public
except ImportError:
    raise SystemExit("pynacl required: pip install pynacl")

repo, gh_token, *secret_names = sys.argv[1:]
owner, name = repo.split("/", 1)

# OpenBao fetch
addr = os.environ.get("OPENBAO_ADDR", "https://openbao.boxd.sh")
token = os.environ.get("OPENBAO_TOKEN", "")
if not token:
    raise SystemExit("OPENBAO_TOKEN required")
with urlopen(Request(f"{addr}/v1/secret/data/ai-api-keys",
    headers={"X-Vault-Token": token})) as r:
    oa = json.load(r)["data"]["data"]

# Parse SECRET_MAP: GH_NAME=OA_KEY,…
mapping = {}
for pair in os.environ.get("SECRET_MAP", "").split(","):
    pair = pair.strip()
    if not pair:
        continue
    gh_n, oa_k = pair.split("=", 1)
    mapping[gh_n.strip()] = oa_k.strip()

with urlopen(Request(f"https://api.github.com/repos/{owner}/{name}/actions/secrets/public-key",
    headers={"Authorization": f"token {gh_token}", "Accept": "application/vnd.github+json"})) as r:
    pk = json.load(r)

def encrypt(val: str) -> str:
    sealed = public.SealedBox(
        public.PublicKey(pk["key"].encode(), encoding.Base64Encoder())
    ).encrypt(val.encode())
    return base64.b64encode(sealed).decode()

for gh_name in secret_names:
    oa_key = mapping.get(gh_name, gh_name)
    val = oa.get(oa_key, "")
    if not val:
        print(f"skip {gh_name} (OpenBao key {oa_key} empty)")
        continue
    body = json.dumps({"encrypted_value": encrypt(val), "key_id": pk["key_id"]}).encode()
    req = Request(f"https://api.github.com/repos/{owner}/{name}/actions/secrets/{gh_name}",
        data=body, method="PUT",
        headers={"Authorization": f"token {gh_token}", "Accept": "application/vnd.github+json",
                 "Content-Type": "application/json"})
    with urlopen(req) as resp:
        print(f"Set {gh_name} on {repo} (from {oa_key}) — HTTP {resp.status}")
PY
