#!/usr/bin/env bash
# Ставит строку crontab для CRM (раз в 5 минут, scripts/cron-crm.sh).
# Идемпотентно: свою строку находит по метке и заменяет; ручную строку с
# /api/cron/crm, если её добавляли по docs/crm.md, тоже заменяет, чтобы крон
# не шёл дважды. Остальные строки crontab не трогает.
# Запуск: bash scripts/install-crm-cron.sh (на деплое — из каталога приложения).
set -uo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MARK="# wesetup-crm-cron"
LINE="2-59/5 * * * * /bin/bash $APP_DIR/scripts/cron-crm.sh >> \$HOME/wesetup-cron-crm.log 2>&1 $MARK"

if ! command -v crontab >/dev/null 2>&1; then
  echo "[crm-cron] crontab недоступен на сервере — крон CRM не установлен"
  exit 1
fi
current="$(crontab -l 2>/dev/null || true)"
if printf '%s\n' "$current" | grep -qxF "$LINE"; then
  echo "[crm-cron] уже установлен"
  exit 0
fi
{
  if [ -n "$current" ]; then printf '%s\n' "$current" | grep -vE "wesetup-crm-cron|/api/cron/crm( |\"|'|$)" || true; fi
  echo "$LINE"
} | crontab -
if crontab -l 2>/dev/null | grep -qxF "$LINE"; then
  echo "[crm-cron] установлен: каждые 5 минут → $APP_DIR/scripts/cron-crm.sh"
else
  echo "[crm-cron] не удалось записать crontab"
  exit 1
fi
