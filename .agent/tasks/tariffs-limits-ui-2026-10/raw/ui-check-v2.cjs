// Живая проверка витрины после проверки 1 (AC7, AC8): верх ВИДИМЫХ кнопок и цен, вылезание
// содержимого за карточку, центр выбора точек и зоны нажатия — на ширинах 640…1536 px,
// публично (день/ночь, ru/en/uz) и в кабинете. Нужны next dev на BASE_URL и локальная БД.
// Запуск (playwright из глобальной установки — скрипт копировать вне репозитория):
//   OUT_DIR=... CABINET_EMAILS=a@x,b@y node ui-check-v2.cjs
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.OUT_DIR || ".";
const CABINET = (process.env.CABINET_EMAILS || "").split(",").filter(Boolean);
const ZONES = ["Pacific/Honolulu", "America/Los_Angeles", "America/New_York", "UTC", "Europe/Moscow", "Asia/Dubai", "Asia/Kolkata", "Asia/Shanghai", "Asia/Tokyo", "Pacific/Auckland"];
const hourIn = (tz) => Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: tz }).format(new Date()));
const DAY_TZ = ZONES.find((tz) => hourIn(tz) >= 9 && hourIn(tz) < 17);
const NIGHT_TZ = ZONES.find((tz) => hourIn(tz) >= 21 || hourIn(tz) < 5);

async function measure(page) {
  return page.evaluate(() => {
    const tiers = ["free", "standard", "premium"];
    const box = (el) => (el ? el.getBoundingClientRect() : null);
    const cta = tiers.map((t) => document.querySelector(`[data-testid="tariff-action-${t}"]`)?.firstElementChild ?? null);
    const price = tiers.map((t) => document.querySelector(`[data-testid="tariff-price-${t}"]`));
    const spread = (els) => {
      const tops = els.map((el) => box(el)?.top ?? null);
      return tops.some((v) => v === null) ? null : Math.round((Math.max(...tops) - Math.min(...tops)) * 100) / 100;
    };
    // Вылезание: правый край любого потомка правее внутреннего края карточки.
    const overflow = tiers.map((t) => {
      const card = document.querySelector(`[data-testid="tariff-card-${t}"]`);
      if (!card) return null;
      const cb = card.getBoundingClientRect();
      const pr = parseFloat(getComputedStyle(card).paddingRight) || 0;
      let worst = 0;
      for (const el of card.querySelectorAll("*")) {
        if (el.closest(".pointer-events-none")) continue; // свечение выделенной карточки
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        worst = Math.max(worst, r.right - (cb.right - pr));
      }
      return Math.round(worst * 10) / 10;
    });
    const controls = box(document.querySelector('[data-testid="tariff-controls"]'));
    const picker = box(document.querySelector('[data-testid="tariff-points-picker"] > div'));
    const cycle = box(document.querySelector('[data-testid="tariff-cycle"]'));
    const size = (sel) => {
      const b = box(document.querySelector(sel));
      return b ? [Math.round(b.width), Math.round(b.height)] : null;
    };
    const targets = {
      switch: size('[data-testid="tariff-cycle-switch"]'),
      month: size('[data-testid="tariff-cycle-month"]'),
      year: size('[data-testid="tariff-cycle-year"]'),
      minus: size('[data-testid="tariff-points-dec"]'),
      plus: size('[data-testid="tariff-points-inc"]'),
    };
    const minTarget = Math.min(...Object.values(targets).filter(Boolean).flat());
    const ctaWidths = cta.map((el) => Math.round(box(el)?.width ?? 0));
    return {
      theme: document.body.getAttribute("data-app-theme") || document.querySelector(".app-shell")?.getAttribute("data-app-theme"),
      stacked: (() => {
        const a = box(document.querySelector('[data-testid="tariff-card-free"]'));
        const b = box(document.querySelector('[data-testid="tariff-card-standard"]'));
        return a && b ? b.top > a.bottom - 1 : null;
      })(),
      ctaSpread: spread(cta),
      priceSpread: spread(price),
      ctaWidths,
      overflow,
      pickerOffset: controls && picker ? Math.round((picker.left + picker.width / 2 - (controls.left + controls.width / 2)) * 10) / 10 : null,
      cycleRightGap: controls && cycle ? Math.round((controls.right - cycle.right) * 10) / 10 : null,
      cycleLines: cycle ? Math.round(cycle.height / 44) : null,
      minTarget,
      hScroll: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
}

async function open(browser, { path, tz, width, shot = null, label }) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: tz });
  const page = await ctx.newPage();
  const result = await check(page, { path, width, shot, label });
  await ctx.close();
  return result;
}

