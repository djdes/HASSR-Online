// Скриншоты витрины тарифов, кабинета и раздела ППК на локальной сборке.
// node shots.cjs <outDir>
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const results = [];

async function shot(page, name, opts = {}) {
  const file = path.join(OUT, `${name}.png`);
  if (opts.selector) {
    const el = await page.$(opts.selector);
    if (!el) throw new Error(`${name}: no ${opts.selector}`);
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(900);
    await el.screenshot({ path: file });
  } else {
    await page.screenshot({ path: file, fullPage: opts.fullPage !== false });
  }
  results.push({ name, file });
}

/** Баннер cookie не перекрывает скриншоты: согласие уже «дано». */
async function newContext(browser, options) {
  const context = await browser.newContext(options);
  await context.addInitScript(() => {
    try { window.localStorage.setItem("wesetup.cookie-consent", JSON.stringify({ at: Date.now(), accepted: true })); } catch {}
  });
  return context;
}

/** Секции лендинга проявляются при прокрутке — прокручиваем всю страницу. */
async function revealAll(page) {
  await page.evaluate(async () => {
    const step = Math.max(300, Math.floor(window.innerHeight * 0.6));
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(800);
}

async function visit(page, url, name) {
  const errors = [];
  page.removeAllListeners("pageerror");
  page.on("pageerror", (error) => errors.push(String(error)));
  const response = await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 180000 });
  const status = response ? response.status() : 0;
  results.push({ name: `${name}:status`, status, url, errors });
  if (status >= 400) throw new Error(`${url} → ${status}`);
  return errors;
}

async function login(context, email) {
  const page = await context.newPage();
  await page.goto(BASE + "/login", { waitUntil: "networkidle", timeout: 180000 });
  await page.fill('input[autocomplete="email"]', email);
  await page.fill('input[autocomplete="current-password"]', "TestPass123!");
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120000 }),
    page.click('button[type="submit"]'),
  ]);
  return page;
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const [label, viewport] of [["1280", { width: 1280, height: 900 }], ["390", { width: 390, height: 844 }]]) {
      const context = await newContext(browser, { viewport, locale: "ru-RU" });
      const page = await context.newPage();
      await visit(page, "/", `landing-${label}`);
      await revealAll(page);
      await shot(page, `landing-pricing-${label}`, { selector: "#pricing" });
      await visit(page, "/pricing", `pricing-${label}`);
      await shot(page, `pricing-page-${label}`);
      // Переключатель «Помесячно» и 3 точки — цены пересчитываются в браузере.
      await page.click('[data-testid="tariff-cycle-month"]');
      await page.click('[data-testid="tariff-points-inc"]');
      await page.click('[data-testid="tariff-points-inc"]');
      await shot(page, `pricing-month-3points-${label}`, { selector: '[data-testid="tariff-comparison"]' });
      results.push({
        name: `pricing-month-3points-${label}:texts`,
        standard: await page.textContent('[data-testid="tariff-card-standard"]'),
        premium: await page.textContent('[data-testid="tariff-card-premium"]'),
      });
      await context.close();
    }
    {
      const context = await newContext(browser, { viewport: { width: 1280, height: 900 }, locale: "en-GB" });
      const page = await context.newPage();
      await visit(page, "/en", "landing-en-1280");
      await revealAll(page);
      await shot(page, "landing-en-pricing-1280", { selector: "#pricing" });
      await context.close();
    }
    for (const account of ["trial", "standard", "premium"]) {
      for (const [label, viewport] of account === "trial"
        ? [["1280", { width: 1280, height: 900 }], ["390", { width: 390, height: 844 }]]
        : [["1280", { width: 1280, height: 900 }]]) {
        const context = await newContext(browser, { viewport, locale: "ru-RU" });
        const page = await login(context, `${account}@example.test`);
        await visit(page, "/settings/subscription", `subscription-${account}-${label}`);
        await shot(page, `subscription-${account}-${label}`);
        results.push({
          name: `subscription-${account}-${label}:status-text`,
          status: await page.textContent('[data-testid="subscription-status"]'),
          standardCta: await page.textContent('[data-testid="tariff-card-standard"]'),
          premiumCta: await page.textContent('[data-testid="tariff-card-premium"]'),
        });
        if (label === "1280") {
          await visit(page, "/production-control/documents/package", `package-${account}`);
          await shot(page, `package-${account}-1280`);
          await visit(page, "/production-control", `ppk-overview-${account}`);
          await shot(page, `ppk-overview-${account}-1280`, { selector: '[data-testid="ppk-individual-order"]' });
        }
        await context.close();
      }
    }
  } catch (error) {
    results.push({ name: "fatal", error: String(error && error.stack || error) });
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results.filter((r) => r.status !== undefined || r.error || r.errors), null, 2).slice(0, 6000));
  }
})();
