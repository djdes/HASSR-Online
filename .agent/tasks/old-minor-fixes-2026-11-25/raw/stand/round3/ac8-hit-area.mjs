// Зона касания мобильной скрепки: видимая кнопка 28 px, касание — 48×48 (::before на 10 px).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("/opt/node-tools/node_modules/playwright");
const BASE = "http://localhost:3000";
const NAME = "Цех кондитерский";
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"], locale: "ru-RU" });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 180000 });
await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled, null, { timeout: 120000 });
await page.fill("#email", "admin@haccp.local"); await page.fill("#password", "admin1234");
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 180000 }), page.click('button[type="submit"]')]);
const made = await ctx.request.post(`${BASE}/api/settings/buildings`, { data: { name: NAME, sphere: "food" } });
const building = (await made.json()).building;
try {
  await page.goto(`${BASE}/settings/buildings`, { waitUntil: "networkidle", timeout: 180000 });
  const h2 = page.locator("h2", { hasText: NAME }).first();
  await h2.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(600);
  const r = await h2.evaluate((el) => {
    const pin = el.querySelector("[data-pin-building]");
    const b = pin.getBoundingClientRect(); const cx = b.left + b.width / 2; const cy = b.top + b.height / 2;
    const hits = (x, y) => document.elementFromPoint(x, y)?.closest("[data-pin-building]") === pin;
    return { box: [Math.round(b.width), Math.round(b.height)],
      center: hits(cx, cy), left9: hits(b.left - 9, cy), right9: hits(b.right + 9, cy), up9: hits(cx, b.top - 9), down9: hits(cx, b.bottom - 0.5 + 9),
      outside12: hits(b.right + 12, cy) };
  });
  console.log(JSON.stringify(r));
  // Касание рядом с кнопкой (на 8 px правее) закрепляет объект.
  const box = await h2.locator("[data-pin-building]").boundingBox();
  await page.touchscreen.tap(box.x + box.width + 8, box.y + box.height / 2);
  await page.waitForTimeout(800);
  console.log("pressed after tap beside:", await h2.locator("[data-pin-building]").getAttribute("aria-pressed"));
  await page.touchscreen.tap(box.x + box.width + 8, box.y + box.height / 2);
  await page.waitForTimeout(800);
  console.log("pressed after second tap:", await h2.locator("[data-pin-building]").getAttribute("aria-pressed"));
} finally {
  await ctx.request.delete(`${BASE}/api/settings/buildings/${building.id}`);
  await browser.close();
}
