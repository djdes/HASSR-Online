#!/bin/bash
# Доводка после независимой проверки 7 (все критерии PASS; LOW-находки).
# Сначала round7-setup.ts. Нужны: next dev на :3000, локальная БД, login.sh в $JAR_DIR,
# pdftotext, Playwright (скрипты запускаются из $JAR_DIR).
# Запуск: JAR_DIR=... DB=postgresql://... bash round7-check.sh > round7-check.txt
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
msk() { sql "select to_char(($1 at time zone 'UTC') at time zone 'Europe/Moscow','DD.MM.YYYY HH24:MI:SS') from $2"; }

for who in r7-tz r7-switch r7-short r7-zero; do bash "$J/login.sh" "$who@example.test" >/dev/null; done

say "L1. Срок счёта в кабинете — по Москве в любом часовом поясе браузера, без ошибки гидратации"
req r7-tz POST /api/payments/invoice '{"plan":"premium","cycle":"month","points":1}'
TZ_INV=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["orderId"])' "$OUT/body")
echo "-- счёт №$TZ_INV действует до (МСК): $(msk '"invoiceDueAt"' "\"PaymentOrder\" where id=$TZ_INV")"
(cd "$J" && node - <<'JS'
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  for (const timezoneId of ["Europe/Moscow", "Asia/Yekaterinburg", "Asia/Novosibirsk", "Asia/Tashkent"]) {
    const context = await browser.newContext({ timezoneId });
    const page = await context.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error" && /hydrat/i.test(m.text())) errors.push(m.text().slice(0, 80)); });
    page.on("pageerror", (e) => { if (/hydrat/i.test(String(e))) errors.push(String(e).slice(0, 80)); });
    await page.goto("http://localhost:3000/login", { waitUntil: "networkidle", timeout: 240000 });
    await page.fill('input[autocomplete="email"]', "r7-tz@example.test");
    await page.fill('input[autocomplete="current-password"]', "TestPass123!");
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 }), page.click('button[type="submit"]')]);
    await page.goto("http://localhost:3000/settings/subscription", { waitUntil: "networkidle", timeout: 240000 });
    await page.waitForTimeout(1500);
    const text = await page.locator("body").innerText();
    const m = text.match(/действителен до (\S+)/);
    console.log(`    ${timezoneId}: «действителен до ${m ? m[1].replace(/\.$/, "") : "?"}», ошибок гидратации: ${errors.length}`);
    await context.close();
  }
  await browser.close();
})();
JS
)

say "L2. Счёт на переход на год: в PDF — конец из расчёта, а не «365 дн. с даты оплаты»"
req r7-switch POST /api/payments/invoice '{"plan":"standard","cycle":"year","points":1}'
SW_INV=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["orderId"])' "$OUT/body")
echo "-- заказ №$SW_INV: $(sql "select \"changeKind\" || ', зачтено ' || \"creditRub\" || ' ₽' from \"PaymentOrder\" where id=$SW_INV"), конец по расчёту (МСК): $(msk '"periodEndsAt"' "\"PaymentOrder\" where id=$SW_INV")"
curl -s -b "$J/r7-switch.jar" "$B/api/payments/invoice/$SW_INV/pdf" -o "$OUT/switch.pdf"
echo "-- PDF: $(pdftotext "$OUT/switch.pdf" - 2>/dev/null | tr '\n' ' ' | grep -o "тариф «[^»]*» до [0-9.]* (переход с зачётом остатка текущего срока)" | head -1)"

say "L3. Счёт на доплату, когда до последнего полного дня перед концом срока меньше суток"
echo "-- конец подписки (МСК): $(msk 'a."subscriptionEnd"' "\"User\" u join \"Organization\" o on o.id=u.\"organizationId\" join \"Account\" a on a.id=o.\"accountId\" where u.email='r7-short@example.test'")"
req r7-short POST /api/payments/invoice '{"plan":"premium","cycle":"month","points":1}'
SH_INV=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["orderId"])' "$OUT/body")
echo "-- счёт №$SH_INV действует до (МСК): $(msk '"invoiceDueAt"' "\"PaymentOrder\" where id=$SH_INV"); часов до срока: $(sql "select round(extract(epoch from (\"invoiceDueAt\" - (now() at time zone 'UTC')))/3600) from \"PaymentOrder\" where id=$SH_INV")"

say "L4. Зачёт больше цены года — счёт не нужен, понятный отказ"
req r7-zero POST /api/payments/invoice '{"plan":"standard","cycle":"year","points":1}'

rm -rf "$OUT"
