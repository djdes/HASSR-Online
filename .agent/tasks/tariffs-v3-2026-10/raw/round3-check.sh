#!/bin/bash
# Живая проверка исправлений после независимой проверки 3 (HTTP и браузер).
# Сценарии оплаты — round3-scenarios.ts. Нужны: next dev на :3000, локальная БД,
# cookie-jar'ы <имя>.jar в $JAR_DIR (login.sh, пароль TestPass123!).
# Запуск: JAR_DIR=... DB=postgresql://... bash round3-check.sh > round3-check.txt
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

say "D4. ROOT: переименование организации не трогает срок аккаунта (форма шлёт только изменённое)"
P1=$(sql "select id from \"Organization\" where name='Кафе Премиум'")
acct_end() { sql "select to_char(a.\"subscriptionEnd\",'YYYY-MM-DD HH24:MI:SS') from \"Organization\" o join \"Account\" a on a.id=o.\"accountId\" where o.id='$P1'"; }
echo "-- срок аккаунта до: $(acct_end)"
(cd "$J" && P1="$P1" node - <<'JS'
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle", timeout: 240000 });
  await page.fill('input[autocomplete="email"]', "root@example.test");
  await page.fill('input[autocomplete="current-password"]', "TestPass123!");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 }), page.click('button[type="submit"]')]);
  await page.goto(`http://localhost:3000/root/organizations/${process.env.P1}`, { waitUntil: "networkidle", timeout: 240000 });
  // Ссылка на сам элемент: после ввода атрибут value меняется, и поиск по нему
  // поле уже не найдёт. Кнопка «Сохранить» — в той же сетке формы.
  const input = await page.locator('input[value="Кафе Премиум"]').first().elementHandle();
  await input.fill("Кафе Премиум (проверка)");
  const save = (await input.evaluateHandle((el) => el.closest("div.grid").querySelector("button"))).asElement();
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(`/api/root/organizations/${process.env.P1}`) && r.request().method() === "PATCH"),
    save.click(),
  ]);
  console.log("    PATCH:", response.status(), "тело запроса:", response.request().postData());
  await browser.close();
})();
JS
)
echo "-- срок аккаунта после: $(acct_end); имя: $(sql "select name from \"Organization\" where id='$P1'")"
req root PATCH "/api/root/organizations/$P1" '{"name":"Кафе Премиум"}' >/dev/null
echo "-- имя возвращено: $(sql "select name from \"Organization\" where id='$P1'")"

say "D6. Сотрудник не оплатит меньше точек, чем в работе"
echo "-- точек в работе у «Кафе Пробное»: $(sql "select count(*) from \"Building\" b join \"Organization\" o on o.id=b.\"organizationId\" where o.name='Кафе Пробное'")"
req v3-trial-cook POST /api/payments/robokassa/create '{"plan":"standard","cycle":"month","points":1}'

say "D8. Запланированный переход: дата с годом"
req premium POST /api/settings/subscription/schedule '{"plan":"standard","cycle":"year","points":3}'
req premium DELETE /api/settings/subscription/schedule

say "D3. Кабинет: просроченный счёт не держит карточку"
STD_ORG=$(sql "select id from \"Organization\" where name='Кафе Стандарт'")
sql "update \"PaymentOrder\" set \"invoiceDueAt\"=now() - interval '1 day' where \"organizationId\"='$STD_ORG' and status='pending' and \"paymentMethod\"='invoice'" >/dev/null
echo "-- открытых счетов (просрочены): $(sql "select count(*) from \"PaymentOrder\" where \"organizationId\"='$STD_ORG' and status='pending' and \"paymentMethod\"='invoice'")"
# Видимый текст страницы (без скриптов: в них лежит каталог переводов).
visible=$(curl -s -b "$J/standard.jar" "$B/settings/subscription" | python3 -c 'import re,html,sys; s=re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>","",sys.stdin.read()); print(html.unescape(re.sub(r"<[^>]+>"," ",s)))')
if echo "$visible" | grep -q "выставлен"; then
  echo "    карточка показывает «Счёт № … выставлен» — ОШИБКА"
else
  echo "    карточка не показывает просроченный счёт — можно выставить новый"
fi

rm -rf "$OUT"
