#!/usr/bin/env bash
# Проверка после рестарта: сайт отдаёт ровно ту сборку, которую выкатили,
# и главные адреса отвечают без 5xx. Вызывается из deploy.yml (шаг 3/3)
# после рестарта и прогрева; не дождались — шаг откатывает сборку
# (scripts/deploy-rollback.sh) и деплой падает.
#
#   post-deploy-check.sh <base_url> <ожидаемый sha>
#
# POST_DEPLOY_ATTEMPTS (18) × POST_DEPLOY_PAUSE (5 с) — ждём до ~1,5 минуты:
# Next.js после рестарта поднимается не сразу. Всё вместе — не дольше
# POST_DEPLOY_MAX_SECONDS (180): даже если адреса висят до таймаута curl,
# откат должен успеть до таймаута SSH-шага.
#
# 429 — не поломка: это лимит переходов по страницам (page-navigation-guard),
# а прогрев сразу перед проверкой шлёт с сервера сотню запросов. Деплой #2035
# ждал его ~30 с. Ждём дальше, а если до конца отвечают только 429 — сборка
# работает (версия совпала, сайт отвечает), отката нет.

set -u

BASE="${1:?base url}"
EXPECTED="${2:?expected sha}"
EXPECTED="${EXPECTED:0:7}"
ATTEMPTS="${POST_DEPLOY_ATTEMPTS:-18}"
PAUSE="${POST_DEPLOY_PAUSE:-5}"
DEADLINE=$((SECONDS + ${POST_DEPLOY_MAX_SECONDS:-180}))
only_limited=0
read -r -a ROUTES <<< "${POST_DEPLOY_ROUTES:-/ /login}"

for attempt in $(seq 1 "$ATTEMPTS"); do
  served=$(curl -fsS --max-time 10 "$BASE/api/build-info" 2>/dev/null | sed -nE 's/.*"buildId":"([^"]*)".*/\1/p')
  if [ "$served" = "$EXPECTED" ]; then
    failing=""
    limited=""
    for route in "${ROUTES[@]}"; do
      code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$BASE$route")
      case "$code" in
        2??|3??) ;;
        429) limited="$limited $route" ;;
        *) failing="$failing $route=$code" ;;
      esac
    done
    if [ -z "$failing" ] && [ -z "$limited" ]; then
      echo "[verify] сайт отдаёт $EXPECTED, адреса отвечают: ${ROUTES[*]}"
      exit 0
    fi
    if [ -z "$failing" ]; then
      only_limited=1
      echo "[verify] попытка $attempt/$ATTEMPTS: версия $EXPECTED, адреса под лимитом запросов (429):$limited — ждём"
    else
      only_limited=0
      echo "[verify] попытка $attempt/$ATTEMPTS: версия $EXPECTED, но адреса не отвечают:$failing${limited:+, под лимитом:$limited}"
    fi
  else
    only_limited=0
    echo "[verify] попытка $attempt/$ATTEMPTS: сайт отдаёт «${served:-нет ответа}», ждём $EXPECTED"
  fi
  if [ "$SECONDS" -ge "$DEADLINE" ]; then
    echo "[verify] вышло время проверки"
    break
  fi
  if [ "$attempt" -lt "$ATTEMPTS" ]; then sleep "$PAUSE"; fi
done

if [ "$only_limited" = 1 ]; then
  echo "[verify] сайт отдаёт $EXPECTED; страницы до конца отвечали 429 (лимит запросов) — сборка работает, отката нет"
  exit 0
fi
echo "[verify] сборка $EXPECTED не поднялась"
exit 1
