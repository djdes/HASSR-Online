// Раскладка «заголовок + блок кнопок» на промежуточных ширинах: нет ли
// горизонтальной прокрутки и где оказывается блок (справа / под заголовком).
// Запуск: npx tsx .agent/tasks/general-cleaning-qr-switcher-2026-09/e2e/qr-layout-probe.ts
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3020";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const state = JSON.parse(fs.readFileSync(path.join(HERE, "qr-state.json"), "utf8"));
const CODES = (process.env.CODES ?? "cold_equipment_control,staff_training,traceability_test,sanitary_day_control,accident_journal,product_writeoff,hygiene").split(",");
const WIDTHS = (process.env.WIDTHS ?? "390,640,700,768,1024,1440").split(",").map(Number);

const PROBE_JS = `(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const block = document.querySelector("[data-journal-list-actions]");
  const h1 = document.querySelector("h1");
  const cells = block ? Array.from(block.children).map((c) => ({ ...r(c), sw: c.scrollWidth, cw: c.clientWidth })) : [];
  const overflowCells = block ? Array.from(block.querySelectorAll("button, a")).filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.innerText.trim()) : [];
  return { overflow: document.documentElement.scrollWidth > window.innerWidth + 1, scrollWidth: document.documentElement.scrollWidth, h1: r(h1), block: r(block), cells, overflowCells };
})()`;

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 240_000 });
  await page.fill("#email", state.users.manager.email);
  await page.fill("#password", state.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120_000 });
  const rows: unknown[] = [];
  for (const code of CODES) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${BASE}/journals/${code}`, { waitUntil: "load", timeout: 240_000 });
      await page.locator("[data-journal-list-actions]").first().waitFor({ timeout: 120_000 }).catch(() => null);
      await page.waitForTimeout(250);
      const probe = (await page.evaluate(PROBE_JS)) as { overflow: boolean; h1: { x: number; y: number; w: number; h: number } | null; block: { x: number; y: number; w: number; h: number } | null; overflowCells: string[] };
      const place = probe.block && probe.h1 ? (probe.block.y >= probe.h1.y + probe.h1.h - 2 ? "below" : "right") : "?";
      const row = { code, width, overflow: probe.overflow, place, h1: probe.h1, block: probe.block, overflowCells: probe.overflowCells };
      rows.push(row);
      console.log(`${code.padEnd(26)} ${String(width).padStart(4)}  overflow=${probe.overflow}  block=${place}  h1w=${probe.h1?.w} blockw=${probe.block?.w} cellsOverflow=${probe.overflowCells.join("|")}`);
    }
  }
  fs.writeFileSync(path.join(HERE, "qr-layout-probe.json"), JSON.stringify(rows, null, 2));
  await browser.close();
})();
