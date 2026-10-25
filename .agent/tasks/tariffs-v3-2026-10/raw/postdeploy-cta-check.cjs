// Послевыкаточная проверка: кнопка выделенной карточки «Стандарт» днём и ночью.
// Нужны: next dev на :3000 и локальная БД с платным «Стандартом» у CABINET_EMAIL
// (пароль TestPass123!). Скриншоты — в OUT_DIR.
// Запуск: OUT_DIR=... CABINET_EMAIL=... node postdeploy-cta-check.cjs
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.OUT_DIR || ".";
const CABINET_EMAIL = process.env.CABINET_EMAIL;

function rgb(str) {
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a = "1"] = m[1].split(/[ ,/]+/).filter(Boolean);
  return { r: +r, g: +g, b: +b, a: +a };
}
function lum({ r, g, b }) {
  const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return ((x + 0.05) / (y + 0.05)).toFixed(2);
}

async function inspect(page, label, shot) {
  const theme = await page.evaluate(() => document.body.getAttribute("data-app-theme") || document.querySelector(".app-shell")?.getAttribute("data-app-theme"));
  const read = (tier) =>
    page.evaluate((t) => {
      const card = document.querySelector(`[data-testid="tariff-card-${t}"]`);
      const cta = document.querySelector(`[data-testid="tariff-cta-${t}"]`);
      if (!card || !cta) return null;
      const c = getComputedStyle(cta);
      return { card: getComputedStyle(card).backgroundColor, bg: c.backgroundColor, color: c.color, text: cta.textContent.trim() };
    }, tier);
  console.log(`${label}: тема ${theme}`);
  for (const tier of ["standard", "premium"]) {
    const s = await read(tier);
    if (!s) { console.log(`  ${tier}: карточка или кнопка не найдена`); continue; }
    console.log(`  ${tier}: карточка ${s.card}; кнопка «${s.text}» ${s.bg}, текст ${s.color}; кнопка/карточка ${contrast(rgb(s.bg), rgb(s.card))}:1, текст/кнопка ${contrast(rgb(s.color), rgb(s.bg))}:1`);
  }
  const cta = page.locator('[data-testid="tariff-cta-standard"]').first();
  await cta.scrollIntoViewIfNeeded();
  await cta.hover();
  await page.waitForTimeout(300);
  console.log(`  standard при наведении: ${await cta.evaluate((el) => getComputedStyle(el).backgroundColor)}`);
  await page.mouse.move(0, 0);
  const box = await page.locator('[data-testid="tariff-card-standard"]').first().boundingBox();
  if (shot && box) {
    await page.screenshot({ path: `${OUT}/${shot}`, clip: { x: Math.max(0, box.x - 380), y: Math.max(0, box.y - 10), width: Math.min(1280, box.width * 3 + 120), height: 280 } });
  }
}

(async () => {
  const browser = await chromium.launch();
  for (const [name, tz] of [["day", "Asia/Kamchatka"], ["night", "Europe/Moscow"]]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: tz });
    const page = await ctx.newPage();
    for (const path of ["/pricing", "/"]) {
      await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 120000 });
      await inspect(page, `${path} ${name} (${tz})`, path === "/pricing" ? `postdeploy-cta-pricing-${name}.png` : null);
    }
    await ctx.close();
  }
  if (CABINET_EMAIL) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "Europe/Moscow" });
    await ctx.addCookies([{ name: "wesetup-theme", value: "dark", url: BASE }]);
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem("wesetup-theme-mode", "dark");
        localStorage.setItem("wesetup-theme-auto-schedule", "0");
        localStorage.setItem("wesetup-app-theme", "dark");
      } catch {}
    });
    const page = await ctx.newPage();
    const { csrfToken } = await (await page.request.get(`${BASE}/api/auth/csrf`)).json();
    const login = await page.request.post(`${BASE}/api/auth/callback/credentials`, {
      form: { csrfToken, email: CABINET_EMAIL, password: "TestPass123!", json: "true" },
    });
    console.log(`кабинет: вход ${login.status()}`);
    await page.goto(`${BASE}/settings/subscription`, { waitUntil: "networkidle", timeout: 120000 });
    await inspect(page, `/settings/subscription (тёмная тема, ${CABINET_EMAIL})`, "postdeploy-cta-cabinet-dark.png");
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
