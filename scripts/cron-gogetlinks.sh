#!/usr/bin/env bash
set -eo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "${1:-}" == "--run" ]]; then
  if [[ -f "$APP_DIR/.env" ]]; then
    # shellcheck disable=SC1091
    . "$APP_DIR/.env"
  fi
  if [[ -z "${CRON_SECRET:-}" ]]; then
    echo "[gogetlinks-cron] CRON_SECRET is missing" >&2
    exit 1
  fi
  result="$(printf 'Authorization: Bearer %s\n' "$CRON_SECRET" |
    curl -fsS --max-time 110 -X POST --header @- http://127.0.0.1:3002/api/cron/gogetlinks)"
  printf '%s [gogetlinks-cron] %s\n' "$(date -Is)" "$result"
  exit
fi

MARK="# wesetup-gogetlinks-cron"
LINE="3-59/10 * * * * /bin/bash $APP_DIR/scripts/cron-gogetlinks.sh --run >> \$HOME/wesetup-cron-gogetlinks.log 2>&1 $MARK"
current="$(crontab -l 2>/dev/null || true)"
updated="$(
  printf '%s\n' "$current" | awk 'NF && !/wesetup-gogetlinks-cron|\/api\/cron\/gogetlinks([?[:space:]"\047]|$)/'
  printf '%s\n' "$LINE"
)"
if [[ "$current" != "$updated" ]]; then
  printf '%s\n' "$updated" | crontab -
fi
crontab -l | grep -Fx -- "$LINE"
