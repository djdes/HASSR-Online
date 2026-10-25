#!/bin/bash
# Доводка после финальной проверки (все критерии PASS): срок счёта, страница
# заказа в последние сутки и за 0 ₽, карточка счёта на узбекском.
# Сначала round8-setup.ts. Нужны: next dev на :3000, локальная БД, login.sh в $JAR_DIR,
# Playwright (скрипты запускаются из $JAR_DIR).
# Запуск: JAR_DIR=... DB=postgresql://... bash round8-check.sh > round8-check.txt
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

for who in r8-lastday r8-uz r8-zero; do bash "$J/login.sh" "$who@example.test" >/dev/null; done

say "F1. /order в последние сутки срока: срок — после окончания текущего"
echo "-- подписка до (МСК): $(sql "select to_char((a.\"subscriptionEnd\" at time zone 'UTC') at time zone 'Europe/Moscow','DD.MM.YYYY HH24:MI') from \"User\" u join \"Organization\" o on o.id=u.\"organizationId\" join \"Account\" a on a.id=o.\"accountId\" where u.email='r8-lastday@example.test'")"
page=$(curl -s -b "$J/r8-lastday.jar" "$B/order?plan=standard&cycle=month&points=1" | visible)
echo "-- текст: $(echo "$page" | python3 -c 'import sys; t=sys.stdin.read(); i=t.find("Срок —"); print(t[i:t.find(".", i)+1] if i >= 0 else "не найден")')"
echo "$page" | grep -q "Без галочки оплата пройдёт разовым платежом" && echo "-- галочка автосписаний (сумма больше 0): есть" || echo "-- галочка автосписаний: НЕТ — ОШИБКА"

say "F2. /order за 0 ₽ (зачёт больше цены года): без галочки автосписаний"
page=$(curl -s -b "$J/r8-zero.jar" "$B/order?plan=standard&cycle=year&points=1" | visible)
echo "-- к оплате: $(echo "$page" | grep -o "К оплате [0-9  ]* ₽" | head -1)"
echo "$page" | grep -q "Без галочки оплата пройдёт разовым платежом" && echo "-- галочка автосписаний: есть — ОШИБКА" || echo "-- галочка автосписаний: нет"

say "F3. Карточка счёта на узбекском: одинаково на сервере и в браузере, без ошибки гидратации"
req r8-uz POST /api/payments/invoice '{"plan":"premium","cycle":"month","points":1}'
(cd "$J" && node - <<'JS'
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  for (const timezoneId of ["Asia/Tashkent", "Europe/Moscow"]) {
    const context = await browser.newContext({ timezoneId, locale: "uz-UZ" });
    const page = await context.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error" && /hydrat/i.test(m.text())) errors.push(m.text().slice(0, 80)); });
    page.on("pageerror", (e) => { if (/hydrat/i.test(String(e))) errors.push(String(e).slice(0, 80)); });
    await page.goto("http://localhost:3000/login", { waitUntil: "networkidle", timeout: 240000 });
    await page.fill('input[autocomplete="email"]', "r8-uz@example.test");
    await page.fill('input[autocomplete="current-password"]', "TestPass123!");
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 }), page.click('button[type="submit"]')]);
    await page.goto("http://localhost:3000/settings/subscription", { waitUntil: "networkidle", timeout: 240000 });
    await page.waitForTimeout(1500);
    const text = await page.locator("body").innerText();
    const line = text.split("\n").find((l) => /№\s*\d+/.test(l) && /₽/.test(l)) ?? "строка счёта не найдена";
    console.log(`    ${timezoneId}: «${line.slice(0, 140)}», ошибок гидратации: ${errors.length}`);
    await context.close();
  }
  await browser.close();
})();
JS
)

say "F4. Срок счёта на доплату (обычный случай): до конца последнего полного дня перед концом срока"
INV=$(sql "select id from \"PaymentOrder\" where email='r8-uz@example.test' and status='pending' order by id desc limit 1")
echo "-- срок подписки (МСК): $(sql "select to_char((a.\"subscriptionEnd\" at time zone 'UTC') at time zone 'Europe/Moscow','DD.MM.YYYY HH24:MI') from \"User\" u join \"Organization\" o on o.id=u.\"organizationId\" join \"Account\" a on a.id=o.\"accountId\" where u.email='r8-uz@example.test'"); счёт №$INV до (МСК): $(sql "select to_char((\"invoiceDueAt\" at time zone 'UTC') at time zone 'Europe/Moscow','DD.MM.YYYY HH24:MI:SS') from \"PaymentOrder\" where id=$INV")"
echo "-- остальные случаи (вечер, раннее утро, полдень) — тест src/lib/invoices/due.test.ts"

sql "update \"User\" set locale=null where email='r8-uz@example.test'" >/dev/null
rm -rf "$OUT"
