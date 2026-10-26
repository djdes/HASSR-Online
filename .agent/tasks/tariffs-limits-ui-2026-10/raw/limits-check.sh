#!/bin/bash
# Живая проверка лимитов мест и «Меркурия» по HTTP (tariffs-limits-ui AC1, AC5, AC6).
# Сначала limits-scenarios.ts (аккаунты lim-*). Нужны: next dev на :3000, локальная БД,
# login.sh (пароль TestPass123!) в $JAR_DIR.
# Запуск: JAR_DIR=... DB=postgresql://... bash limits-check.sh > limits-check.txt
set -u
J="${JAR_DIR:?}"
DB="${DB:?}"
B=http://localhost:3000
OUT="$(mktemp -d)"
XFF="203.0.113.$((RANDOM % 250 + 1))"

say() { echo; echo "=== $*"; }
req() {
  local jar="$1" method="$2" path="$3" body="${4:-}"
  local args=(-s -o "$OUT/body" -w "%{http_code}" -X "$method" "$B$path" -H "X-Forwarded-For: $XFF" -b "$J/$jar.jar" -c "$J/$jar.jar")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")
  curl "${args[@]}"
}
json() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(" · ".join(f"{k}={d.get(k)!r}" for k in sys.argv[2:]))' "$OUT/body" "$@"; }
visible() { python3 -c 'import re,html,sys; s=re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>","",sys.stdin.read()); print(re.sub(r"\s+"," ",html.unescape(re.sub(r"<[^>]+>"," ",s))))'; }
page() { curl -s -b "$J/$1.jar" -H "X-Forwarded-For: $XFF" "$B$2" | visible; }
has() { echo "$1" | grep -o -- "$2" | head -1; }

for who in lim-free lim-std-full lim-std-over lim-prem-full lim-prem-over; do bash "$J/login.sh" "$who@example.test" >/dev/null; done

say "A. Места заняты — 402: лимит текущего тарифа и следующий тариф"
for who in lim-free lim-std-full lim-prem-full; do
  code=$(req "$who" POST /api/users/invite "{\"name\":\"Новый сотрудник\",\"email\":\"lim-new-$RANDOM@example.test\",\"role\":\"cook\"}")
  echo "-- $who: HTTP $code · $(json code limit tier nextTier)"
  echo "   текст: $(json error)"
done

say "B. «Тариф и оплата»: сотрудников больше лимита — предложение следующего тарифа"
p=$(page lim-std-over /settings/subscription)
echo "-- «Стандарт», 40 сотрудников: $(has "$p" "Сотрудников больше, чем даёт «Стандарт» ([0-9]* из [0-9]*)[^.]*\. Перейдите на «Премиум» — до 100 сотрудников на точку")"
echo "   карточка «Стандарта»: $(has "$p" "У вас 40 сотрудников, а здесь до 25 — подойдёт «Премиум»")"
echo "   ссылка: $(curl -s -b "$J/lim-std-over.jar" "$B/settings/subscription" | grep -o 'href="/order?plan=premium[^"]*"' | head -1)"
p=$(page lim-prem-over /settings/subscription)
echo "-- «Премиум», 140 сотрудников: $(has "$p" "Сотрудников больше, чем даёт «Премиум» ([0-9]* из [0-9]*)[^.]*\. Больше 100 на точку — по согласованию")"
echo "   кнопка: $(has "$p" "Связаться")"
p=$(page lim-std-full /settings/subscription)
echo "-- «Стандарт», 25 сотрудников (в пределах): заметка $( [ -n "$(has "$p" "Сотрудников больше")" ] && echo "ЕСТЬ — ОШИБКА" || echo "нет")"
echo "   правила: $(has "$p" "Сотрудники: «Стандарт» — до 25 на точку, «Премиум» — до 100, больше — по согласованию")"

say "C. /order: численность больше выбранного тарифа — заметка и переход на следующий"
p=$(page lim-std-over "/order?plan=standard&cycle=month&points=1")
echo "-- «Стандарт» при 40: $(has "$p" "У вас 40 сотрудников, а на «Стандарте» — до 25 на точку[^.]*\. Подойдёт «Премиум» — до 100 сотрудников на точку")"
echo "   кнопка: $(curl -s -b "$J/lim-std-over.jar" "$B/order?plan=standard&cycle=month&points=1" | grep -o '<a[^>]*data-testid="order-headcount-upgrade"[^>]*>' | grep -o 'href="[^"]*"' | head -1)"
echo "   оплата открыта: $(has "$p" "К оплате")"
p=$(page lim-std-over "/order?plan=premium&cycle=month&points=1")
echo "-- «Премиум» при 40: заметка $( [ -n "$(has "$p" "новых добавить не получится")" ] && echo "ЕСТЬ — ОШИБКА" || echo "нет")"
p=$(page lim-prem-over "/order?plan=premium&cycle=month&points=1")
echo "-- «Премиум» при 140: $(has "$p" "У вас 140 сотрудников, а на «Премиуме» — до 100 на точку[^.]*\. Больше — по согласованию")"
p=$(page lim-std-full "/order?plan=standard&cycle=month&points=1")
echo "-- «Стандарт» при 25: заметка $( [ -n "$(has "$p" "новых добавить не получится")" ] && echo "ЕСТЬ — ОШИБКА" || echo "нет")"

say "D. «Меркурий»: в «Премиуме» есть, в «Стандарте» — 402 и предложение «Премиума»"
code=$(req lim-std-full GET /api/mercury); echo "-- «Стандарт» GET /api/mercury: HTTP $code · $(json available)"
code=$(req lim-std-full POST /api/integrations/mercury '{"environment":"test","issuerGuid":"00000000-0000-0000-0000-000000000000","initiatorLogin":"x","apiKey":"y"}'); echo "   POST /api/integrations/mercury: HTTP $code · $(json code error)"
code=$(req lim-std-full POST /api/mercury/documents/nope/process '{"action":"accept"}'); echo "   POST /api/mercury/documents/…/process: HTTP $code · $(json code)"
p=$(page lim-std-full /mercury)
echo "   /mercury: $(has "$p" "Интеграция доступна в тарифе «Премиум»") · кнопка: $(has "$p" "Перейти на «Премиум»")"
echo "   /settings/integrations/mercury: $(has "$(page lim-std-full /settings/integrations/mercury)" "Меркурий доступен в тарифе «Премиум»")"
code=$(req lim-prem-full GET /api/mercury); echo "-- «Премиум» GET /api/mercury: HTTP $code · $(json available)"
p=$(page lim-prem-full /mercury)
echo "   /mercury без замка: $( [ -n "$(has "$p" "доступна в тарифе")" ] && echo "ЗАМОК — ОШИБКА" || echo "да")"

rm -rf "$OUT"
