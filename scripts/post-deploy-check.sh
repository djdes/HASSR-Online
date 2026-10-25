#!/usr/bin/env bash
# Проверка после рестарта: сайт отдаёт ровно ту сборку, которую выкатили,
# и главные адреса отвечают без 5xx. Вызывается из deploy.yml (шаг 3/3)
# после рестарта и прогрева; не дождались — шаг откатывает сборку
# (scripts/deploy-rollback.sh) и деплой падает.
#
#   post-deploy-check.sh <base_url> <ожидаемый sha>
#
# POST_DEPLOY_ATTEMPTS (18) × POST_DEPLOY_PAUSE (5 с) — ждём до ~1,5 минуты:
# Next.js после рестарта поднимается не сразу.

set -u

BASE="${1:?base url}"
EXPECTED="${2:?expected sha}"
EXPECTED="${EXPECTED:0:7}"
ATTEMPTS="${POST_DEPLOY_ATTEMPTS:-18}"
PAUSE="${POST_DEPLOY_PAUSE:-5}"
read -r -a ROUTES <<< "${POST_DEPLOY_ROUTES:-/ /login}"

for attempt in $(seq 1 "$ATTEMPTS"); do
  served=$(curl -fsS --max-time 10 "$BASE/api/build-info" 2>/dev/null | sed -nE 's/.*"buildId":"([^"]*)".*/\1/p')
  if [ "$served" = "$EXPECTED" ]; then
    failing=""
    for route in "${ROUTES[@]}"; do
      code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$BASE$route")
      case "$code" in
        2??|3??) ;;
        *) failing="$failing $route=$code" ;;
      esac
    done
    if [ -z "$failing" ]; then
      echo "[verify] сайт отдаёт $EXPECTED, адреса отвечают: ${ROUTES[*]}"
      exit 0
    fi
    echo "[verify] попытка $attempt/$ATTEMPTS: версия $EXPECTED, но адреса не отвечают:$failing"
  else
    echo "[verify] попытка $attempt/$ATTEMPTS: сайт отдаёт «${served:-нет ответа}», ждём $EXPECTED"
  fi
  if [ "$attempt" -lt "$ATTEMPTS" ]; then sleep "$PAUSE"; fi
done

echo "[verify] сборка $EXPECTED не поднялась за $ATTEMPTS попыток"
exit 1
