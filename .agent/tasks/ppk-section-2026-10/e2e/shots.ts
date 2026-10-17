// Быстрые снимки экранов раздела для глазной проверки (не тест).
// Запуск: npx tsx .agent/tasks/ppk-section-2026-10/e2e/shots.ts /path1 /path2 …  (SHOT_W=390 — телефон)
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE ?? "http://localhost:3025";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const RAW = path.join(HERE, "..", "raw");
const state = JSON.parse(fs.readFileSync(path.join(HERE, "..", "..", "nav-shell-2026-10", "e2e", "state.json"), "utf8"));
const STORAGE = path.join(HERE, "storage-manager.json");
const width = Number(process.env.SHOT_W ?? 1280);

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.E2E_CHROMIUM || undefined });
  const mobile = width < 768;
  if (!fs.existsSync(STORAGE)) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 600_000 });
      await page.waitForTimeout(1500);
      await page.fill("#email", state.users.manager.email);
      await page.fill("#password", state.password);
      await page.click('button[type="submit"]');
      const ok = await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 180_000 }).then(() => true).catch(() => false);
      if (ok) break;
    }
    await ctx.storageState({ path: STORAGE });
    await ctx.close();
  }
  const context = await browser.newContext({
    viewport: { width, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1,
    storageState: STORAGE,
  });
  if (mobile) await context.route("**/_next/image**", (route) => route.abort());
  await context.addInitScript(`document.addEventListener("DOMContentLoaded",function(){var s=document.createElement("style");s.textContent="nextjs-portal{display:none!important}";document.head.appendChild(s)})`);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 200)));
  for (const url of process.argv.slice(2)) {
    const res = await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
    await page.waitForLoadState("load", { timeout: 120_000 }).catch(() => null);
    await page.waitForTimeout(2500);
    if (process.env.SHOT_CLICK) await page.click(process.env.SHOT_CLICK).catch(() => console.log("no click target"));
    if (process.env.SHOT_CLICK) await page.waitForTimeout(1200);
    const name = `${width}${url.replace(/[\/?=&]+/g, "_")}${process.env.SHOT_TAG ?? ""}`;
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth);
    await page.screenshot({ path: path.join(RAW, `${name}.png`), fullPage: process.env.SHOT_FULL === "1", timeout: 120_000 });
    console.log(url, res?.status(), "→", new URL(page.url()).pathname, "scrollWidth", overflow, "shot", name);
  }
  await browser.close();
}
main();
