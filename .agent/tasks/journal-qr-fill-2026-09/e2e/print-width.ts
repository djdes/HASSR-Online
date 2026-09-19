/* eslint-disable no-console */
// AC8: на печати ширина шапки бланка = ширине таблицы (бракераж, скоропорт, приёмка).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3020";
const STATE = path.resolve(process.cwd(), ".agent/tasks/names-memory-2026-09/e2e/state.json");
const OUT = path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e");
const DOCS: Array<[string, string]> = [
  ["finished_product", "/journals/finished_product/documents/cmt6j45tj0i0c82tstt9fjbvg"],
  ["perishable", "/journals/perishable_rejection/documents/cmt6j45u60i0d82tso56gbx8r"],
  ["incoming", "/journals/incoming_control/documents/cmt6j45uq0i0e82tsvi4cnl97"],
];

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const VW = Number(process.env.VW ?? 1440);
  const ctx = await browser.newContext({ storageState: STATE, viewport: { width: VW, height: 900 } });
  await ctx.addInitScript("window.__name = (fn) => fn;");
  const page = await ctx.newPage();
  const results: Record<string, unknown> = {};
  for (const [tag, docPath] of DOCS) {
    await page.goto(`${BASE}${docPath}`, { waitUntil: "networkidle", timeout: 240_000 }).catch(() => null);
    await page.waitForSelector("table", { timeout: 120_000 }).catch(() => null);
    await page.waitForTimeout(3000);
    console.log("url:", page.url(), "title:", await page.title());
    console.log("body:", (await page.evaluate(() => document.body.innerText.slice(0, 200))).replace(/\s+/g, " "));
    await page.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((el) => el.remove()));
    await page.emulateMedia({ media: "print" });
    await page.waitForTimeout(800);
    const m = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll("table")).filter((t) => t.getClientRects().length > 0);
      const header = tables.find((t) => /Начат|Организация|Наименование организации/i.test(t.textContent || ""));
      const grid = tables.find((t) => t !== header && t.querySelector("thead"));
      const rect = (el: Element | undefined) => (el ? { x: Math.round(el.getBoundingClientRect().left), w: Math.round(el.getBoundingClientRect().width) } : null);
      return { header: rect(header), grid: rect(grid), tables: tables.length };
    });
    await page.screenshot({ path: path.join(OUT, `print-${tag}-${VW}.png`), fullPage: false });
    await page.emulateMedia({ media: "screen" });
    const ok = m.header && m.grid && Math.abs(m.header.w - m.grid.w) <= 1 && Math.abs(m.header.x - m.grid.x) <= 1;
    results[tag] = { ...m, ok };
    console.log(tag, JSON.stringify(m), ok ? "OK" : "MISMATCH");
  }
  fs.writeFileSync(path.join(OUT, `print-width-${VW}.json`), JSON.stringify(results, null, 2));
  await browser.close();
})();
