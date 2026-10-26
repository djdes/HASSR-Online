// Живая проверка после проверки 2 (L1): тройка «Помесячно ◯ За год» на одной строке, плашка скидки
// переносится отдельно, тумблер на линии счётчика точек (switchVsStepper — разница центров, px).
// Запуск (playwright из глобальной установки): [EMAIL=...] [PAGE=/pricing] [WIDTHS=640,700] node toggle-wrap-check.cjs
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const PATH = process.env.PAGE || "/pricing";
const WIDTHS = (process.env.WIDTHS || "640,660,680,700,720,768,800,900,1024").split(",").map(Number);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "Europe/Moscow", locale: "ru-RU" });
  const page = await ctx.newPage();
  if (process.env.EMAIL) {
    const { csrfToken } = await (await page.request.get(`${BASE}/api/auth/csrf`, { headers: { "X-Forwarded-For": process.env.XFF || "198.51.100.77" } })).json();
    await page.request.post(`${BASE}/api/auth/callback/credentials`, { form: { csrfToken, email: process.env.EMAIL, password: "TestPass123!", json: "true" }, headers: { "X-Forwarded-For": process.env.XFF || "198.51.100.77" } });
  }
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(BASE + PATH, { waitUntil: "networkidle", timeout: 180000 });
    await page.locator('[data-testid="tariff-controls"]').first().scrollIntoViewIfNeeded();
    const m = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const r = (el) => (el ? el.getBoundingClientRect() : null);
      const controls = r(q('[data-testid="tariff-controls"]'));
      const picker = r(q('[data-testid="tariff-points-picker"] > div'));
      const cycle = q('[data-testid="tariff-cycle"]');
      const month = r(q('[data-testid="tariff-cycle-month"]'));
      const sw = r(q('[data-testid="tariff-cycle-switch"]'));
      const year = r(q('[data-testid="tariff-cycle-year"]'));
      const badge = cycle ? r(cycle.lastElementChild) : null;
      const cols = getComputedStyle(q('[data-testid="tariff-controls"]')).gridTemplateColumns;
      const mid = (b) => (b ? Math.round((b.top + b.height / 2) * 10) / 10 : null);
      return {
        controlsW: Math.round(controls.width),
        cols,
        trioW: month && year ? Math.round(year.right - month.left) : null,
        trioOneLine: month && sw && year ? Math.abs(mid(month) - mid(year)) < 2 && Math.abs(mid(month) - mid(sw)) < 2 : null,
        badgeSameLine: badge && year ? Math.abs(mid(badge) - mid(year)) < 4 : null,
        switchVsStepper: sw && picker ? Math.round((mid(sw) - mid(picker)) * 10) / 10 : null,
        groupH: cycle ? Math.round(cycle.getBoundingClientRect().height) : null,
        labelW: month && year ? [Math.round(month.width), Math.round(sw.width), Math.round(year.width), Math.round(badge.width)] : null,
      };
    });
    console.log(width, JSON.stringify(m));
  }
  await browser.close();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
