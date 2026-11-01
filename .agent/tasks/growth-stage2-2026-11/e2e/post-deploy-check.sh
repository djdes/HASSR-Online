#!/usr/bin/env bash
# Проверка прода после выкладки (AC7). Настоящую заявку на показ не шлём —
# она разбудила бы Telegram владельца: только отказ без согласия и ловушку.
# Запуск: bash .agent/tasks/growth-stage2-2026-11/e2e/post-deploy-check.sh [https://wesetup.ru]
set -uo pipefail
BASE="${1:-https://wesetup.ru}"
fail=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }
get() { curl -sS --max-time 60 "$BASE$1"; }
code() { curl -sS -o /dev/null -w "%{http_code}" --max-time 60 "$@"; }

echo "build-info: $(get /api/build-info)"
autofill=$(get /avtozapolnenie)
check "/avtozapolnenie: заголовок, ролик, кнопка показа" '[[ "$autofill" == *"Журналы, которые заполняются сами"* && "$autofill" == *"/landing/video/autofill-ru.mp4"* && "$autofill" == *"data-demo-request=\"autofill\""* && "$autofill" == *"VideoObject"* ]]'
video=$(curl -sSI --max-time 60 "$BASE/landing/video/autofill-ru.mp4" | tr -d '\r')
check "ролик отдаётся: 200 video/mp4" '[[ "$video" == *" 200"* && "$video" == *"video/mp4"* ]]'
echo "$video" | grep -iE "^(content-length|content-type):"
security=$(get /security)
check "/security: страница и факты" '[[ "$security" == *"Данные хранятся в России"* && "$security" == *"AES-256-GCM"* ]]'
home=$(get /)
check "подвал главной: /security и /avtozapolnenie" '[[ "$home" == *"href=\"/security\""* && "$home" == *"href=\"/avtozapolnenie\""* ]]'
check "главная: показ за 15 минут" '[[ "$home" == *"data-demo-request=\"home:final\""* ]]'
pricing=$(get /pricing)
check "/pricing: кнопка показа" '[[ "$pricing" == *"data-demo-request=\"pricing\""* ]]'
kafe=$(get /dlya-kafe)
check "/dlya-kafe: кнопки показа" '[[ "$kafe" == *"data-demo-request=\"niche:dlya-kafe\""* && "$kafe" == *"data-demo-request=\"niche:dlya-kafe:bottom\""* ]]'
partners=$(get /partners)
check "/partners: 30 %" '[[ "$partners" == *"30% с подписок"* ]]'
no_consent=$(curl -sS --max-time 60 -X POST -H "content-type: application/json" -d '{"name":"Проверка","phone":"+79990000000","when":"today"}' -w " %{http_code}" "$BASE/api/demo-request")
check "POST /api/demo-request без согласия → 400" '[[ "$no_consent" == *" 400" ]]'
echo "  $no_consent"
trap_reply=$(curl -sS --max-time 60 -X POST -H "content-type: application/json" -d '{"website":"http://spam","name":"Bot","phone":"1"}' -w " %{http_code}" "$BASE/api/demo-request")
check "POST /api/demo-request с ловушкой → 200 без записи" '[[ "$trap_reply" == "{\"ok\":true} 200" ]]'
check "/root/funnel без входа → 404" '[[ "$(code "$BASE/root/funnel")" == "404" ]]'
sitemap=$(get /sitemap.xml)
check "sitemap: /avtozapolnenie и /security" '[[ "$sitemap" == *"/avtozapolnenie</loc>"* && "$sitemap" == *"/security</loc>"* ]]'
exit $fail
