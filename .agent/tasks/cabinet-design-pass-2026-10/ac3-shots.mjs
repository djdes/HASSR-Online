// «Пришла проверка» в трёх состояниях: покой, наведение, раздел открыт
// (сайт 1440) и в листе меню телефона (390). Курсор уводится в сторону, чтобы
// «покой» не снимался с наведением.
// node ac3-shots.mjs <base> <tag> [email] → raw/<tag>/ac3-*.png и ac3.json
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.argv[2];
const TAG = process.argv[3] || "after";
const EMAIL = process.argv[4] || "admin@haccp.local";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "raw", TAG);
fs.mkdirSync(OUT, { recursive: true });
const exe = path.join(process.env.LOCALAPPDATA, "ms-playwright", "chromium_headless_shell-1243", "chrome-headless-shell-win64", "chrome-headless-shell.exe");
const browser = await chromium.launch(fs.existsSync(exe) ? { executablePath: exe } : {});
const result = { email: EMAIL };

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
  for (let i = 0; i < 2; i++) if (await page.locator('[role="dialog"]').first().isVisible().catch(() => false)) { await page.keyboard.press("Escape"); await page.waitForTimeout(300); }
  await page.waitForTimeout(700);
}
const style = (locator) =>
  locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, border: `${s.borderTopWidth} ${s.borderTopColor}`, color: s.color, current: el.getAttribute("aria-current") };
  });
const tag = EMAIL.split("@")[0];

{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const page = await ctx.newPage();
  await page.request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: "admin1234" }, timeout: 600000 });
  await page.goto(`${BASE}/more`, { waitUntil: "domcontentloaded", timeout: 600000 });
  await settle(page);
  const sidebar = page.locator("[data-app-sidebar]");
  const item = sidebar.locator('[data-nav-section="inspection"]').first();
  const active = sidebar.locator('[data-nav-section="more"]').first();
  await page.mouse.move(900, 450);
  await page.waitForTimeout(300);
  result.rest = await style(item);
  result.activeItem = await style(active);
  await sidebar.screenshot({ path: path.join(OUT, `ac3-${tag}-desktop-rest.png`) });
  await item.hover();
  await page.waitForTimeout(300);
  result.hover = await style(item);
  await sidebar.screenshot({ path: path.join(OUT, `ac3-${tag}-desktop-hover.png`) });
  await page.goto(`${BASE}/inspection`, { waitUntil: "domcontentloaded", timeout: 600000 });
  await settle(page);
  if ((await sidebar.getAttribute("data-sidebar-mode")) === "section") {
    await sidebar.locator("button[data-back-to-main]").click();
    await page.waitForTimeout(500);
  }
  await page.mouse.move(900, 450);
  await page.waitForTimeout(300);
  result.open = await style(item);
  await sidebar.screenshot({ path: path.join(OUT, `ac3-${tag}-desktop-open.png`) });
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, locale: "ru-RU", isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: "admin1234" }, timeout: 600000 });
  await page.goto(`${BASE}/more`, { waitUntil: "domcontentloaded", timeout: 600000 });
  await settle(page);
  await page.locator("[data-nav-burger]").click();
  await page.waitForTimeout(800);
  const row = page.locator('[data-mobile-nav] [data-nav-section="inspection"]');
  await row.scrollIntoViewIfNeeded().catch(() => {});
  result.mobileRest = await style(row);
  result.mobileActiveItem = await style(page.locator('[data-mobile-nav] [data-nav-section="more"]'));
  await page.screenshot({ path: path.join(OUT, `ac3-${tag}-mobile-sheet.png`) });
  await ctx.close();
}
fs.writeFileSync(path.join(OUT, `ac3-${tag}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 1));
await browser.close();
