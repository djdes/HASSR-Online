// Снимки «до»: меню профиля сайта (1280 и 390) и профиль мини-приложения (360) на исходном коде.
// Запуск: node .agent/tasks/mini-theme-tiles-2026-09/e2e/before.cjs
const fs = require("node:fs");
const path = require("node:path");
const { EVID, RAW, launch, login, quietPage, gotoHydrated, readCreds } = require("./lib.cjs");

(async () => {
  fs.mkdirSync(EVID, { recursive: true });
  fs.mkdirSync(RAW, { recursive: true });
  const creds = readCreds();
  const out = { startedAt: new Date().toISOString(), facts: {}, pageErrors: [] };
  const browser = await launch();
  try {
    // Сайт, компьютер 1280: выпадающее меню профиля.
    const desk = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ru-RU", colorScheme: "light" });
    await login(desk, creds.owner, creds.password);
    const page = await quietPage(desk, "site-1280", out);
    await gotoHydrated(page, "/dashboard", 'button[aria-label="Профиль"]', out);
    await page.locator('button[aria-label="Профиль"]').click();
    const menu = page.locator('[data-slot="dropdown-menu-content"]');
    await menu.getByTestId("theme-tiles").waitFor({ timeout: 60000 });
    await page.waitForTimeout(500);
    await menu.screenshot({ path: path.join(EVID, "before-site-menu-1280.png"), animations: "disabled" });
    out.facts.site1280 = await menu.evaluate((root) => ({
      tiles: [...root.querySelectorAll("[data-theme-tile]")].map((el) => ({
        mode: el.getAttribute("data-theme-tile"),
        checked: el.getAttribute("aria-checked"),
        rect: (() => {
          const r = el.getBoundingClientRect();
          return [Math.round(r.width), Math.round(r.height)];
        })(),
        label: el.textContent.trim(),
        labelFont: getComputedStyle(el.lastElementChild).fontSize,
        frameBorder: getComputedStyle(el.firstElementChild).borderTopColor,
      })),
      html: root.querySelector('[data-testid="theme-tiles"]').outerHTML.length,
    }));

    // Сайт, телефон 390: лист профиля.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "ru-RU", colorScheme: "light" });
    await login(phone, creds.owner, creds.password);
    const p = await quietPage(phone, "site-390", out);
    await gotoHydrated(p, "/dashboard", 'button[aria-label="Профиль"]', out);
    await p.locator('button[aria-label="Профиль"]').click();
    const sheet = p.locator('[role="dialog"]').filter({ has: p.getByTestId("theme-tiles") });
    await sheet.waitFor({ timeout: 60000 });
    await p.waitForTimeout(800);
    await sheet.screenshot({ path: path.join(EVID, "before-site-sheet-390.png"), animations: "disabled" });
    out.facts.site390 = await sheet.evaluate((root) => ({
      tiles: [...root.querySelectorAll("[data-theme-tile]")].map((el) => {
        const r = el.getBoundingClientRect();
        return { mode: el.getAttribute("data-theme-tile"), w: Math.round(r.width), h: Math.round(r.height), labelFont: getComputedStyle(el.lastElementChild).fontSize };
      }),
    }));

    // Мини-приложение, телефон 360: профиль со старой переключалкой.
    const mini = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "ru-RU", colorScheme: "light" });
    await login(mini, creds.owner, creds.password);
    const m = await quietPage(mini, "mini-360", out);
    await gotoHydrated(m, "/mini/me", 'a[href="/settings/balance"]', out);
    await m.waitForTimeout(800);
    const seg = m.locator('[role="radiogroup"][aria-label="Тема Mini App"]');
    out.facts.mini360 = {
      oldSwitch: await seg.count(),
      oldSwitchText: (await seg.count()) ? (await seg.innerText()).replace(/\s+/g, " ").trim() : null,
      appearanceRow: await m.locator('a[href="/settings/appearance"]').count(),
      appearanceRowText: (await m.locator('a[href="/settings/appearance"]').count())
        ? (await m.locator('a[href="/settings/appearance"]').innerText()).replace(/\s+/g, " ").trim()
        : null,
      theme: await m.evaluate(() => document.getElementById("mini-root")?.getAttribute("data-theme")),
    };
    await seg.locator("xpath=ancestor::section[1]").screenshot({ path: path.join(EVID, "before-mini-theme-360.png"), animations: "disabled" });
    await m.screenshot({ path: path.join(EVID, "before-mini-me-360.png"), fullPage: true, animations: "disabled" });
  } finally {
    out.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(RAW, "before-facts.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
