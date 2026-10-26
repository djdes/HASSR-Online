#!/bin/bash
# Живая проверка исправлений после независимой проверки 2 (problems.md, раздел 2).
# Нужны: next dev на :3000, локальная БД с тестовыми аккаунтами и cookie-jar'ы
# <имя>.jar в $JAR_DIR (login.sh, пароль TestPass123!). Устаревшие заказы —
# отдельный сценарий round2-stale-orders.ts.
# Запуск: JAR_DIR=... DB=postgresql://... bash round2-check.sh > round2-check.txt
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
  [ "$jar" != "-" ] && args+=(-b "$J/$jar.jar")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")
  local code
  code=$(curl "${args[@]}")
  echo "HTTP $code $(head -c 300 "$OUT/body" | tr '\n' ' ')"
}
sql() { psql "$DB" -At -c "$1"; }
page_lines() { # jar path regex
  curl -s ${1:+-b "$J/$1.jar"} "$B$2" | python3 -c '
import re,html,sys
pat=sys.argv[1]
s=sys.stdin.read()
s=re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>","",s)
t=html.unescape(re.sub(r"<[^>]+>","\n",s))
seen=set()
for l in [l.strip() for l in t.split("\n") if l.strip()]:
    if re.search(pat, l) and l not in seen:
        seen.add(l); print("   ", l[:220])
' "$3"
}

say "D8. Гость с почтой существующего аккаунта — один и тот же ответ, платит владелец или нет"
echo "-- почта бесплатного аккаунта:"
req - POST /api/payments/robokassa/create '{"email":"free@example.test","plan":"standard","cycle":"year","points":4}'
echo "-- почта оплаченного Премиума:"
req - POST /api/payments/robokassa/create '{"email":"premium@example.test","plan":"standard","cycle":"month","points":1}'
echo "-- новая почта — проверку проходит (503: касса локально не настроена):"
req - POST /api/payments/robokassa/create '{"email":"brand-new-client@example.test","plan":"standard","cycle":"month","points":1}'

say "D2. ROOT в «войти как» за клиента не платит"
cp "$J/root.jar" "$J/root-imp.jar"
STD_ORG=$(sql "select id from \"Organization\" where name='Кафе Стандарт'")
req root-imp POST /api/root/impersonate "{\"organizationId\":\"$STD_ORG\"}"
CSRF=$(curl -s -b "$J/root-imp.jar" -c "$J/root-imp.jar" "$B/api/auth/csrf" | python3 -c 'import sys,json;print(json.load(sys.stdin)["csrfToken"])')
curl -s -b "$J/root-imp.jar" -c "$J/root-imp.jar" -X POST "$B/api/auth/session" -H 'Content-Type: application/json' \
  -d "{\"csrfToken\":\"$CSRF\",\"data\":{\"actingAsOrganizationId\":\"$STD_ORG\"}}" -o /dev/null
echo "-- сессия: $(curl -s -b "$J/root-imp.jar" "$B/api/auth/session" | python3 -c 'import sys,json;u=json.load(sys.stdin)["user"];print("actingAs =", u.get("actingAsOrganizationId"))')"
echo "-- создание заказа:"
req root-imp POST /api/payments/robokassa/create '{"plan":"premium","cycle":"month","points":1}'
echo "-- страница /order:"
page_lines root-imp "/order?plan=premium&cycle=month&points=1" "не оформить|войти как"

say "D8. Счёт на другой тариф — новый, прежний открытый счёт закрывается"
sql "update \"Organization\" set inn='7712345678' where name='Кафе Стандарт'" >/dev/null
req standard POST /api/payments/invoice '{"plan":"premium","cycle":"month","points":1}'
first=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("orderId",""))' "$OUT/body")
req standard POST /api/payments/invoice '{"plan":"standard","cycle":"year","points":1}'
second=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("orderId",""))' "$OUT/body")
echo "-- статусы: №$first — $(sql "select status from \"PaymentOrder\" where id=${first:-0}"), №$second — $(sql "select status from \"PaymentOrder\" where id=${second:-0}")"
echo "-- повтор на тот же тариф возвращает тот же счёт:"
req standard POST /api/payments/invoice '{"plan":"standard","cycle":"year","points":1}'

