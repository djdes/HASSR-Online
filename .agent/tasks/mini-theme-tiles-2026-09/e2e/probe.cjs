// Быстрый взгляд на /mini/me 360×800: карточки темы в светлой и тёмной, замеры подписей.
// Запуск: node .agent/tasks/mini-theme-tiles-2026-09/e2e/probe.cjs
const fs = require("node:fs");
const path = require("node:path");
const { TASK, launch, login, quietPage, gotoHydrated, readCreds, contrast, sql } = require("./lib.cjs");

const OUT = path.join(process.env.E2E_OUT || TASK, "probe"); // вне проекта — см. lib.cjs, E2E_OUT

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const creds = readCreds();
  await sql('update "User" set "themePreference" = $1 where email = $2', ["light", creds.owner]);
  const browser = await launch();
  const out = { pageErrors: [] };
  try {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "ru-RU", colorScheme: "light" });
    await login(ctx, creds.owner, creds.password);
    const page = await quietPage(ctx, "probe", out);
    await gotoHydrated(page, "/mini/me", '[data-testid="theme-tile-light"]', out);
    await page.waitForTimeout(800);
    const measure = () =>
      page.evaluate(() => {
        const tiles = [...document.querySelectorAll("[data-theme-tile]")];
        const card = document.querySelector('[data-testid="mini-theme"]');
        return {
          theme: document.getElementById("mini-root").getAttribute("data-theme"),
          cardBg: getComputedStyle(card).backgroundColor,
          tiles: tiles.map((el) => {
            const r = el.getBoundingClientRect();
            const label = el.lastElementChild;
            const range = document.createRange();
            range.selectNodeContents(label);
            const lines = new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size;
            return {
              mode: el.getAttribute("data-theme-tile"),
              checked: el.getAttribute("aria-checked"),
              x: Math.round(r.x),
              y: Math.round(r.y),
              w: Math.round(r.width),
              h: Math.round(r.height),
              labelFont: getComputedStyle(label).fontSize,
              labelFamily: getComputedStyle(label).fontFamily.slice(0, 40),
              labelScroll: [label.scrollWidth, label.clientWidth],
              lines,
              frameBorder: getComputedStyle(el.firstElementChild).borderTopColor,
              labelColor: getComputedStyle(label).color,
            };
          }),
          docScroll: [document.documentElement.scrollWidth, window.innerWidth],
        };
      });
    out.light = await measure();
    const center = async () => {
      await page.locator('[data-testid="mini-theme"]').evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(300);
    };
    await center();
    await page.locator('[data-testid="mini-theme"]').screenshot({ path: path.join(OUT, "mini-light.png") });
    await page.getByTestId("theme-tile-dark").click();
    await page.waitForFunction(() => document.getElementById("mini-root").getAttribute("data-theme") === "dark");
    await page.waitForTimeout(500);
    out.dark = await measure();
    await center();
    await page.locator('[data-testid="mini-theme"]').screenshot({ path: path.join(OUT, "mini-dark.png") });
    // Телефон уже 360 — подпись переносится внутри слова, а не вылезает.
    await page.setViewportSize({ width: 320, height: 700 });
    await page.waitForTimeout(500);
    out.narrow320 = await measure();
    await center();
    await page.locator('[data-testid="mini-theme"]').screenshot({ path: path.join(OUT, "mini-dark-320.png") });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.screenshot({ path: path.join(OUT, "mini-dark-full.png"), fullPage: true });
    for (const t of ["light", "dark"]) {
      for (const tile of out[t].tiles) tile.labelContrast = contrast(tile.labelColor, out[t].cardBg);
      for (const tile of out[t].tiles) tile.frameContrast = contrast(tile.frameBorder, out[t].cardBg);
    }
  } finally {
    console.log(JSON.stringify(out, null, 1));
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
