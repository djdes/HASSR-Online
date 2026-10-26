// Живая проверка после проверки 2 (NIT): когда плашка в шапке карточки («Текущий») переносится,
// названия трёх тарифов стоят на одной высоте (шапки прижаты к верху строки сетки).
// Запуск (playwright из глобальной установки): EMAIL=v5-ref@example.test node header-align-check.cjs
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:3000";
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 900 }, locale: "ru-RU", extraHTTPHeaders: { "X-Forwarded-For": `198.51.100.${Math.floor(Math.random() * 200) + 20}` } });
  const page = await ctx.newPage();
  const { csrfToken } = await (await page.request.get(`${BASE}/api/auth/csrf`)).json();
  await page.request.post(`${BASE}/api/auth/callback/credentials`, { form: { csrfToken, email: process.env.EMAIL, password: "TestPass123!", json: "true" } });
  let ok = true;
  for (const width of [1024, 1100, 1152, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/settings/subscription`, { waitUntil: "networkidle", timeout: 180000 });
    const m = await page.evaluate(() =>
      ["free", "standard", "premium"].map((t) => {
        const card = document.querySelector(`[data-testid="tariff-card-${t}"]`);
        const head = card?.querySelector(":scope > div.relative.flex");
        const name = head?.querySelector(":scope > div.min-w-0");
        const icon = head?.firstElementChild;
        const lines = head ? Math.round(head.getBoundingClientRect().height) : null;
        return { name: name ? Math.round(name.getBoundingClientRect().top * 10) / 10 : null, icon: icon ? Math.round(icon.getBoundingClientRect().top * 10) / 10 : null, head: lines };
      }),
    );
    const spread = (k) => Math.round((Math.max(...m.map((x) => x[k])) - Math.min(...m.map((x) => x[k]))) * 10) / 10;
    const good = spread("name") <= 1 && spread("icon") <= 1;
    ok = ok && good;
    console.log(`${good ? "ok  " : "FAIL"} ${width}px: верх названий — разброс ${spread("name")} px, иконок — ${spread("icon")} px; высота шапок ${m.map((x) => x.head).join("/")}`);
  }
  console.log(`\nИТОГ: ${ok ? "названия на одной высоте" : "есть отклонения"}`);
  await browser.close();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
