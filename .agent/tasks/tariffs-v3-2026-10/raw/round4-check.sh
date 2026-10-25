#!/bin/bash
# Живая проверка исправлений после независимой проверки 4 (HTTP и браузер).
# Сначала round4-scenarios.ts (готовит аккаунты r4-*). Нужны: next dev на :3000,
# локальная БД, login.sh (пароль TestPass123!) в $JAR_DIR.
# Запуск: JAR_DIR=... DB=postgresql://... TOKEN=r4-held-token-... bash round4-check.sh > round4-check.txt
set -u
J="${JAR_DIR:?}"
DB="${DB:?}"
TOKEN="${TOKEN:?}"
ROOT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"
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
visible() { python3 -c 'import re,html,sys; s=re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>","",sys.stdin.read()); print(html.unescape(re.sub(r"<[^>]+>"," ",s)))'; }

for who in root r4-held premium; do bash "$J/login.sh" "$who@example.test" >/dev/null; done

HELD_ORG=$(sql "select \"organizationId\" from \"User\" where email='r4-held@example.test'")
HELD_ID=$(sql "select id from \"PaymentOrder\" where \"organizationId\"='$HELD_ORG' and status='paid' and \"heldAt\" is not null order by id desc limit 1")

say "D7/D10. Кабинет: оплата на разборе и просроченный счёт подписаны в истории"
page=$(curl -s -b "$J/r4-held.jar" "$B/settings/subscription" | visible)
echo "$page" | grep -o "оплачен — применим вручную" | head -1 | sed 's/^/    /'
echo "$page" | grep -o "счёт истёк" | head -1 | sed 's/^/    /'
echo "$page" | grep -q "ждёт оплаты по счёту" && echo "    просроченный счёт подписан «ждёт оплаты по счёту» — ОШИБКА" || true

say "D7. Возврат с оплаты: статус заказа и текст страницы /order для оплаты на разборе"
req - GET "/api/payments/robokassa/status?complete=$TOKEN"
(cd "$J" && TOKEN="$TOKEN" node - <<'JS'
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://localhost:3000/order?complete=${process.env.TOKEN}`, { waitUntil: "networkidle", timeout: 240000 });
  await page.waitForSelector("text=Оплату получили", { timeout: 60000 }).catch(() => null);
  const text = await page.locator("body").innerText();
  const line = text.split("\n").find((l) => l.includes("Оплату получили") || l.includes("Подписка вашей организации продлена"));
  console.log("    /order:", line ?? "текст не найден");
  await browser.close();
})();
JS
)

say "D5. ROOT: оплата на разборе — кнопки в карточке, «Тариф применён» снимает отметку"
echo "-- заказ №$HELD_ID: heldAt=$(sql "select coalesce(\"heldAt\"::text,'—') from \"PaymentOrder\" where id=$HELD_ID")"
(cd "$J" && ORG="$HELD_ORG" node - <<'JS'
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle", timeout: 240000 });
  await page.fill('input[autocomplete="email"]', "root@example.test");
  await page.fill('input[autocomplete="current-password"]', "TestPass123!");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 }), page.click('button[type="submit"]')]);
  await page.goto(`http://localhost:3000/root/organizations/${process.env.ORG}`, { waitUntil: "networkidle", timeout: 240000 });
  const status = await page.locator("text=оплачен — ждёт разбора").count();
  const applied = page.getByRole("button", { name: "Тариф применён" });
  const refunded = page.getByRole("button", { name: "Деньги возвращены" });
  console.log(`    статус «оплачен — ждёт разбора»: ${status > 0 ? "есть" : "нет"}; кнопки: «Тариф применён» ${await applied.count()}, «Деньги возвращены» ${await refunded.count()}`);
  await applied.first().click();
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/resolve") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Да, тариф применён" }).click(),
  ]);
  console.log("    POST resolve:", response.status(), response.request().postData());
  await page.waitForTimeout(1500);
  console.log(`    после: кнопок «Тариф применён» ${await page.getByRole("button", { name: "Тариф применён" }).count()}`);
  await browser.close();
})();
JS
)
echo "-- заказ №$HELD_ID: heldAt=$(sql "select coalesce(\"heldAt\"::text,'—') from \"PaymentOrder\" where id=$HELD_ID"); аудит: $(sql "select action || ' ' || (details->>'outcome') from \"AuditLog\" where action='billing.order-resolved' and \"entityId\"='$HELD_ID' order by \"createdAt\" desc limit 1")"
req root POST "/api/root/orders/$HELD_ID/resolve" '{"outcome":"applied"}'

say "D5. ROOT: «Деньги возвращены» — заказ помечен возвращённым, отметка снята"
REFUND_ID=$(sql "insert into \"PaymentOrder\" (email,\"tariffKey\",\"amountRub\",description,status,\"isTest\",\"organizationId\",points,\"changeKind\",\"paidAt\",\"heldAt\",\"basePlanJson\") values ('r4-held@example.test','premium_month',1000,'Тариф «Премиум» на месяц (доплата)','paid',false,'$HELD_ORG',1,'upgrade',now(),now(),'{\"current\":null}') returning id" | head -1)
req root POST "/api/root/orders/$REFUND_ID/resolve" '{"outcome":"refunded"}'
echo "-- заказ №$REFUND_ID: $(sql "select 'heldAt=' || coalesce(\"heldAt\"::text,'—') || ', refundedAt=' || coalesce(to_char(\"refundedAt\",'YYYY-MM-DD HH24:MI'),'—') from \"PaymentOrder\" where id=$REFUND_ID")"
req root POST "/api/root/orders/$REFUND_ID/resolve" '{"outcome":"bogus"}'
req premium POST "/api/root/orders/$REFUND_ID/resolve" '{"outcome":"applied"}'

