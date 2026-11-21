#!/usr/bin/env bash
# Ставит агента выката (docs/deploy-agent.md): строку crontab раз в 5 минут и
# снимок окружения сеанса деплоя (PATH с node, язык, пояс) — крон стартует с
# пустым PATH. Идемпотентно: свою строку находит по метке и заменяет,
# остальные строки crontab не трогает. Запуск — шаг 3 выката, из каталога
# приложения: bash scripts/install-deploy-agent-cron.sh
set -uo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="${WESETUP_DEPLOY_AGENT_DIR:-$HOME/.wesetup-deploy-agent}"
MARK="# wesetup-deploy-agent"
LINE="4-59/5 * * * * /bin/bash $APP_DIR/scripts/deploy-agent.sh >> \$HOME/wesetup-deploy-agent.log 2>&1 $MARK"

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR" 2>/dev/null || true
{
  echo "# Снимок окружения сеанса деплоя для крона агента выката — пишет install-deploy-agent-cron.sh"
  for name in PATH LANG LC_ALL TZ NVM_DIR NVM_BIN; do
    value="${!name:-}"
    if [ -n "$value" ]; then printf 'export %s=%q\n' "$name" "$value"; fi
  done
} > "$STATE_DIR/env.tmp" && mv -f "$STATE_DIR/env.tmp" "$STATE_DIR/env"
chmod 600 "$STATE_DIR/env" 2>/dev/null || true

if ! command -v crontab >/dev/null 2>&1; then
  echo "[deploy-agent] crontab недоступен на сервере — агент не установлен"
  exit 1
fi
current="$(crontab -l 2>/dev/null || true)"
if printf '%s\n' "$current" | grep -qxF "$LINE"; then
  echo "[deploy-agent] уже установлен"
  exit 0
fi
{
  if [ -n "$current" ]; then printf '%s\n' "$current" | grep -vF "$MARK" || true; fi
  echo "$LINE"
} | crontab -
if crontab -l 2>/dev/null | grep -qxF "$LINE"; then
  echo "[deploy-agent] установлен: каждые 5 минут → $APP_DIR/scripts/deploy-agent.sh"
else
  echo "[deploy-agent] не удалось записать crontab"
  exit 1
fi
