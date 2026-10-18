// Центр шапки при разных точках (руководитель): сайт 1440 и телефон 390.
// node points-shots.mjs <base> <case>  → raw/after/points-<case>-*.png и points-<case>.json
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.argv[2];
const KASE = process.argv[3];
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "raw", "after");
const exe = path.join(process.env.LOCALAPPDATA, "ms-playwright", "chromium_headless_shell-1243", "chrome-headless-shell-win64", "chrome-headless-shell.exe");
const browser = await chromium.launch(fs.existsSync(exe) ? { executablePath: exe } : {});
const result = { case: KASE };
async function open(viewport, mobile) {
  const ctx = await browser.newContext({ viewport, locale: "ru-RU", ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await ctx.newPage();
  await page.request.post(`${BASE}/api/auth/login`, { data: { email: "admin@haccp.local", password: "admin1234" }, timeout: 600000 });
  await page.goto(`${BASE}/more`, { waitUntil: "domcontentloaded", timeout: 600000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
  for (let i = 0; i < 2; i++) if (await page.locator('[role="dialog"]').first().isVisible().catch(() => false)) { await page.keyboard.press("Escape"); await page.waitForTimeout(300); }
  await page.waitForTimeout(600);
  return { ctx, page };
}
for (const [tag, viewport, mobile] of [["desktop", { width: 1440, height: 900 }, false], ["mobile", { width: 390, height: 800 }, true]]) {
  const { ctx, page } = await open(viewport, mobile);
  const point = page.locator("[data-current-point]").first();
  result[tag] = {
    kind: await point.getAttribute("data-current-point").catch(() => null),
    caption: await point.locator("[data-point-caption]").innerText().catch(() => null),
    title: await point.locator("[data-point-title]").innerText().catch(() => (null)),
    text: await point.innerText().catch(() => null),
    hint: await point.getAttribute("title").catch(() => null),
    href: await point.getAttribute("href").catch(() => null),
    company: await page.locator("[data-app-sidebar] [data-organization-brand]").first().innerText().catch(() => null),
  };
  await page.screenshot({ path: path.join(OUT, `points-${KASE}-${tag}.png`), clip: { x: 0, y: 0, width: viewport.width, height: mobile ? 140 : 200 } });
  if (result[tag].kind === "switch") {
    await point.click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, `points-${KASE}-${tag}-open.png`) });
    result[tag].options = await page.locator("[data-point-option], [role=dialog] button").allInnerTexts().catch(() => []);
  }
  await ctx.close();
}
fs.writeFileSync(path.join(OUT, `points-${KASE}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
await browser.close();
