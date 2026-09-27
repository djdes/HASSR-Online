/**
 * E2E ч/б QR на живом dev-сервере: окно «QR: заполнить с телефона» документа
 * журнала (превью — новая плитка), экран QR-кодов, печать плаката A4 и листа
 * наклеек настоящим путём Chrome (`page.pdf()` в print-медиа). Код на
 * странице PDF растрируется (pdf.js) при 600 dpi «как принтер», дальше снимки
 * `qr-sim.ts` (300 dpi — оба декодера, 150 dpi — zxing-cpp).
 *
 * Стенд — `e2e-setup.ts`. Запуск (dev-сервер уже поднят):
 *   BASE=http://localhost:3141 STATE=D:/wt-build/tmp-bwqr/e2e/state.json \
 *   QR_VERIFY_DIR=D:/wt-build/verify-bwqr node --import tsx .agent/tasks/qr-bw-minimal-2026-09/e2e-site.ts
 * Всё — в E2E_OUT (D:/wt-build/tmp-bwqr/e2e/out): писать в папку задачи при
 * живом dev-сервере нельзя (он пересобирается от любой записи в .agent/).
 */
import fs from "node:fs";
import path from "node:path";

import { chromium, type Page } from "playwright";

import {
  PHONE,
  decodeJsQr,
  decodeZxing,
  downsample,
  openPdf,
  pageSizeMm,
  phoneCapture,
  renderRegion,
  threshold,
  type Raster,
} from "../journal-qr-header-2026-09/qr-sim";

const BASE = process.env.BASE ?? "http://localhost:3141";
const OUT = path.resolve(process.env.E2E_OUT ?? "D:/wt-build/tmp-bwqr/e2e/out");
const SHOTS = path.join(OUT, "shots");
const state = JSON.parse(fs.readFileSync(process.env.STATE ?? "D:/wt-build/tmp-bwqr/e2e/state.json", "utf8")) as {
  password: string;
  manager: string;
  hygieneDoc: string;
};

const checks: { id: string; ok: boolean; what: string; details?: unknown }[] = [];
function check(id: string, what: string, ok: boolean, details?: unknown) {
  checks.push({ id, ok, what, details });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${what}${ok ? "" : ` ${JSON.stringify(details)}`}`);
}

async function login(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 600_000 });
    await page.waitForLoadState("networkidle").catch(() => null);
    await page.waitForTimeout(1500);
    await page.fill("#email", state.manager);
    await page.fill("#password", state.password);
    await page.click('button[type="submit"]').catch(() => null);
    if (await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 300_000 }).then(() => true, () => false)) return;
  }
  throw new Error("вход не удался");
}

/** Снимки кода с листа PDF: 600 dpi «принтер» → 300/150 dpi; чтение jsQR и zxing-cpp. */
async function decodeFromPdf(id: string, pdf: Buffer, pageNo: number, box: { x0: number; y0: number; x1: number; y1: number }, url: string) {
  const doc = await openPdf(pdf);
  const master = await renderRegion(doc, pageNo, box, 600);
  await doc.close();
  const bw = threshold(master);
  const marks: string[] = [];
  let ok = true;
  const read = async (dpi: number, shot: string, r: Raster) => {
    const j = decodeJsQr(r) === url;
    const z = (await decodeZxing(r)) === url;
    marks.push(`${dpi}${shot}:${j ? "J" : "-"}${z ? "Z" : "-"}`);
    if (dpi >= 300 ? !(j && z) : !z) ok = false;
  };
  for (const dpi of [300, 150]) {
    const clean = downsample(master, 600 / dpi);
    await read(dpi, "clean", clean);
    await read(dpi, "bw", threshold(clean));
    await read(dpi, "bw-print", downsample(bw, 600 / dpi));
    await read(dpi, "phone", await phoneCapture(master, 600, dpi, { ...PHONE, angle: 7 }));
    await read(dpi, "bw-phone", await phoneCapture(bw, 600, dpi, { ...PHONE, angle: -8 }));
  }
  console.log(`  ${id}: ${marks.join(" ")}`);
  return { ok, marks: marks.join(" ") };
}

async function openPosters(page: Page, query: string) {
  await page.goto(`${BASE}/settings/qr-posters?${query}&origin=${encodeURIComponent(BASE)}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
  await page.waitForSelector("[data-qr-page]", { timeout: 600_000 });
  await page.waitForSelector("[data-qr-summary]", { timeout: 120_000 });
}

