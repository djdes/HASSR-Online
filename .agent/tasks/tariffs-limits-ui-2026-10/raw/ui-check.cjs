// Живая проверка витрины v2 (AC7, AC8, AC4): выравнивание цен и кнопок, ряд настроек,
// тумблер, размеры нажатия, телефон. Нужны: next dev на BASE_URL и локальная БД.
// Запуск (playwright из глобальной установки — скрипт копировать вне репозитория):
//   OUT_DIR=... BASE_URL=http://localhost:3000 CABINET_EMAIL=... node ui-check.cjs
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.OUT_DIR || ".";
const CABINET_EMAIL = process.env.CABINET_EMAIL || "";
const TIERS = ["free", "standard", "premium"];

// Публичная тема — по часам посетителя (7–19 — светлая): пояс подбираем так,
// чтобы «день» был днём, а «ночь» ночью при любом времени запуска.
const ZONES = ["Pacific/Honolulu", "America/Los_Angeles", "America/New_York", "UTC", "Europe/Moscow", "Asia/Dubai", "Asia/Kolkata", "Asia/Shanghai", "Asia/Tokyo", "Pacific/Auckland"];
const hourIn = (tz) => Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: tz }).format(new Date()));
const DAY_TZ = ZONES.find((tz) => hourIn(tz) >= 9 && hourIn(tz) < 17);
const NIGHT_TZ = ZONES.find((tz) => hourIn(tz) >= 21 || hourIn(tz) < 5);

async function measure(page) {
  return page.evaluate((tiers) => {
    const box = (el) => (el ? el.getBoundingClientRect() : null);
    const tops = (prefix) => tiers.map((t) => box(document.querySelector(`[data-testid="${prefix}-${t}"]`))?.top ?? null);
    const spread = (values) => (values.some((v) => v === null) ? null : Math.max(...values) - Math.min(...values));
    const controls = box(document.querySelector('[data-testid="tariff-controls"]'));
    const picker = box(document.querySelector('[data-testid="tariff-points-picker"] > div'));
    const cycle = box(document.querySelector('[data-testid="tariff-cycle"]'));
    const sw = document.querySelector('[data-testid="tariff-cycle-switch"]');
    const size = (sel) => {
      const b = box(document.querySelector(sel));
      return b ? `${Math.round(b.width)}×${Math.round(b.height)}` : "—";
    };
    const priceTops = tops("tariff-price");
    const actionTops = tops("tariff-action");
    return {
      theme: document.body.getAttribute("data-app-theme") || document.querySelector(".app-shell")?.getAttribute("data-app-theme"),
      priceSpread: spread(priceTops),
      actionSpread: spread(actionTops),
      actionTops: actionTops.map((v) => (v === null ? null : Math.round(v))),
      pickerCenterOffset: controls && picker ? Math.round((picker.left + picker.width / 2 - (controls.left + controls.width / 2)) * 10) / 10 : null,
      cycleRightGap: controls && cycle ? Math.round((controls.right - cycle.right) * 10) / 10 : null,
      switchChecked: sw?.getAttribute("aria-checked") ?? null,
      switchRole: sw?.getAttribute("role") ?? null,
      targets: {
        switch: size('[data-testid="tariff-cycle-switch"]'),
        month: size('[data-testid="tariff-cycle-month"]'),
        year: size('[data-testid="tariff-cycle-year"]'),
        minus: size('[data-testid="tariff-points-dec"]'),
        plus: size('[data-testid="tariff-points-inc"]'),
      },
      hint: document.querySelector('[data-testid="tariff-points-hint"]')?.textContent?.trim() ?? null,
      premiumContact: Boolean(document.querySelector('[data-testid="tariff-premium-contact"]')),
      horizontalScroll: document.documentElement.scrollWidth > window.innerWidth,
    };
  }, TIERS);
}

async function standardPrice(page) {
  return page.locator('[data-testid="tariff-price-standard"]').first().innerText().then((t) => t.replace(/\s+/g, " ").trim());
}

