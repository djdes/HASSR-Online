#!/bin/bash
# Живая проверка исправлений после независимой проверки 5 (HTTP и браузер).
# Сначала round5-scenarios.ts (готовит аккаунты r5-*). Нужны: next dev на :3000,
# локальная БД, login.sh (пароль TestPass123!) в $JAR_DIR, pdftotext.
# Запуск: JAR_DIR=... DB=postgresql://... bash round5-check.sh > round5-check.txt
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

for who in root r5-demo r5-due r5-ref-apply r5-ref-refund r5-decision-cook premium; do bash "$J/login.sh" "$who@example.test" >/dev/null; done

say "D1. Оплата из демо-организации аккаунта — отказ, тариф аккаунта не трогается"
echo "-- подписка аккаунта: $(acct r5-demo@example.test)"
req r5-demo POST /api/organizations/demo
DEMO_ORG=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["organizationId"])' "$OUT/body")
# ИНН — чтобы счёт дошёл до расчёта суммы (без ИНН счёт отказывает раньше).
sql "update \"Organization\" set inn='7707083893' where id='$DEMO_ORG' and \"isDemo\"" >/dev/null
echo "-- страница /order в демо: $(curl -s -b "$J/r5-demo.jar" "$B/order?plan=standard&cycle=month" | visible | grep -o "Из этой организации тариф не оплачивается[^.]*\." | head -1)"
req r5-demo POST /api/payments/robokassa/create '{"plan":"standard","cycle":"month","points":1}'
req r5-demo POST /api/payments/invoice '{"plan":"standard","cycle":"month","points":1}'
echo "-- подписка аккаунта после: $(acct r5-demo@example.test)"
req r5-demo DELETE /api/organizations/demo

say "D3. Счёт на доплату: срок в PDF = срок в заказе (не позже конца оплаченного срока)"
req r5-due POST /api/payments/invoice '{"plan":"premium","cycle":"month","points":1}'
INV=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["orderId"])' "$OUT/body")
echo "-- заказ №$INV: срок оплаты $(sql "select to_char((\"invoiceDueAt\" at time zone 'UTC') at time zone 'Europe/Moscow','DD.MM.YYYY') from \"PaymentOrder\" where id=$INV"), конец подписки $(sql "select to_char((a.\"subscriptionEnd\" at time zone 'UTC') at time zone 'Europe/Moscow','DD.MM.YYYY') from \"User\" u join \"Organization\" o on o.id=u.\"organizationId\" join \"Account\" a on a.id=o.\"accountId\" where u.email='r5-due@example.test'")"
curl -s -b "$J/r5-due.jar" "$B/api/payments/invoice/$INV/pdf" -o "$OUT/invoice.pdf"
echo "-- PDF: $(pdftotext "$OUT/invoice.pdf" - 2>/dev/null | tr '\n' ' ' | grep -o "Счёт действителен до [0-9.]*" | head -1)"

say "D4/D6. ROOT «Тариф применён»: скидка навсегда и награда пригласившему — после разбора"
APPLY_ID=$(sql "select id from \"PaymentOrder\" where email='r5-ref-apply@example.test' and \"heldAt\" is not null order by id desc limit 1")
APPLY_ORG=$(sql "select \"organizationId\" from \"PaymentOrder\" where id=$APPLY_ID")
echo "-- до: награда пригласившему $(sql "select count(*) from \"BalanceTransaction\" where kind='referral_reward' and \"referredOrganizationId\"='$APPLY_ORG'"), скидка навсегда $(sql "select count(*) from \"AccountLifetimeDiscount\" l join \"Organization\" o on o.\"accountId\"=l.\"accountId\" where o.id='$APPLY_ORG'")"
req root POST "/api/root/orders/$APPLY_ID/resolve" '{"outcome":"applied"}'
echo "-- после: награда пригласившему $(sql "select coalesce(sum(amount),0) || ' баллов (' || count(*) || ')' from \"BalanceTransaction\" where kind='referral_reward' and \"referredOrganizationId\"='$APPLY_ORG'"), скидка навсегда $(sql "select coalesce(max(code || ' −' || value || '%, заказ №' || \"orderId\"),'нет') from \"AccountLifetimeDiscount\" l join \"Organization\" o on o.\"accountId\"=l.\"accountId\" where o.id='$APPLY_ORG'")"

say "D4/D5. ROOT «Деньги возвращены»: баллы обратно, награды нет, подпись «возвращён»"
REFUND_ID=$(sql "select id from \"PaymentOrder\" where email='r5-ref-refund@example.test' and \"heldAt\" is not null order by id desc limit 1")
REFUND_ORG=$(sql "select \"organizationId\" from \"PaymentOrder\" where id=$REFUND_ID")
echo "-- до: баланс $(sql "select \"balanceRub\" from \"Organization\" where id='$REFUND_ORG'"), баллами в заказе $(sql "select \"pointsSpent\" from \"PaymentOrder\" where id=$REFUND_ID")"
req root POST "/api/root/orders/$REFUND_ID/resolve" '{"outcome":"refunded"}'
echo "-- после: баланс $(sql "select \"balanceRub\" from \"Organization\" where id='$REFUND_ORG'"), возврат баллов: $(sql "select coalesce(max(amount || ' — ' || description),'нет') from \"BalanceTransaction\" where \"dedupeKey\"='order_release:$REFUND_ID'"), награда пригласившему $(sql "select count(*) from \"BalanceTransaction\" where kind='referral_reward' and \"referredOrganizationId\"='$REFUND_ORG'"), refundedAt $(sql "select coalesce(to_char(\"refundedAt\",'YYYY-MM-DD HH24:MI'),'—') from \"PaymentOrder\" where id=$REFUND_ID")"
req root POST "/api/root/orders/$REFUND_ID/resolve" '{"outcome":"refunded"}'
echo "-- баланс после повтора: $(sql "select \"balanceRub\" from \"Organization\" where id='$REFUND_ORG'")"
echo "-- кабинет: $(curl -s -b "$J/r5-ref-refund.jar" "$B/settings/subscription" | visible | grep -o "возвращён" | head -1)"
echo "-- ROOT: $(curl -s -b "$J/root.jar" "$B/root/organizations/$REFUND_ORG" | visible | grep -o "возвращён" | head -1)"

say "D7. Срок в следующем году — с годом в карточке «Мой кабинет»"
curl -s -b "$J/premium.jar" "$B/dashboard" -o "$OUT/dash.html"
echo "-- подписка аккаунта: $(acct premium@example.test)"
python3 - "$OUT/dash.html" <<'PY'
import re, sys
s = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r"(Премиум|Стандарт) до \d+ [а-я]+( \d{4})?", s)
print("    карточка:", m.group(0) if m else "не найдена")
PY

say "D8. Мини-приложение: плашка сотруднику на «Сегодня», пока руководитель решает"
curl -s -b "$J/r5-decision-cook.jar" "$B/mini/today" -o "$OUT/today.html" -w "    /mini/today: HTTP %{http_code}\n"
grep -q 'data-testid="billing-staff-notice"' "$OUT/today.html" && echo "    плашка: $(visible < "$OUT/today.html" | grep -o "Руководитель[^.]*\." | head -1)" || echo "    плашки нет — ОШИБКА"

rm -rf "$OUT"
