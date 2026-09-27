// Разметка карточек темы на сайте — для сравнения до/после выноса презентационной части.
// Запуск: node .agent/tasks/mini-theme-tiles-2026-09/e2e/site-markup.cjs before|after
// Пишет raw/site-markup-<этап>.json: outerHTML блока карточек (меню 1280, лист 390, «Внешний вид» 1280)
// без сгенерированных Radix/React id.
const fs = require("node:fs");
const path = require("node:path");
const { RAW, launch, login, quietPage, gotoHydrated, readCreds, sql } = require("./lib.cjs");

const stage = process.argv[2] || "after";

function normalize(html) {
  return html
    .replace(/ (id|aria-controls|aria-labelledby|aria-describedby)="[^"]*_r[^"]*"/g, "")
    .replace(/ data-radix-collection-item=""/g, "")
    .replace(/\s+/g, " ");
}

(async () => {
  const creds = readCreds();
  const out = { stage, capturedAt: new Date().toISOString(), blocks: {} };
  // Одинаковое исходное состояние: светлая тема в профиле, пустой localStorage.
  await sql('update "User" set "themePreference" = $1 where email = $2', ["light", creds.owner]);
  const browser = await launch();
  try {
    const desk = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ru-RU", colorScheme: "light" });
    await login(desk, creds.owner, creds.password);
    const page = await quietPage(desk, "markup-1280");
    await gotoHydrated(page, "/dashboard", 'button[aria-label="Профиль"]');
    await page.locator('button[aria-label="Профиль"]').click();
    const menu = page.locator('[data-slot="dropdown-menu-content"]');
    await menu.getByTestId("theme-tiles").waitFor({ timeout: 60000 });
    await page.waitForTimeout(500);
    out.blocks.menu1280 = normalize(await menu.getByTestId("profile-theme").evaluate((el) => el.outerHTML));
    await page.keyboard.press("Escape");

    await gotoHydrated(page, "/settings/appearance", 'main [data-testid="theme-tiles"] button');
    out.blocks.appearance1280 = normalize(
      await page.locator("main section").first().evaluate((el) => el.outerHTML),
    );

    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "ru-RU", colorScheme: "light" });
    await login(phone, creds.owner, creds.password);
    const p = await quietPage(phone, "markup-390");
    await gotoHydrated(p, "/dashboard", 'button[aria-label="Профиль"]');
    await p.locator('button[aria-label="Профиль"]').click();
    const sheet = p.locator('[role="dialog"]').filter({ has: p.getByTestId("theme-tiles") });
    await sheet.waitFor({ timeout: 60000 });
    await p.waitForTimeout(800);
    out.blocks.sheet390 = normalize(await sheet.getByTestId("theme-tiles").evaluate((el) => el.outerHTML));
  } finally {
    const file = path.join(RAW, `site-markup-${stage}.json`);
    fs.mkdirSync(RAW, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log("written", file, Object.fromEntries(Object.entries(out.blocks).map(([k, v]) => [k, v.length])));
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
