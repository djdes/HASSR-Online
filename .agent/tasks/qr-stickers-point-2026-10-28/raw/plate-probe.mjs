// Высоты частей таблички в печати (мм): что съедает место. Локальная база, не прод.
// BASE=http://localhost:3026 CHROME=<chrome.exe> node .agent/tasks/qr-stickers-point-2026-10-28/raw/plate-probe.mjs
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:3026";
const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addCookies([{ name: "wesetup.building", value: "org-dk:organization", domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.setDefaultTimeout(240000);
await page.goto(`${BASE}/login`, { waitUntil: "load" });
for (let i = 0; i < 6; i += 1) {
  await page.fill("#email", "dk-owner@test.local");
  await page.fill("#password", "Test-12345");
  if ((await page.inputValue("#email")) !== "dk-owner@test.local") continue;
  await page.click('button[type="submit"]');
  try { await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }); break; } catch { await page.waitForTimeout(1500); }
}
await page.goto(`${BASE}/settings/qr-posters?kind=equipment&layout=plate`, { waitUntil: "load" });
await page.waitForSelector("[data-qr-print-root]", { state: "attached" });
await page.emulateMedia({ media: "print" });
const out = await page.evaluate(() => {
  const mm = (px) => Math.round((px * 25.4 / 96) * 10) / 10;
  return Array.from(document.querySelectorAll(".qrp-plate-frame")).map((frame) => {
    const box = frame.getBoundingClientRect();
    const cs = getComputedStyle(frame);
    const parts = Array.from(frame.children).map((child) => {
      const r = child.getBoundingClientRect();
      const s = getComputedStyle(child);
      return `${child.className.split(" ")[0]}=${mm(r.height)}(+mt ${s.marginTop})`;
    });
    return { frame: mm(box.height), padTop: cs.paddingTop, border: cs.borderTopWidth, parts: parts.join(" | ") };
  });
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
