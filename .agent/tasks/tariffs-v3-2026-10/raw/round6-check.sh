#!/bin/bash
# Живая проверка исправлений после независимой проверки 6 (HTTP и браузер).
# Сначала round6-scenarios.ts (готовит аккаунты r6-*). Нужны: next dev на :3000,
# локальная БД, login.sh (пароль TestPass123!) в $JAR_DIR, pdftotext.
# Запуск: JAR_DIR=... DB=postgresql://... bash round6-check.sh > round6-check.txt
set -u
J="${JAR_DIR:?}"
DB="${DB:?}"
B=http://localhost:3000
OUT="$(mktemp -d)"
XFF="203.0.113.$((RANDOM % 250 + 1))"

say() { echo; echo "=== $*"; }
req() {
  local jar="$1" method="$2" path="$3" body="${4:-}"
  local args=(-s -o "$OUT/body" -w "%{http_code}" -X "$method" "$B$path" -H "X-Forwarded-For: $XFF")
  [ "$jar" != "-" ] && args+=(-b "$J/$jar.jar" -c "$J/$jar.jar")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")
  local code
  code=$(curl "${args[@]}")
  echo "HTTP $code $(python3 -c 'import sys; print(open(sys.argv[1],encoding="utf-8",errors="replace").read()[:220].replace("\n"," "))' "$OUT/body")"
}
sql() { psql "$DB" -At -c "$1"; }
visible() { python3 -c 'import re,html,sys; s=re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>","",sys.stdin.read()); print(re.sub(r"\s+"," ",html.unescape(re.sub(r"<[^>]+>"," ",s))))'; }
acct() { sql "select a.\"subscriptionPlan\" || ' · ' || coalesce(a.\"planCycle\",'—') || ' · до ' || coalesce(to_char(a.\"subscriptionEnd\",'YYYY-MM-DD HH24:MI'),'—') from \"User\" u join \"Organization\" o on o.id=u.\"organizationId\" join \"Account\" a on a.id=o.\"accountId\" where u.email='$1'"; }

for who in root r6-demo-cook r6-totals r6-due; do bash "$J/login.sh" "$who@example.test" >/dev/null; done

say "D1. Сотрудник из демо-организации аккаунта: оплата не оформляется, тариф аккаунта прежний"
echo "-- подписка аккаунта: $(acct r6-demo-owner@example.test)"
echo "-- /order: $(curl -s -b "$J/r6-demo-cook.jar" "$B/order?plan=standard&cycle=month&points=1" | visible | grep -o "Тариф этой организации оплачивает руководитель в кабинете основной организации" | head -1)"
req r6-demo-cook POST /api/payments/robokassa/create '{"plan":"standard","cycle":"month","points":1}'
echo "-- подписка аккаунта после: $(acct r6-demo-owner@example.test)"

say "D2. Итог «оплачено» и строка возвращённой оплаты"
HELD_ID=$(sql "select id from \"PaymentOrder\" where email='r6-totals@example.test' and \"heldAt\" is not null order by id desc limit 1")
TOT_ORG=$(sql "select \"organizationId\" from \"PaymentOrder\" where id=$HELD_ID")
req root POST "/api/root/orders/$HELD_ID/resolve" '{"outcome":"refunded"}'
page=$(curl -s -b "$J/r6-totals.jar" "$B/settings/subscription" | visible)
echo "-- кабинет: $(echo "$page" | grep -o "Оплачено за всё время: [0-9  ]* ₽" | head -1); оплаты в базе: $(sql "select string_agg(amount_row, ', ' order by id) from (select id, \"amountRub\"::int || ' ₽ ' || case when \"refundedAt\" is not null then '(возвращён)' when status='paid' then '(оплачен)' else status end as amount_row from \"PaymentOrder\" where \"organizationId\"='$TOT_ORG' and status='paid') t")"
echo "$page" | grep -q "баллами −400" && echo "    строка возвращённой оплаты показывает «баллами −400» — ОШИБКА" || echo "    строка возвращённой оплаты без «баллами −400»: $(echo "$page" | grep -o "(доплата) возвращён 600 ₽" | head -1)"
echo "-- ROOT: $(curl -s -b "$J/root.jar" "$B/root/organizations/$TOT_ORG" | visible | grep -o "Оплачено за всё время [0-9  ]* ₽" | head -1)"
curl -s -A "Mozilla/5.0 WeSetupApp/1.0 (ios)" -b "$J/r6-totals.jar" "$B/settings/subscription" -o "$OUT/app.html"
python3 - "$OUT/app.html" <<'PY'
import re, sys
s = open(sys.argv[1], encoding="utf-8").read()
i = s.find("возвращён")
chunk = s[i:i + 600] if i >= 0 else ""
m = re.search(r'class="([^"]*tabular-nums[^"]*)"', chunk)
print("-- приложение: строка «возвращён», сумма", "серая (text-[#6f7282])" if m and "6f7282" in m.group(1) else ("ОШИБКА: " + (m.group(1) if m else "не найдена")))
PY

say "D4. Счёт на доплату: действует до последнего полного дня перед концом срока (МСК)"
req r6-due POST /api/payments/invoice '{"plan":"premium","cycle":"month","points":1}'
INV=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["orderId"])' "$OUT/body")
echo "-- конец подписки (МСК): $(sql "select to_char((a.\"subscriptionEnd\" at time zone 'UTC') at time zone 'Europe/Moscow','DD.MM.YYYY HH24:MI') from \"User\" u join \"Organization\" o on o.id=u.\"organizationId\" join \"Account\" a on a.id=o.\"accountId\" where u.email='r6-due@example.test'")"
echo "-- срок счёта №$INV (МСК): $(sql "select to_char((\"invoiceDueAt\" at time zone 'UTC') at time zone 'Europe/Moscow','DD.MM.YYYY HH24:MI:SS.MS') from \"PaymentOrder\" where id=$INV")"
curl -s -b "$J/r6-due.jar" "$B/api/payments/invoice/$INV/pdf" -o "$OUT/invoice.pdf"
echo "-- PDF: $(pdftotext "$OUT/invoice.pdf" - 2>/dev/null | tr '\n' ' ' | grep -o "Счёт действителен до [0-9.]*" | head -1)"

rm -rf "$OUT"