say "D5. ROOT: правка организации сети меняет тариф всего аккаунта"
P1=$(sql "select id from \"Organization\" where name='Кафе Премиум'")
P2=$(sql "select id from \"Organization\" where name='Кафе Премиум — вторая точка'")
acct() { sql "select a.\"subscriptionPlan\"||' · '||coalesce(to_char(a.\"subscriptionEnd\",'YYYY-MM-DD'),'—')||' | орг1 '||o1.\"subscriptionPlan\"||' '||coalesce(to_char(o1.\"subscriptionEnd\",'YYYY-MM-DD'),'—')||' | орг2 '||o2.\"subscriptionPlan\"||' '||coalesce(to_char(o2.\"subscriptionEnd\",'YYYY-MM-DD'),'—') from \"Organization\" o1 join \"Account\" a on a.id=o1.\"accountId\" join \"Organization\" o2 on o2.id='$P2' where o1.id='$P1'"; }
echo "-- до: $(acct)"
req root PATCH "/api/root/organizations/$P2" '{"subscriptionPlan":"free"}'
echo "-- вторая точка → «Бесплатный»: $(acct)"
page_lines premium /settings/subscription "^(Бесплатный|Премиум|Подписка \(прежний|Пробный).{0,60}$"
req root PATCH "/api/root/organizations/$P1" '{"subscriptionPlan":"premium","subscriptionEnd":"2027-05-13T08:36:32.750Z","planCycle":"year","planPoints":3}'
echo "-- возврат на первой: $(acct)"
req root PATCH "/api/root/organizations/$P2" '{"subscriptionEnd":"2026-11-01T00:00:00.000Z"}'
echo "-- срок на второй точке → 01.11.2026: $(acct)"
req root PATCH "/api/root/organizations/$P1" '{"subscriptionEnd":"2027-05-13T08:36:32.750Z"}'
echo "-- срок обратно: $(acct)"
echo "-- /root: строка второй точки (тариф, точки):"
curl -s -b "$J/root.jar" "$B/root" | python3 -c '
import re,html,sys
s=sys.stdin.read()
for row in re.findall(r"<tr[\s\S]*?</tr>", s):
    if "вторая точка" in row:
        t=[x.strip() for x in html.unescape(re.sub(r"<[^>]+>","\n",row)).split("\n") if x.strip()]
        print("   ", " | ".join(t)[:260])
'

say "D6. Массовое добавление сверх лимита на Стандарте — текст и лимит тарифа"
STD_ORG=$(sql "select id from \"Organization\" where name='Кафе Стандарт'")
sql "insert into \"JobPosition\" (id, \"organizationId\", \"categoryKey\", name, \"updatedAt\") select 'jp-round2-cook', '$STD_ORG', 'staff', 'Повар', now() where not exists (select 1 from \"JobPosition\" where id='jp-round2-cook')" >/dev/null
RUN=$(date +%s)
rows=$(RUN=$RUN python3 -c 'import json,os; r=os.environ["RUN"]; print(json.dumps({"rows":[{"fullName":f"Повар Проверка {r}-{i}","positionName":"Повар"} for i in range(1,30)]}))')
req standard POST /api/staff/bulk "$rows" >/dev/null
python3 - "$OUT/body" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
b = d.get("billingLimit") or d.get("billing") or {}
errs = [e.get("message", "") for e in d.get("errors", []) if "тариф" in e.get("message", "").lower()]
print("    создано:", d.get("created"), "· заблокировано:", b.get("blocked"), "· limit:", b.get("limit"))
print("    итог:", (b.get("error") or "")[:160])
print("    строка:", (errs[0] if errs else "—")[:200])
PY
sql "update \"User\" set \"isActive\"=false, \"archivedAt\"=now() where name like 'Повар Проверка %' or name like 'Повар Тестовый %'" >/dev/null
echo "-- тестовые сотрудники отправлены в архив"

say "D7. /order: автосписание не предлагается при доплате; понижение — понятная дата"
echo "-- Стандарт → Премиум помесячно (доплата):"
page_lines standard "/order?plan=premium&cycle=month&points=1" "Доплата за повышение|автоматические списания"
echo "-- Премиум → Стандарт помесячно (понижение):"
page_lines premium "/order?plan=standard&cycle=month&points=3" "Переход на этот тариф"

say "AC7. Кабинет: «Перейти на год», даты с годом"
page_lines standard /settings/subscription "Повысить|Продлить"
echo "-- Стандарт помесячно, переключатель «За год» (браузер):"
(cd "$J" && node - <<'JS'
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle", timeout: 240000 });
  await page.fill('input[autocomplete="email"]', "standard@example.test");
  await page.fill('input[autocomplete="current-password"]', "TestPass123!");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 }), page.click('button[type="submit"]')]);
  await page.goto("http://localhost:3000/settings/subscription", { waitUntil: "networkidle", timeout: 240000 });
  await page.click('[data-testid="tariff-cycle-year"]');
  for (const tier of ["standard", "premium"]) {
    console.log(`    ${tier}: ${(await page.textContent(`[data-testid="tariff-cta-${tier}"]`))?.trim()}`);
  }
  await browser.close();
})();
JS
)
page_lines premium /settings/subscription "оплачен|до [0-9]+ [а-я]+ 20[0-9][0-9]"

say "D3. Публичные тексты"
page_lines - /journals-info/hygiene "без карты|бесплатн"
page_lines - /uslugi "закрывает сам сервис"

say "D4. /uz без ошибки гидратации"
# Из каталога вне репозитория: там предустановленный Playwright со своим Chromium.
(cd "$J" && node - <<'JS'
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error" && /hydrat/i.test(m.text())) problems.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => { if (/hydrat/i.test(String(e))) problems.push(String(e).slice(0, 160)); });
  await page.goto("http://localhost:3000/uz", { waitUntil: "networkidle", timeout: 180000 });
  await page.waitForTimeout(1500);
  console.log("    ошибок гидратации:", problems.length, problems.slice(0, 2).join(" | "));
  await browser.close();
})();
JS
)

rm -rf "$OUT" "$J/root-imp.jar"
