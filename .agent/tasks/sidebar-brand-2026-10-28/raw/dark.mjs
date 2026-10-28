// Тёмная тема шапки меню на ЛОКАЛЬНОЙ базе wesetup_brand (без логотипа и с ним).
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:3025";
const shot = (name) => fileURLToPath(new URL(`./shots/${name}`, import.meta.url));
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: "wesetup-theme", value: "dark", url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", "owner@test.local");
  await page.fill("#password", "Test-12345");
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 180000 });
  await page.waitForSelector("[data-app-sidebar] [data-organization-brand]", { timeout: 180000 });
  await page.waitForTimeout(1000);
  console.log("theme", await page.getAttribute(".app-shell", "data-app-theme"));
  const box = await page.locator("[data-app-sidebar]").boundingBox();
  await page.screenshot({ path: shot("7-dark-no-logo.png"), clip: { x: box.x, y: box.y, width: box.width, height: 300 } });
} finally {
  await browser.close();
}
