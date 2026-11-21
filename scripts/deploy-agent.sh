#!/usr/bin/env bash
# Крон агента выката (docs/deploy-agent.md): раз в 5 минут сверяет сборку сайта
# с master и, если выкат из GitHub не дошёл до сервера, выкатывает сам
# (scripts/deploy-agent.mjs). Строку crontab ставит
# scripts/install-deploy-agent-cron.sh на каждом деплое.
# Выключить: touch ~/.wesetup-deploy-agent-off (включить — удалить файл).
set -uo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="${WESETUP_DEPLOY_AGENT_DIR:-$HOME/.wesetup-deploy-agent}"

if [ -f "$HOME/.wesetup-deploy-agent-off" ]; then
  exit 0
fi
# Окружение сеанса деплоя (PATH с node, язык, пояс): у крона PATH пустой, а
# шаги выката зовут node, npx и pm2 так же, как при выкате из GitHub.
if [ -f "$STATE_DIR/env" ]; then
  # shellcheck disable=SC1091
  . "$STATE_DIR/env"
fi
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "$(date -Is) [deploy-agent] node не найден (PATH=$PATH) — агент не запущен"
  exit 1
fi
export APP_DIR
exec node "$APP_DIR/scripts/deploy-agent.mjs"
