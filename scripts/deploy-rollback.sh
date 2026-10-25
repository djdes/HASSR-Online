#!/usr/bin/env bash
# Откат на предыдущую сборку, если новая не прошла scripts/post-deploy-check.sh.
# Запускается из каталога приложения (deploy.yml, шаг 3/3).
#
#   deploy-rollback.sh <base_url> <версия, которая была на сайте до переключения>
#
# Меняет `.next` обратно на `.next-previous` (неудачная сборка остаётся в
# `.next-failed` для разбора), возвращает `.build-sha`, перезапускает сайт
# и проверяет, что поднялась прежняя версия. Схему БД не трогает: деплой
# применяет только добавляющие изменения, прежняя сборка с ними работает.
# PM2 и APP_NAME переопределяются для теста.

set -u

BASE="${1:?base url}"
PREVIOUS="${2:-}"
PM2="${PM2:-npx pm2}"
APP_NAME="${APP_NAME:-haccp-online}"
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ ! -d .next-previous ]; then
  echo "[rollback] .next-previous нет — откатывать не на что"
  exit 1
fi

rm -rf .next-failed
if [ -d .next ]; then mv .next .next-failed; fi
mv .next-previous .next
if [ -n "$PREVIOUS" ]; then echo "$PREVIOUS" > .build-sha; fi
echo "[rollback] вернули предыдущую сборку ${PREVIOUS:-(версия неизвестна)}, неудачная — в .next-failed"

$PM2 restart "$APP_NAME" --update-env 2>&1 | tail -5

if [ -z "$PREVIOUS" ]; then
  echo "[rollback] версия до переключения неизвестна — проверку прежней сборки пропускаем"
  exit 0
fi
if bash "$HERE/post-deploy-check.sh" "$BASE" "$PREVIOUS"; then
  echo "[rollback] прод снова на $PREVIOUS"
  exit 0
fi
echo "[rollback] прежняя сборка тоже не отвечает — нужен ручной разбор"
exit 1
