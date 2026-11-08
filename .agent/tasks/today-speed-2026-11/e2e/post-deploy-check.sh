#!/usr/bin/env bash
# Прод после выкладки «Быстрее по журналам за день» — без входа и без записей:
#  - /api/build-info — коммит;
#  - /login и главная открываются (200);
#  - лист «Что заполнить сегодня» без входа ведёт на вход;
#  - в HTML /login есть новые тексты (common.quickActions) — сборка с новым кодом.
# Запуск: bash .agent/tasks/today-speed-2026-11/e2e/post-deploy-check.sh [https://wesetup.ru]
set -u
BASE="${1:-https://wesetup.ru}"
UA="WeSetup-post-deploy-check/1.0"
pass=0; fail=0
ok() { echo "PASS $1"; pass=$((pass + 1)); }
bad() { echo "FAIL $1"; fail=$((fail + 1)); }

echo "build-info: $(curl -s --max-time 30 -A "$UA" "$BASE/api/build-info")"
for path in /login /; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 60 -A "$UA" "$BASE$path")
  [ "$code" = "200" ] && ok "$path 200" || bad "$path $code"
done
loc=$(curl -s -o /dev/null -w "%{http_code} %{redirect_url}" --max-time 60 -A "$UA" "$BASE/dashboard/today-print?codes=hygiene")
echo "today-print без входа: $loc"
echo "$loc" | grep -qE "^(30[0-9]) .*/login" && ok "лист без входа → вход" || bad "лист без входа: $loc"
# Новые общие тексты (common.quickActions: «Поделиться», «Горячие клавиши») приходят
# в HTML любой страницы вместе с переводами — признак новой сборки.
html=$(curl -s --max-time 60 -A "$UA" "$BASE/login")
echo "$html" | grep -q 'hotkeysTitle' && ok "новые тексты в сборке (quickActions)" || bad "нет quickActions в HTML /login"
echo "Итого: $pass PASS, $fail FAIL"
[ "$fail" -eq 0 ]
