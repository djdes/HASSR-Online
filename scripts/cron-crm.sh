#!/usr/bin/env bash
# Крон CRM (docs/crm.md): сбор обращений, почта IMAP, напоминания РОП и
# утренняя сводка — POST /api/cron/crm раз в 5 минут. Строку crontab ставит
# scripts/install-crm-cron.sh на каждом деплое. CRON_SECRET берётся из .env
# приложения; в лог (crontab → ~/wesetup-cron-crm.log) пишутся только сбои.
set -eo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$APP_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$APP_DIR/.env"
  set +a
fi
if [ -z "${CRON_SECRET:-}" ]; then
  echo "$(date -Is) [crm-cron] CRON_SECRET не задан в $APP_DIR/.env"
  exit 1
fi
BASE="${CRM_CRON_BASE_URL:-http://127.0.0.1:3002}"
if ! curl -fsS -m 280 -o /dev/null -X POST -H "Authorization: Bearer $CRON_SECRET" "$BASE/api/cron/crm"; then
  echo "$(date -Is) [crm-cron] $BASE/api/cron/crm не ответил"
  exit 1
fi
