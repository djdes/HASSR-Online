#!/bin/bash
# Живая проверка исправлений после первой независимой проверки (problems.md).
# Нужны: next dev на :3000, локальная БД с тестовыми аккаунтами
# (make-test-accounts.ts) и cookie-jar'ы <имя>.jar в $JAR_DIR (вход TestPass123!).
# Запуск: JAR_DIR=... DB=postgresql://... bash round1-check.sh > round1-check.txt
set -u
J="${JAR_DIR:?}"
DB="${DB:?}"
B=http://localhost:3000
OUT="$(mktemp -d)"
# Лимит создания заказов — 10 за 10 минут на IP: повторные прогоны идут
# со своего тестового адреса (TEST-NET-3), чтобы не упираться в 429.
XFF="203.0.113.$((RANDOM % 250 + 1))"

say() { echo; echo "=== $*"; }
# req <jar|-> <method> <path> [json] — код ответа и начало тела.
req() {
  local jar="$1" method="$2" path="$3" body="${4:-}"
  local args=(-s -o "$OUT/body" -w "%{http_code}" -X "$method" "$B$path" -H "X-Forwarded-For: $XFF")
  [ "$jar" != "-" ] && args+=(-b "$J/$jar.jar")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")
  local code
  code=$(curl "${args[@]}")
  echo "HTTP $code $(head -c 260 "$OUT/body" | tr '\n' ' ')"
}
sql() { psql "$DB" -At -c "$1"; }

say "D1. Оплата без кабинета на почту с оплаченным сроком — отказ, а не новая подписка"
echo "-- гость, почта Премиума (оплачен до 13.05.2027), «Стандарт» помесячно:"
req - POST /api/payments/robokassa/create '{"email":"premium@example.test","plan":"standard","cycle":"month","points":1}'
echo "-- гость, почта Стандарта (помесячно, оплачен до 09.11.2026), тот же тариф:"
req - POST /api/payments/robokassa/create '{"email":"standard@example.test","plan":"standard","cycle":"month","points":1}'
echo "-- гость, почта бесплатного аккаунта (оплаченного срока нет) — проверку проходит (503 дальше: касса локально не настроена):"
req - POST /api/payments/robokassa/create '{"email":"free@example.test","plan":"standard","cycle":"year","points":4}'
echo "-- гость, новая почта (новый клиент) — проверку проходит (503 — касса не настроена):"
req - POST /api/payments/robokassa/create '{"email":"new-client@example.test","plan":"premium","cycle":"month","points":1}'
echo "-- руководитель Премиума из кабинета — продление считается как раньше (503 — касса не настроена):"
req premium POST /api/payments/robokassa/create '{"plan":"premium","cycle":"year","points":3}'

echo "-- сотрудник оплаченной организации (premium-staff@, повар) открывает /order — отказ сразу на странице:"
curl -s -b "$J/premium-staff.jar" "$B/order?plan=standard&cycle=year" | python3 -c '
import re,html,sys
s=sys.stdin.read()
s=re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>","",s)
t=html.unescape(re.sub(r"<[^>]+>","\n",s))
for l in [l.strip() for l in t.split("\n") if l.strip()]:
    if re.search(r"не оформить|У этой почты", l): print("   ", l[:240])
'

say "D2. Анкета не заводит точек сверх оплаченных"
echo "-- зданий у «Кафе Стандарт» до: $(sql "select count(*) from \"Building\" b join \"Organization\" o on o.id=b.\"organizationId\" where o.name='Кафе Стандарт'")"
req standard POST /api/profile/complete '{"organizationName":"Кафе Стандарт","phone":"+79990000001","locationsCount":3,"asEmployee":false}'
echo "-- зданий после: $(sql "select count(*) from \"Building\" b join \"Organization\" o on o.id=b.\"organizationId\" where o.name='Кафе Стандарт'")"

say "D3. Приказ PDF: реквизиты организации — только с типовым пакетом"
for who in standard premium; do
  curl -s -b "$J/$who.jar" "$B/api/orders/haccp-responsible/pdf" -o "$OUT/$who.pdf"
  org=$(sql "select o.name from \"User\" u join \"Organization\" o on o.id=u.\"organizationId\" where u.email='$who@example.test'")
  if pdftotext "$OUT/$who.pdf" - 2>/dev/null | grep -q "$org"; then has="есть"; else has="нет"; fi
  echo "-- $who: $(stat -c %s "$OUT/$who.pdf") байт, название «$org» в PDF: $has"
done

