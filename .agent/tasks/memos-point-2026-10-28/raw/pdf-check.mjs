// Печать памяток в PDF на ЛОКАЛЬНОЙ тестовой базе (wesetup_memos), не на проде.
// Считает страницы: каждая памятка должна занимать ровно один лист A4.
// Запуск (из корня worktree):
//   BASE=http://localhost:3026 CHROME=<chrome.exe> EMAIL=dk-owner@test.local POINT=b-dk-112 TAG=after \
//     node .agent/tasks/memos-point-2026-10-28/raw/pdf-check.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:3026";
const EMAIL = process.env.EMAIL ?? "dk-owner@test.local";
const POINT = process.env.POINT ?? "";
const TAG = process.env.TAG ?? "run";
const OUT = new URL(`./pdf/${TAG}/`, import.meta.url);
mkdirSync(OUT, { recursive: true });
const file = (name) => fileURLToPath(new URL(name, OUT));

const KEYS = [
  "hand-washing", "antiseptic", "hygiene", "chef-clothing", "daily-inspection", "product-marking",
  "board-marking", "storage-times", "storage", "disinfectant-safety", "nika-2", "nika-chlor",
  "chlormisept-r", "cross-contamination", "daily-sample", "eggs", "dishes",
];
const PX_PER_MM = 96 / 25.4;

const countPages = (buffer) => (buffer.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", EMAIL);
  await page.fill("#password", "Test-12345");
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 240000 });
}

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const report = { base: BASE, email: EMAIL, point: POINT || null, posters: [], all: null };
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  page.setDefaultNavigationTimeout(240000);
  await login(page);
  if (process.env.LOGO === "1") {
    // Логотип в шапке — самый высокий вариант шапки (24 мм), как на скане.
    const logoPage = await ctx.newPage();
    await logoPage.setContent(
      `<div id="logo" style="display:inline-block;padding:4px 8px;font:800 50px/0.95 Arial;color:#7b7f8c;letter-spacing:4px">ДОБРОЕ<br>КАФЕ</div>`,
    );
    const buffer = await (await logoPage.$("#logo")).screenshot({ omitBackground: true });
    await logoPage.close();
    const response = await page.request.post(`${BASE}/api/settings/organization/logo`, {
      multipart: { file: { name: "logo.png", mimeType: "image/png", buffer } },
    });
    console.log(`logo upload: ${response.status()}`);
  }
  const query = (extra = {}) => {
    const params = new URLSearchParams(extra);
    if (POINT) params.set("point", POINT);
    const text = params.toString();
    return text ? `?${text}` : "";
  };

  for (const key of KEYS) {
    await page.goto(`${BASE}/production-control/documents/posters/${key}${query()}`, { waitUntil: "load", timeout: 240000 });
    await page.waitForSelector("[data-print-brand-frame]", { timeout: 240000 });
    const pdf = await page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true });
    writeFileSync(file(`${key}.pdf`), pdf);
    // Высота листа в вёрстке печати (ширина = 190 мм, как на бумаге).
    await page.setViewportSize({ width: Math.round(190 * PX_PER_MM), height: 1000 });
    await page.emulateMedia({ media: "print" });
    const sizes = await page.evaluate((pxPerMm) => {
      const frame = document.querySelector("[data-print-brand-frame]");
      const content = frame?.querySelector("[data-poster-content]") ?? frame?.children[1];
      const box = frame?.getBoundingClientRect();
      return {
        frameMm: box ? +(box.height / pxPerMm).toFixed(1) : null,
        widthMm: box ? +(box.width / pxPerMm).toFixed(1) : null,
        contentMm: content ? +(content.scrollHeight / pxPerMm).toFixed(1) : null,
        slotMm: content ? +(content.getBoundingClientRect().height / pxPerMm).toFixed(1) : null,
      };
    }, PX_PER_MM);
    await page.emulateMedia({ media: null });
    await page.setViewportSize({ width: 1280, height: 1000 });
    const entry = { key, pages: countPages(pdf), ...sizes };
    report.posters.push(entry);
    console.log(`${entry.pages === 1 ? "ok  " : "FAIL"} ${key.padEnd(20)} pages=${entry.pages} frame=${entry.frameMm}mm content=${entry.contentMm}/${entry.slotMm}mm width=${entry.widthMm}mm`);
  }

  await page.goto(`${BASE}/production-control/documents/posters/all${query()}`, { waitUntil: "load", timeout: 240000 });
  await page.waitForSelector("[data-print-brand-frame]", { timeout: 240000 });
  const all = await page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true });
  writeFileSync(file("all.pdf"), all);
  report.all = { pages: countPages(all), sheets: await page.locator("[data-print-brand-frame]").count() };
  console.log(`ALL: pages=${report.all.pages} sheets=${report.all.sheets}`);
} finally {
  writeFileSync(file("report.json"), JSON.stringify(report, null, 2));
  await browser.close();
}