async function check(page, { path, width, shot = null, label }) {
  await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 180000 });
  if (!page.url().includes(path.split("?")[0])) {
    console.log(`FAIL ${label} ${path} ${width}px: открылось ${page.url()}`);
    return false;
  }
  await page.locator('[data-testid="tariff-comparison"]').first().scrollIntoViewIfNeeded();
  const m = await measure(page);
  if (shot) {
    const y = await page.locator('[data-testid="tariff-controls"]').evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    await page.evaluate((top) => window.scrollTo(0, top - 100), y);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${shot}` });
  }
  const lg = width >= 1024;
  const fail = [];
  if (lg && !(m.ctaSpread <= 1)) fail.push(`кнопки ${m.ctaSpread}`);
  if (lg && !(m.priceSpread <= 1)) fail.push(`цены ${m.priceSpread}`);
  if (m.overflow.some((v) => v > 0.5)) fail.push(`вылезает ${m.overflow.join("/")}`);
  if (width >= 640 && !(Math.abs(m.pickerOffset) <= 2)) fail.push(`точки ${m.pickerOffset}`);
  if (width >= 640 && !(m.cycleRightGap <= 1)) fail.push(`тумблер не у края ${m.cycleRightGap}`);
  if (m.minTarget < 44) fail.push(`зона ${m.minTarget}px`);
  if (m.hScroll) fail.push("горизонтальная прокрутка");
  console.log(
    `${fail.length ? "FAIL" : "ok  "} ${label} ${path} ${width}px ${m.theme}: кнопки ${m.ctaSpread} · цены ${m.priceSpread} · ширины ${m.ctaWidths.join("/")} · ` +
      `вылезание ${m.overflow.join("/")} · точки ${m.pickerOffset} · тумблер ${m.cycleRightGap} (${m.cycleLines} стр.) · мин. зона ${m.minTarget}` +
      (fail.length ? ` — ${fail.join("; ")}` : ""),
  );
  return fail.length === 0;
}

(async () => {
  const browser = await chromium.launch();
  let ok = true;
  for (const width of [640, 700, 768, 900, 1024, 1152, 1280, 1440, 1536]) {
    ok = (await open(browser, { label: "день", path: "/pricing", tz: DAY_TZ, width, shot: width === 768 ? "v2-controls-768.png" : width === 1024 ? "v2-pricing-1024.png" : null })) && ok;
  }
  for (const [path, tz] of [["/pricing", NIGHT_TZ], ["/", DAY_TZ], ["/en", DAY_TZ], ["/uz", NIGHT_TZ]]) {
    for (const width of [640, 1024, 1280]) {
      ok = (await open(browser, { label: tz === NIGHT_TZ ? "ночь" : "день", path, tz, width })) && ok;
    }
  }
  ok = (await open(browser, { label: "телефон", path: "/pricing", tz: NIGHT_TZ, width: 375, shot: "v2-pricing-375.png" })) && ok;
  // Кабинет: один вход на аккаунт (частые входы упираются в защиту от перебора),
  // ширины — сменой размера окна и перезагрузкой.
  for (const email of CABINET) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: DAY_TZ, extraHTTPHeaders: { "X-Forwarded-For": `198.51.100.${Math.floor(Math.random() * 250) + 1}` } });
    const page = await ctx.newPage();
    const { csrfToken } = await (await page.request.get(`${BASE}/api/auth/csrf`)).json();
    await page.request.post(`${BASE}/api/auth/callback/credentials`, { form: { csrfToken, email, password: "TestPass123!", json: "true" } });
    for (const width of [768, 1024, 1152, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      ok = (await check(page, { label: `кабинет ${email}`, path: "/settings/subscription", width, shot: width === 1024 ? `v2-cabinet-1024-${email.split("@")[0]}.png` : null })) && ok;
    }
    await ctx.close();
  }
  console.log(`\nИТОГ: ${ok ? "все замеры в норме" : "есть отклонения"}`);
  await browser.close();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
