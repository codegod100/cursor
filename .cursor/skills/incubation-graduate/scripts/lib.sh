#!/usr/bin/env bash
# Shared helpers for incubation-graduate scripts.
set -euo pipefail

die() { echo "incubation-graduate: $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 not found on PATH"
}

load_gh_token() {
  if [ -n "${GH_TOKEN:-}" ]; then
    return 0
  fi
  if [ -z "${OPENBAO_TOKEN:-}" ]; then
    die "GH_TOKEN or OPENBAO_TOKEN required"
  fi
  local addr="${OPENBAO_ADDR:-https://openbao.boxd.sh}"
  GH_TOKEN=$(curl -fsS -H "X-Vault-Token: $OPENBAO_TOKEN" \
    "$addr/v1/secret/data/ai-api-keys" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['data']['GH_TOKEN'])")
  export GH_TOKEN
}

openbao_key() {
  local key=$1
  local addr="${OPENBAO_ADDR:-https://openbao.boxd.sh}"
  [ -n "${OPENBAO_TOKEN:-}" ] || die "OPENBAO_TOKEN required to read $key"
  curl -fsS -H "X-Vault-Token: $OPENBAO_TOKEN" \
    "$addr/v1/secret/data/ai-api-keys" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['data'].get('$key',''))"
}

gh_api() {
  load_gh_token
  curl -fsS -H "Authorization: token $GH_TOKEN" -H "Accept: application/vnd.github+json" "$@"
}
