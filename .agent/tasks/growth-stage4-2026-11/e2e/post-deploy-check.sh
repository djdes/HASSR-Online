#!/usr/bin/env bash
# Проверка прода после выкладки этапа 4 (AC5). Ничего не создаём: просьбы об
# отзыве и отзывы — только на локальном стенде (e2e/ui-check.cjs), здесь —
# страницы и отказы без входа.
# Запуск: bash .agent/tasks/growth-stage4-2026-11/e2e/post-deploy-check.sh [https://wesetup.ru]
set -uo pipefail
BASE="${1:-https://wesetup.ru}"
fail=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }
# GET повторяем при обрыве сети (у прода бывают «connection reset»); POST — нет.
get() { local out; for _ in 1 2 3; do out=$(curl -sS --max-time 60 "$BASE$1") && { printf '%s' "$out"; return 0; }; sleep 3; done; return 1; }
code() { local out; for _ in 1 2 3; do out=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 60 "$@") && { printf '%s' "$out"; return 0; }; sleep 3; done; printf '%s' "$out"; }

echo "build-info: $(get /api/build-info)"

sanpin=$(get /sanpin-2-3-2-4-4282-26)
check "/sanpin: чек-лист «Готовы ли вы к проверке?» — 7 вопросов" '[[ "$sanpin" == *"data-testid=\"sanpin-checklist\""* && "$sanpin" == *"Готовы ли вы к проверке?"* && $(grep -o "role=\"radiogroup\"" <<<"$sanpin" | wc -l) -eq 7 ]]'
check "/sanpin: ссылка на чек-лист из шапки, список журналов на месте" '[[ "$sanpin" == *"href=\"#checklist\""* && "$sanpin" == *"data-testid=\"sanpin-journals\""* ]]'

home=$(get /)
pricing=$(get /pricing)
check "главная и /pricing открываются" '[[ "$home" == *"WeSetup"* && "$pricing" == *"Сколько стоит WeSetup"* ]]'
# Блок отзывов показывается, только когда есть одобренные отзывы, разрешённые к публикации.
for page in home pricing; do
  html=${!page}
  if [[ "$html" == *"testimonial-stats"* ]]; then echo "INFO $page: отзыв с цифрами показан"
  elif [[ "$html" == *"<blockquote"* ]]; then echo "INFO $page: отзывы показаны (без цифр)"
  else echo "INFO $page: одобренных отзывов нет — блока нет"; fi
done

check "/root/reviews без входа → 404" '[[ "$(code "$BASE/root/reviews")" == "404" ]]'
check "POST /api/root/reviews/request без входа → 404" '[[ "$(code -X POST -H "content-type: application/json" -d "{\"organizationId\":\"x\"}" "$BASE/api/root/reviews/request")" == "404" ]]'
exit $fail