say "D6. Страница заказа: даты с годом, автосписание по периоду"
fetch_text() { curl -s -b "$J/$1.jar" "$B$2" | python3 -c '
import re,html,sys
s=sys.stdin.read()
s=re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>","",s)
t=html.unescape(re.sub(r"<[^>]+>","\n",s))
lines=[l.strip() for l in t.split("\n") if l.strip()]
for l in lines:
    if re.search(r"Продление|Новый срок|Срок —|Доплата|Списание раз в|У этой почты", l): print("   ", l[:240])
'; }
echo "-- Премиум, продление за год (3 точки):"; fetch_text premium "/order?plan=premium&cycle=year&points=3"
echo "-- Стандарт помесячно → за год:"; fetch_text standard "/order?plan=standard&cycle=year&points=1"
echo "-- Стандарт помесячно → Премиум помесячно (доплата):"; fetch_text standard "/order?plan=premium&cycle=month&points=1"


say "D9. ROOT: длина пробного — только для чтения"
curl -s -b "$J/root.jar" "$B/root/tariffs" | grep -o '<input[^>]*data-testid="billing-trial-days"[^>]*>' | head -1
echo "-- PUT текущих настроек с trialDays=30 — длина остаётся 14:"
body=$(curl -s -b "$J/root.jar" "$B/api/root/billing-period" | python3 -c 'import sys,json; s=json.load(sys.stdin)["settings"]; s["trialDays"]=30; print(json.dumps(s))')
req root PUT /api/root/billing-period "$body"

# --- Дополнение (после перезапуска среды): счёт и MRR на данных, которых не было
# в первом прогоне. Реквизиты исполнителя и ИНН покупателя — локально
# (raw/set-requisites.ts), вторая организация Премиума — через API.
say "D9. Счёт: сумма сверяется с показанной (реквизиты заданы)"
# Анкета выше пишет ИНН из формы (пустой — null): возвращаем ИНН покупателя.
sql "update \"Organization\" set inn='7712345678' where name='Кафе Стандарт'" >/dev/null
# Повторный прогон: открытый счёт вернулся бы без пересчёта — закрываем прежние.
sql "update \"PaymentOrder\" set status='cancelled' where status='pending' and \"paymentMethod\"='invoice'" >/dev/null
echo "-- показана неверная сумма (1 ₽) — 409 и сумма сервера:"
req standard POST /api/payments/invoice '{"plan":"premium","cycle":"month","points":1,"expectedGrossRub":1}'
gross=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("grossRub",""))' "$OUT/body")
echo "-- повтор с суммой сервера ($gross ₽) — счёт выставлен:"
req standard POST /api/payments/invoice "{\"plan\":\"premium\",\"cycle\":\"month\",\"points\":1,\"expectedGrossRub\":$gross}"
inv=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("orderId",""))' "$OUT/body")
if [ -n "$inv" ]; then
  curl -s -b "$J/standard.jar" "$B/api/payments/invoice/$inv/pdf" -o "$OUT/inv.pdf"
  echo "-- строка счёта: $(pdftotext -layout "$OUT/inv.pdf" - 2>/dev/null | grep -o 'доплата за повышение[^|]*' | head -1 | tr -s ' ')"
fi

say "D8. ROOT: MRR аккаунта с двумя организациями считается один раз"
if [ "$(sql "select count(*) from \"Organization\" where name='Кафе Премиум — вторая точка'")" = "0" ]; then
  req premium POST /api/organizations '{"name":"Кафе Премиум — вторая точка","sphere":"restaurant"}'
fi
echo "-- организаций в аккаунте Премиума: $(sql "select count(*) from \"Organization\" where \"accountId\"=(select o.\"accountId\" from \"User\" u join \"Organization\" o on o.id=u.\"organizationId\" where u.email='premium@example.test')")"
curl -s -b "$J/root.jar" "$B/root" -o "$OUT/root.html" -w "-- /root HTTP %{http_code}\n"
python3 - "$OUT/root.html" <<'PY'
import re, html, sys
s = open(sys.argv[1], encoding="utf-8").read()
s = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", "", s)
t = html.unescape(re.sub(r"<[^>]+>", "\n", s))
lines = [l.strip() for l in t.split("\n") if l.strip()]
for i, l in enumerate(lines):
    if l == "MRR":
        print("    плитка MRR:", " | ".join(lines[i + 1:i + 3])[:200])
        break
PY
echo "-- ожидание: Премиум 3 точки за год (11 372 ₽/мес) один раз + Стандарт помесячно (3 000 ₽) = 14 372 ₽"
rm -rf "$OUT"