async function cards(page: Page) {
  return page.$$eval("[data-qr-poster]", (nodes) =>
    nodes.map((node) => ({ id: node.getAttribute("data-qr-id") ?? "", url: node.getAttribute("data-qr-url") ?? "", selected: node.getAttribute("data-qr-selected") === "true" }))
  );
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=swiftshader", "--no-sandbox"] });
  const decoded: Record<string, { ok: boolean; marks: string }> = {};
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.setDefaultTimeout(300_000);
    await login(page);

    // 1. Документ журнала → «Ещё действия» → «QR: заполнить с телефона».
    await page.goto(`${BASE}/journals/hygiene/documents/${state.hygieneDoc}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
    await page.waitForLoadState("networkidle").catch(() => null);
    await page.locator('[aria-label="Ещё действия"]').first().click({ timeout: 600_000 });
    await page.getByRole("menuitem", { name: "QR: заполнить с телефона" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await dialog.locator("[data-qr-fill-preview] .qr-fill-preview-box svg").nth(1).waitFor({ timeout: 300_000 });
    await page.waitForTimeout(500);
    const previews = await dialog.locator("[data-qr-fill-preview] .qr-fill-preview-box svg").evaluateAll((svgs) =>
      svgs.map((svg) => ({
        width: svg.getBoundingClientRect().width,
        height: svg.getBoundingClientRect().height,
        text: Array.from(svg.querySelectorAll("text"), (t) => t.textContent),
        images: svg.querySelectorAll("image").length,
        colors: Array.from(new Set(Array.from(svg.querySelectorAll("[fill]"), (n) => n.getAttribute("fill")))).filter((c) => c !== "none"),
      }))
    );
    check(
      "DLG-1",
      "окно QR документа: два превью — новая плитка (одно слово «Отсканировать», без картинки, только чёрный и белый, пропорция 1,148)",
      previews.length === 2 &&
        previews.every((p) => p.text.join("|") === "Отсканировать" && p.images === 0 && p.colors.every((c) => c === "#000000" || c === "#ffffff") && Math.abs(p.height / p.width - 1.148) < 0.02),
      previews
    );
    await dialog.screenshot({ path: path.join(SHOTS, "dialog-qr-document.png") });
    await page.keyboard.press("Escape");

    // 2. Экран QR-кодов журнала.
    await openPosters(page, "journal=hygiene");
    const list = await cards(page);
    const main = list.find((card) => card.id === "hygiene");
    check("SCR-1", "экран QR-кодов журнала открылся, у основного QR есть адрес", Boolean(main?.url), list.map((c) => c.id));
    await page.screenshot({ path: path.join(SHOTS, "posters-screen-1440.png"), fullPage: false });

    // 3. Печать: основной QR журнала — плакат A4.
    for (const card of list) {
      const selector = `[data-qr-id="${card.id}"]`;
      if (card.id === "hygiene") {
        if (!card.selected) await page.locator(`${selector} input[type=checkbox]`).first().check();
        await page.locator(`${selector} [data-qr-format-option="a4"]`).first().click();
      } else if (card.selected) {
        await page.locator(`${selector} input[type=checkbox]`).first().uncheck();
      }
    }
    await page.waitForFunction(
      (url) => Array.from(document.querySelectorAll("[data-qr-print-url]")).some((n) => n.getAttribute("data-qr-print-url") === url && n.getAttribute("data-qr-print-mm") === "105"),
      main!.url
    );
    await page.emulateMedia({ media: "print" });
    const a4 = page.locator('[data-qr-sheet="a4"]').first();
    const a4Box = await a4.evaluate((sheet) => {
      const s = sheet.getBoundingClientRect();
      const c = sheet.querySelector("svg")!.getBoundingClientRect();
      const k = 25.4 / 96;
      return { x: (c.left - s.left) * k, y: (c.top - s.top) * k, w: c.width * k, h: c.height * k };
    });
    check("PR-1", "плакат A4: код 105 мм по ширине, плитка с полосой (≈ 120,5 мм)", Math.abs(a4Box.w - 105) < 0.5 && Math.abs(a4Box.h - 105 * 1.148) < 1, a4Box);
    await a4.screenshot({ path: path.join(SHOTS, "print-a4-poster.png") });
    const a4Pdf = await page.pdf({ preferCSSPageSize: true, printBackground: false });
    fs.writeFileSync(path.join(OUT, "a4.pdf"), a4Pdf);
    // Поля листа @page — 10 мм.
    decoded["print-a4"] = await decodeFromPdf("print-a4", a4Pdf, 1, { x0: 10 + a4Box.x - 8, y0: 10 + a4Box.y - 8, x1: 10 + a4Box.x + a4Box.w + 8, y1: 10 + a4Box.y + a4Box.h + 8 }, main!.url);
    check("PR-2", "печать Chrome плаката A4: 300 dpi — оба декодера, 150 dpi — zxing-cpp", decoded["print-a4"].ok, decoded["print-a4"].marks);
    await page.emulateMedia({ media: "screen" });

    // 4. Лист наклеек: холодильники.
    await openPosters(page, "kind=equipment&layout=sheet");
    const objectCards = (await cards(page)).filter((c) => c.selected);
    await page.emulateMedia({ media: "print" });
    const measured = await page.$$eval(".qrp-sticker", (nodes) =>
      nodes.map((node) => {
        const code = node.querySelector("[data-qr-print-code]");
        const svg = code?.querySelector("svg")?.getBoundingClientRect();
        const box = node.getBoundingClientRect();
        const inner = Array.from(node.children).map((child) => child.getBoundingClientRect());
        return {
          url: code?.getAttribute("data-qr-print-url") ?? "",
          widthMm: ((svg?.width ?? 0) * 25.4) / 96,
          heightMm: ((svg?.height ?? 0) * 25.4) / 96,
          overflow: inner.some((r) => r.bottom > box.bottom - 0.5 || r.top < box.top + 0.5),
        };
      })
    );
    check(
      "ST-1",
      "наклейки: код 29–36 мм по ширине, пропорция плитки 1,148, текст не вылезает",
      measured.length === objectCards.length && measured.length > 0 && measured.every((m) => m.widthMm >= 28.95 && m.widthMm <= 36.05 && Math.abs(m.heightMm / m.widthMm - 1.148) < 0.02 && !m.overflow),
      measured
    );
    const sheet = page.locator('[data-qr-sheet="sticker"]').first();
    await sheet.screenshot({ path: path.join(SHOTS, "print-stickers.png") });
    const stickerPdf = await page.pdf({ preferCSSPageSize: true, printBackground: false });
    fs.writeFileSync(path.join(OUT, "stickers.pdf"), stickerPdf);
    const colW = (190 - 6) / 3;
    let stickersOk = true;
    for (let index = 0; index < measured.length; index += 1) {
      const cell = { x0: 10 + (index % 3) * (colW + 3), y0: 10 + Math.floor(index / 3) * 63, x1: 0, y1: 0 };
      cell.x1 = cell.x0 + colW;
      cell.y1 = cell.y0 + 60;
      const r = await decodeFromPdf(`sticker-${index}`, stickerPdf, 1, cell, measured[index].url);
      decoded[`print-sticker-${index}`] = r;
      if (!r.ok) stickersOk = false;
    }
    check("ST-2", "печать Chrome листа наклеек: каждая наклейка — 300 dpi оба декодера, 150 dpi zxing-cpp", stickersOk, Object.keys(decoded).filter((k) => !decoded[k].ok));
    const size = await (async () => {
      const doc = await openPdf(stickerPdf);
      const s = await pageSizeMm(doc, 1);
      await doc.close();
      return s;
    })();
    check("ST-3", "лист наклеек — A4", Math.abs(size.width - 210) < 1 && Math.abs(size.height - 297) < 1, size);
    await page.emulateMedia({ media: "screen" });
    await context.close();
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, "e2e-site.json"), JSON.stringify({ checks, decoded }, null, 1));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
