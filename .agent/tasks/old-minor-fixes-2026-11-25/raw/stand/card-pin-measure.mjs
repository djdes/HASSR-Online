// Карточка объекта: скрепка в строке с названием? Замер на 320…1280 px.
// Запуск: node measure.mjs <outdir> <label>
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node-tools/node_modules/playwright");
const BASE = "http://localhost:3000";
const OUT = process.argv[2]; const LABEL = process.argv[3] ?? "run";
fs.mkdirSync(OUT, { recursive: true });
const NAME = "Столовая при заводе на Северной улице";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 180000 });
await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled, null, { timeout: 120000 });
await page.fill("#email", "admin@haccp.local"); await page.fill("#password", "admin1234");
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 180000 }), page.click('button[type="submit"]')]);
const api = ctx.request;
const made = await api.post(`${BASE}/api/settings/buildings`, { data: { name: NAME, sphere: "food" } });
const building = (await made.json().catch(() => ({}))).building;
if (!building?.id) { console.log("create failed", made.status()); process.exit(2); }
const rows = [];
try {
  for (const width of [320, 360, 375, 390, 430, 700, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/settings/buildings`, { waitUntil: "networkidle", timeout: 180000 });
    const legal = page.locator('[data-testid="legal-update-modal"]');
    if (await legal.count()) { await legal.locator('input[type="checkbox"], [role="checkbox"]').first().click(); await page.click('[data-testid="legal-update-accept"]'); }
    const heading = page.locator("h2", { hasText: NAME }).first();
    await heading.waitFor({ state: "attached", timeout: 60000 });
    // Список длинный (объекты прошлых прогонов): прокручиваем к карточке сами — offscreen-карточки не отрисованы.
    await heading.evaluate((h2) => h2.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(800);
    const m = await heading.evaluate((h2) => {
      const header = h2.closest("div.flex.flex-wrap") ?? h2.parentElement?.parentElement;
      const pin = header?.querySelector("[data-pin-building]");
      const chip = header?.querySelector("[data-building-sphere],[data-building-office]");
      const r = (el) => el ? el.getBoundingClientRect() : null;
      const n = r(h2), p = r(pin), c = r(chip);
      return {
        name: n && { top: Math.round(n.top), bottom: Math.round(n.bottom), left: Math.round(n.left), right: Math.round(n.right) },
        pin: p && { top: Math.round(p.top), bottom: Math.round(p.bottom), left: Math.round(p.left) },
        chip: c && { top: Math.round(c.top), bottom: Math.round(c.bottom), left: Math.round(c.left) },
        docW: document.documentElement.scrollWidth, vw: window.innerWidth,
      };
    });
    const pinWithName = m.pin && m.name ? m.pin.top < m.name.bottom && m.pin.bottom > m.name.top : null;
    const order = m.pin && m.chip ? (m.pin.top === m.chip.top || Math.abs(m.pin.top - m.chip.top) < 12 ? (m.pin.left > m.chip.left ? "chip→pin" : "pin→chip") : "rows") : "?";
    rows.push({ width, pinWithName, order, ...m });
    console.log(`${LABEL} ${width}px: pin on name row=${pinWithName} order=${order} noHScroll=${m.docW <= m.vw}`);
    // Снимок — шапка карточки (значок, название, сфера, скрепка, адрес).
    const box = await heading.evaluate((h2) => {
      const header = (h2.closest("div.flex.flex-wrap") ?? h2.parentElement).parentElement;
      const r = header.getBoundingClientRect();
      return { x: Math.max(0, r.left - 12), y: Math.max(0, r.top - 12), width: Math.min(window.innerWidth, r.width + 24), height: r.height + 24 };
    });
    await page.screenshot({ path: `${OUT}/${LABEL}-${width}.png`, clip: box });
  }
} finally {
  const del = await api.delete(`${BASE}/api/settings/buildings/${building.id}`);
  console.log("cleanup delete", del.status());
  fs.writeFileSync(`${OUT}/${LABEL}.json`, JSON.stringify(rows, null, 2));
  await browser.close();
}