say "D6. ROOT: дата при «Бесплатном» — отказ, а не тихая «Подписка (прежний тариф)»"
FREE_ORG=$(sql "select \"organizationId\" from \"User\" where email='r4-trial-free@example.test'")
echo "-- тариф аккаунта: $(sql "select a.\"subscriptionPlan\" || ', срок ' || coalesce(a.\"subscriptionEnd\"::text,'—') from \"Organization\" o join \"Account\" a on a.id=o.\"accountId\" where o.id='$FREE_ORG'")"
req root PATCH "/api/root/organizations/$FREE_ORG" '{"subscriptionEnd":"2026-12-01T00:00:00.000Z"}'
req root PATCH "/api/root/organizations/$FREE_ORG" '{"subscriptionPlan":"free","subscriptionEnd":"2026-12-01T00:00:00.000Z"}'
echo "-- тариф аккаунта после отказов: $(sql "select a.\"subscriptionPlan\" || ', срок ' || coalesce(a.\"subscriptionEnd\"::text,'—') from \"Organization\" o join \"Account\" a on a.id=o.\"accountId\" where o.id='$FREE_ORG'")"
req root PATCH "/api/root/organizations/$FREE_ORG" '{"subscriptionPlan":"standard","subscriptionEnd":"2026-12-01T00:00:00.000Z"}'
req root PATCH "/api/root/organizations/$FREE_ORG" '{"subscriptionPlan":"free"}'
echo "-- вернули на бесплатный: $(sql "select a.\"subscriptionPlan\" || ', срок ' || coalesce(a.\"subscriptionEnd\"::text,'—') from \"Organization\" o join \"Account\" a on a.id=o.\"accountId\" where o.id='$FREE_ORG'")"
hint=$(curl -s -b "$J/root.jar" "$B/root/organizations/$FREE_ORG" | visible | grep -o "Пусто — [^.]*\. У «Бесплатного» срок не задаётся" | head -1)
echo "    подсказка у поля срока: ${hint:-не найдена}"

say "D9. «Перейти на бесплатный» во время пробного (маршрут кабинета) заканчивает пробный период"
bash "$J/login.sh" r4-trial-api@example.test >/dev/null
API_ORG=$(sql "select \"organizationId\" from \"User\" where email='r4-trial-api@example.test'")
echo "-- до: trialEndsAt=$(sql "select coalesce(a.\"trialEndsAt\"::text,'— (по дате создания)') from \"Organization\" o join \"Account\" a on a.id=o.\"accountId\" where o.id='$API_ORG'")"
curl -s -b "$J/r4-trial-api.jar" "$B/api/settings/subscription/transition" > "$OUT/list.json"
KEEP=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(next(c["id"] for c in d["candidates"] if c.get("isSelf")))' "$OUT/list.json")
JOURNAL=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["journals"][0]["code"])' "$OUT/list.json")
echo "-- состояние из маршрута: $(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("kind"), "· кандидатов", len(d["candidates"]), "· журналов", len(d["journals"]))' "$OUT/list.json")"
req r4-trial-api POST /api/settings/subscription/transition "{\"keepUserId\":\"$KEEP\",\"keepJournalCode\":\"$JOURNAL\",\"voluntary\":true}"
echo "-- после: trialEndsAt=$(sql "select coalesce(to_char(a.\"trialEndsAt\",'YYYY-MM-DD HH24:MI'),'—') from \"Organization\" o join \"Account\" a on a.id=o.\"accountId\" where o.id='$API_ORG'"), тариф $(sql "select a.\"subscriptionPlan\" from \"Organization\" o join \"Account\" a on a.id=o.\"accountId\" where o.id='$API_ORG'")"
page=$(curl -s -b "$J/r4-trial-api.jar" "$B/settings/subscription" | visible)
echo "$page" | grep -q "Пробный период — по" && echo "    кабинет всё ещё пишет «Пробный период» — ОШИБКА" || echo "    кабинет: $(echo "$page" | tr -s ' \n' ' ' | grep -o "Ваш тариф Бесплатный Бесплатно: [^.]*\." | head -1) $(echo "$page" | tr -s ' \n' ' ' | grep -o "Сотрудники 1 из 1" | head -1)"

say "D3. Сотрудник оплачивает сам в последние сутки срока: расчёт и снимок — от подписки аккаунта"
bash "$J/login.sh" r4-last-day-cook@example.test >/dev/null
req r4-last-day-cook POST /api/payments/robokassa/create '{"plan":"standard","cycle":"month","points":1}'
LAST_ID=$(sql "select id from \"PaymentOrder\" where email='r4-last-day-cook@example.test' order by id desc limit 1")
echo "-- заказ №$LAST_ID (касса локально не настроена — заказ сохранён до 503): $(sql "select \"changeKind\" || ', ' || \"amountRub\" || ' ₽, снимок ' || \"basePlanJson\"::text from \"PaymentOrder\" where id=$LAST_ID")"
(cd "$ROOT_DIR" && DATABASE_URL="$DB" PLATFORM_ORG_ID=platform npx tsx --tsconfig tsconfig.json .agent/tasks/tariffs-v3-2026-10/raw/round4-pay.ts "$LAST_ID" 2>&1 | grep -v "^\[platform-admin\]")

rm -rf "$OUT"