async function scenario(browser, { label, path, tz, width = 1280, cookies = [], init = null, login = null, shot = null }) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: tz });
  if (cookies.length) await ctx.addCookies(cookies.map((c) => ({ ...c, url: BASE })));
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  if (login) {
    const { csrfToken } = await (await page.request.get(`${BASE}/api/auth/csrf`)).json();
    const res = await page.request.post(`${BASE}/api/auth/callback/credentials`, {
      form: { csrfToken, email: login, password: "TestPass123!", json: "true" },
    });
    if (res.status() !== 200) console.log(`  вход ${login}: ${res.status()}`);
  }
  await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 180000 });
  const comparison = page.locator('[data-testid="tariff-comparison"]').first();
  await comparison.scrollIntoViewIfNeeded();
  const m = await measure(page);
  console.log(`\n=== ${label} (${path}, ${width}px, ${tz})`);
  console.log(`  тема: ${m.theme}; разброс верха цен: ${m.priceSpread?.toFixed(2)} px; кнопок: ${m.actionSpread?.toFixed(2)} px (${m.actionTops.join(" / ")})`);
  console.log(`  точки: смещение от центра ряда ${m.pickerCenterOffset} px; тумблер: до правого края ${m.cycleRightGap} px, role=${m.switchRole}, aria-checked=${m.switchChecked}`);
  console.log(`  зоны нажатия: тумблер ${m.targets.switch}, «Помесячно» ${m.targets.month}, «За год» ${m.targets.year}, − ${m.targets.minus}, + ${m.targets.plus}`);
  console.log(`  пояснение: «${m.hint}»; ссылка «связаться» у «Премиума»: ${m.premiumContact ? "есть" : "нет"}; горизонтальная прокрутка: ${m.horizontalScroll ? "ЕСТЬ" : "нет"}`);
  if (shot) {
    const box = await comparison.boundingBox();
    if (box) await page.screenshot({ path: `${OUT}/${shot}`, clip: { x: 0, y: Math.max(0, box.y - 20), width, height: Math.min(1400, box.height + 40) }, fullPage: true });
  }
  return { ctx, page, m };
}

(async () => {
  const browser = await chromium.launch();
  const results = [];

  // Публичная витрина: /pricing днём и ночью, лендинг ru/en/uz.
  for (const [label, path, tz, shot] of [
    ["/pricing днём", "/pricing", DAY_TZ, "ui-pricing-day.png"],
    ["/pricing ночью", "/pricing", NIGHT_TZ, "ui-pricing-night.png"],
    ["лендинг ru", "/", DAY_TZ, null],
    ["лендинг en", "/en", DAY_TZ, "ui-landing-en.png"],
    ["лендинг uz", "/uz", NIGHT_TZ, "ui-landing-uz-night.png"],
  ]) {
    const { ctx, m } = await scenario(browser, { label, path, tz, shot });
    results.push({ label, ...m });
    await ctx.close();
  }

  // Тумблер: клик, клавиша Space, подпись «Помесячно».
  {
    const { ctx, page } = await scenario(browser, { label: "/pricing — тумблер", path: "/pricing", tz: DAY_TZ });
    const sw = page.locator('[data-testid="tariff-cycle-switch"]');
    const yearPrice = await standardPrice(page);
    await sw.click();
    const afterClick = { checked: await sw.getAttribute("aria-checked"), price: await standardPrice(page) };
    await sw.focus();
    await page.keyboard.press("Space");
    const afterSpace = { checked: await sw.getAttribute("aria-checked"), price: await standardPrice(page) };
    await page.locator('[data-testid="tariff-cycle-month"]').click();
    const afterLabel = { checked: await sw.getAttribute("aria-checked"), price: await standardPrice(page) };
    const m = await measure(page);
    console.log(`  за год: «${yearPrice}»; клик → aria-checked=${afterClick.checked}, «${afterClick.price}»; Space → ${afterSpace.checked}, «${afterSpace.price}»; «Помесячно» → ${afterLabel.checked}, «${afterLabel.price}»`);
    console.log(`  после переключения разброс кнопок: ${m.actionSpread?.toFixed(2)} px`);
    await ctx.close();
  }

  // Телефон: карточки столбиком, без горизонтальной прокрутки.
  {
    const { ctx, m } = await scenario(browser, { label: "/pricing на телефоне", path: "/pricing", tz: NIGHT_TZ, width: 375, shot: "ui-pricing-375.png" });
    results.push({ label: "375", ...m });
    await ctx.close();
  }

  // Кабинет: светлая и тёмная тема.
  if (CABINET_EMAIL) {
    const dark = () => {
      try {
        localStorage.setItem("wesetup-theme-mode", "dark");
        localStorage.setItem("wesetup-theme-auto-schedule", "0");
        localStorage.setItem("wesetup-app-theme", "dark");
      } catch {}
    };
    for (const [label, cookies, init, shot] of [
      ["кабинет, светлая", [{ name: "wesetup-theme", value: "light" }], null, "ui-cabinet-light.png"],
      ["кабинет, тёмная", [{ name: "wesetup-theme", value: "dark" }], dark, "ui-cabinet-dark.png"],
    ]) {
      const { ctx, m } = await scenario(browser, { label, path: "/settings/subscription", tz: DAY_TZ, cookies, init, login: CABINET_EMAIL, shot });
      results.push({ label, ...m });
      await ctx.close();
    }
  }

  const desktop = results.filter((r) => r.label !== "375");
  const worst = Math.max(...desktop.map((r) => Math.max(r.priceSpread ?? 99, r.actionSpread ?? 99)));
  const worstCenter = Math.max(...desktop.map((r) => Math.abs(r.pickerCenterOffset ?? 99)));
  console.log(`\nИТОГ: наибольший разброс цен/кнопок на 1280 px — ${worst.toFixed(2)} px (норма ≤ 1); наибольшее смещение точек от центра — ${worstCenter} px (норма ≤ 2)`);
  await browser.close();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
