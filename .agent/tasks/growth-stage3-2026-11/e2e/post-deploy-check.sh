#!/usr/bin/env bash
# Проверка прода после выкладки этапа 3 (AC7). Ничего настоящего не создаём:
# заявку на показ не шлём (разбудила бы Telegram владельца), счёт гостю не
# выставляем (письмо и заметка админу) — только отказы, которые срабатывают
# до записи в базу: запись на прошедшее время — 409 до транзакции. Замок
# слота (pg_advisory_xact_lock) и повторная запись проверены на локальной
# базе (e2e/local-flow-check.ts).
# Запуск: bash .agent/tasks/growth-stage3-2026-11/e2e/post-deploy-check.sh [https://wesetup.ru]
set -uo pipefail
BASE="${1:-https://wesetup.ru}"
fail=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }
# GET повторяем при обрыве сети (у прода бывают «connection reset»); POST — нет.
get() { local out; for _ in 1 2 3; do out=$(curl -sS --max-time 60 "$BASE$1") && { printf '%s' "$out"; return 0; }; sleep 3; done; return 1; }
code() { local out; for _ in 1 2 3; do out=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 60 "$@") && { printf '%s' "$out"; return 0; }; sleep 3; done; printf '%s' "$out"; }
post() { curl -sS --max-time 60 -X POST -H "content-type: application/json" -d "$2" -w " %{http_code}" "$BASE$1"; }

echo "build-info: $(get /api/build-info)"

partners=$(get /partners)
check "/partners: калькулятор дохода" '[[ "$partners" == *"id=\"calculator\""* && "$partners" == *"data-partner-calculator"* && "$partners" == *"href=\"#calculator\""* ]]'

sanpin=$(get /sanpin-2-3-2-4-4282-26)
check "/sanpin-2-3-2-4-4282-26: заголовок, журналы, FAQ" '[[ "$sanpin" == *"что нужно знать общепиту"* && "$sanpin" == *"data-testid=\"sanpin-journals\""* && "$sanpin" == *"FAQPage"* ]]'
glossary=$(get /glossary/sanpin-2-3-2-4-4282-26)
check "глоссарий ведёт на страницу СанПиН" '[[ "$glossary" == *"href=\"/sanpin-2-3-2-4-4282-26\""* ]]'
sitemap=$(get /sitemap.xml)
check "sitemap: /sanpin-2-3-2-4-4282-26" '[[ "$sitemap" == *"<loc>https://wesetup.ru/sanpin-2-3-2-4-4282-26</loc>"* ]]'

slots_headers=$(for _ in 1 2 3; do curl -sSI --max-time 60 "$BASE/api/demo-request/slots" && break; sleep 3; done | tr -d '\r')
slots=$(get /api/demo-request/slots)
check "слоты показа: 200, no-store, Москва, 5 дней" '[[ "$slots_headers" == *" 200"* && "${slots_headers,,}" == *"no-store"* && "$slots" == *"\"timeZone\":\"Europe/Moscow\""* && $(grep -o "\"key\"" <<<"$slots" | wc -l) -eq 5 ]]'
past=$(post /api/demo-request '{"name":"Проверка выкладки","phone":"+79990000000","slot":"2026-01-05T07:00:00.000Z","consent":true,"place":"deploy-check"}')
check "запись на прошедшее время → 409 slot-taken (без записи)" '[[ "$past" == *"slot-taken"*" 409" ]]'
echo "  $past"
no_choice=$(post /api/demo-request '{"name":"Проверка выкладки","phone":"+79990000000","consent":true}')
check "заявка без времени и без «когда удобно» → 400" '[[ "$no_choice" == *" 400" ]]'

bad_inn=$(post /api/payments/invoice/guest '{"inn":"1234567890","email":"check@example.test","plan":"standard","cycle":"month","points":1}')
check "счёт гостю: неверный ИНН → 400" '[[ "$bad_inn" == *" 400" ]]'
echo "  $bad_inn"
check "PDF счёта гостя без подписи → 404" '[[ "$(code "$BASE/api/payments/invoice/1/guest-pdf?sig=wrong")" == "404" ]]'
order=$(get "/order?plan=standard&cycle=month&points=1")
check "/order: оплата открывается" '[[ "$order" == *"standard"* ]]'
# Форма счёта гостю есть, только когда реквизиты WeSetup заполнены в ROOT (как у счёта из кабинета).
if [[ "$order" == *"data-guest-invoice"* ]]; then echo "INFO /order: форма «Счёт по ИНН» показана (реквизиты заполнены)"; else echo "INFO /order: формы «Счёт по ИНН» нет — реквизиты WeSetup не заполнены"; fi

check "/root/invoices без входа → 404" '[[ "$(code "$BASE/root/invoices")" == "404" ]]'
check "сводный отчёт без входа → 401" '[[ "$(code "$BASE/api/reports/compliance-bundle?format=pdf")" == "401" ]]'
exit $fail
