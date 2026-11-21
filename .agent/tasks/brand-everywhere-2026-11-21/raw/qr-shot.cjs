/* QR page screenshot only: node qr-shot.cjs <outDir> <stand.json> <label> */
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.E2E_BASE || "http://localhost:3022";
const [OUT, STAND_FILE, LABEL = "qr"] = process.argv.slice(2);
const STAND = JSON.parse(fs.readFileSync(STAND_FILE, "utf8"));
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium" });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/equipment-fill/${STAND.equipmentId}?token=${encodeURIComponent(STAND.token)}`, { waitUntil: "load", timeout: 240000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(1200);
  const state = await page.evaluate(() => {
    const select = document.querySelector("main header select");
    const h1 = document.querySelector("main header h1");
    return { selectBg: select ? getComputedStyle(select).backgroundColor : null, title: h1 ? { text: h1.textContent, scrollW: h1.scrollWidth, clientW: h1.clientWidth } : null };
  });
  console.log(JSON.stringify(state));
  await page.screenshot({ path: path.join(OUT, `${LABEL}.png`) });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
