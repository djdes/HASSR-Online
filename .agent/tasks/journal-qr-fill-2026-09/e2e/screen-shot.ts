import path from "node:path";
import { chromium } from "playwright";
import { whatsNewVersion } from "@/lib/whats-new-notes";
const STATE = path.resolve(process.cwd(), ".agent/tasks/names-memory-2026-09/e2e/state.json");
const OUT = path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e/shots");
(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  for (const [tag, vw, mobile] of [["desktop", 1280, false], ["mobile", 390, true]] as const) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: 900 }, isMobile: mobile, hasTouch: mobile, storageState: STATE });
    await ctx.addInitScript(`try { localStorage.setItem("wesetup.last-seen-build-sha", ${JSON.stringify(whatsNewVersion())}); } catch {}`);
    await ctx.addInitScript("window.__name = (fn) => fn;");
    const page = await ctx.newPage();
    await page.goto("http://localhost:3020/journals/finished_product/documents/cmt6j45tj0i0c82tstt9fjbvg", { waitUntil: "load", timeout: 240_000 });
    await page.waitForSelector("table", { timeout: 180_000 }).catch(() => null);
    await page.waitForTimeout(2500);
    await page.evaluate(() => document.querySelectorAll('[role="dialog"]').forEach((el) => { if (el.className.includes("z-[120]")) el.remove(); }));
    if (mobile) { const t = page.locator('[aria-label="Режим отображения"] button', { hasText: /Таблица/ }).first(); if (await t.count()) await t.click(); await page.waitForTimeout(800); }
    const m = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll("table")).filter((t) => t.getClientRects().length > 0);
      return tables.slice(0, 2).map((t) => ({ x: Math.round(t.getBoundingClientRect().left), w: Math.round(t.getBoundingClientRect().width) }));
    });
    console.log(tag, JSON.stringify(m));
    await page.screenshot({ path: path.join(OUT, `round2-screen-${tag}.png`), fullPage: false });
    await ctx.close();
  }
  await browser.close();
})();
