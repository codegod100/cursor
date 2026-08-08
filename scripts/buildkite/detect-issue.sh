#!/usr/bin/env bash
# Detect whether BUILDKITE_COMMIT is a newly opened Radicle issue.
# On success, prints exportable shell assignments to stdout:
#   RADICLE_ISSUE_ID, RADICLE_ISSUE_TITLE, RADICLE_ISSUE_BODY, RADICLE_ISSUE_BRANCH
#
# Exit 0  — issue detected (assignments printed)
# Exit 1  — error
# Exit 2  — not an issue event (skip agent)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

COMMIT="${BUILDKITE_COMMIT:-}"
if [[ -z "$COMMIT" ]]; then
  echo "BUILDKITE_COMMIT is not set" >&2
  exit 1
fi

bk_require_cmd rad
bk_require_rad_repo

if ! bk_commit_is_new_issue "$COMMIT"; then
  echo "commit $COMMIT is not a new issue COB root — skipping agent" >&2
  exit 2
fi

ISSUE_ID="$COMMIT"
mapfile -t _details < <(bk_issue_details "$ISSUE_ID")
TITLE="${_details[0]:-}"
BODY="${_details[1]:-}"

if [[ -z "$TITLE" ]]; then
  TITLE="(no title)"
fi

SHORT="$(bk_short_id "$ISSUE_ID")"
BRANCH="issue/${SHORT}"

printf 'RADICLE_ISSUE_ID=%q\n' "$ISSUE_ID"
printf 'RADICLE_ISSUE_TITLE=%q\n' "$TITLE"
printf 'RADICLE_ISSUE_BODY=%q\n' "$BODY"
printf 'RADICLE_ISSUE_BRANCH=%q\n' "$BRANCH"
