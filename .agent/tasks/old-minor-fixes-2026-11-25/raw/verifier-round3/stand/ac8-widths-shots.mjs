// Verifier round 3: AC8 screenshots of the current code at the spec widths 320/360/375/390/430/700/1280
// (top of /settings/buildings: the first cards, real demo data, nothing created).
// Usage (env loaded, next dev on :3000): node ac8-widths-shots.mjs <outdir>
import fs from "node:fs";
import { BASE, chromium, ownerState, acceptLegal } from "./lib3.mjs";

const OUT = process.argv[2] ?? "out";
fs.mkdirSync(`${OUT}/screens`, { recursive: true });
const browser = await chromium.launch();
const state = await ownerState(browser);
for (const width of [320, 360, 375, 390, 430, 700, 1280]) {
  const phone = width < 640;
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, isMobile: phone, hasTouch: phone, deviceScaleFactor: 2, storageState: state, locale: "ru-RU" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/settings/buildings`, { waitUntil: "networkidle", timeout: 240000 });
  await acceptLegal(page);
  await page.waitForTimeout(2500);
  const first = page.locator("[data-building-card]").first();
  await first.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/screens/ac8-width-${width}.png` });
  console.log(`ac8-width-${width}.png`);
  await ctx.close();
}
await browser.close();
