// Тёмная тема: карточка выбора точки и подсказка без точек (ЛОКАЛЬНАЯ база wesetup_memos).
// Запуск: BASE=http://localhost:3026 CHROME=<chrome.exe> node .agent/tasks/memos-point-2026-10-28/raw/dark.mjs
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:3026";
const shot = (name) => fileURLToPath(new URL(`./shots/${name}`, import.meta.url));

async function open(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: "wesetup-theme", value: "dark", url: BASE }]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.fill("#email", email);
    await page.fill("#password", "Test-12345");
    await page.click('button[type="submit"]');
    try {
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 });
      break;
    } catch {
      await page.waitForTimeout(1500);
    }
  }
  await page.mouse.move(1, 899);
  return { ctx, page };
}

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
try {
  const owner = await open(browser, "dk-owner@test.local");
  await owner.page.goto(`${BASE}/production-control/documents/posters?point=b-dk-112`);
  await owner.page.waitForSelector("[data-poster-point-picker]");
  console.log("theme", await owner.page.getAttribute(".app-shell", "data-app-theme"));
  await owner.page.locator("[data-poster-point-picker]").screenshot({ path: shot("9-dark-picker.png") });
  await owner.ctx.close();
  const none = await open(browser, "none-owner@test.local");
  await none.page.goto(`${BASE}/production-control/documents/posters`);
  await none.page.waitForSelector("[data-poster-points-empty]");
  await none.page.locator("[data-poster-points-empty]").screenshot({ path: shot("9-dark-empty.png") });
  await none.ctx.close();
} finally {
  await browser.close();
}
