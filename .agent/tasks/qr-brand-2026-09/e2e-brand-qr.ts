/**
 * E2E фирменного QR на живом dev-сервере (AC1, AC4): экран QR-кодов
 * журнала, печать плаката A4 и листа наклеек (включая самый длинный адрес —
 * допуск гигиены по документу), карточка «Личный вход» в окне сотрудника.
 *
 * Печать — настоящий путь Chrome: `page.pdf()` в print-медиа; код на
 * странице PDF растрируется (pdf.js) при 600 dpi «как принтер», а
 * decode-brand-qr.py снимает его камерой при 150/200/300 dpi (чистый, серый,
 * порог, ч/б растр, «телефон», ч/б + телефон) и читает OpenCV и zxing-cpp;
 * jsQR читает те же снимки здесь. Приёмка — как в check-brand-qr.ts.
 * Замер: ширина кода у каждой наклейки (код тянется по месту над текстом).
 *
 * Стенд — `e2e-setup.ts` (своя организация `e2e-org-qrbrand` в локальной
 * базе: руководитель и повар, 8 холодильников, документ гигиены).
 * Запуск: BASE=http://localhost:3049 STATE=<state.json>
 *   QR_DECODER=<jsqr> ZXING_PY=<zxingcpp> npx tsx --env-file=.env .agent/tasks/qr-brand-2026-09/e2e-brand-qr.ts
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3049";
const TASK_DIR = path.join(process.cwd(), ".agent", "tasks", "qr-brand-2026-09");
const SHOTS = path.join(TASK_DIR, "shots");
const RAW = path.join(TASK_DIR, "raw");
const OUT = path.resolve(process.env.QR_BRAND_OUT ?? "C:/wt/qrbrand-tmp/e2e-out");
const state = JSON.parse(fs.readFileSync(process.env.STATE ?? "C:/wt/qrbrand-tmp/e2e/state.json", "utf8")) as {
  password: string;
  manager: string;
  cookId: string;
  hygieneDoc: string;
};

type Jsqr = (data: Uint8ClampedArray, w: number, h: number) => { data: string } | null;
const required = createRequire(__filename)(process.env.QR_DECODER ?? "jsqr") as { default?: Jsqr } & Jsqr;
const jsqr: Jsqr = required.default ?? required;

const checks: { id: string; ok: boolean; what: string; details?: unknown }[] = [];
function check(id: string, what: string, ok: boolean, details?: unknown) {
  checks.push({ id, ok, what, details });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${what}${ok ? "" : ` ${JSON.stringify(details)}`}`);
}

async function login(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    // До гидрации кнопка отправляет форму GET-ом — ждём, пока страница оживёт.
    await page.waitForLoadState("networkidle").catch(() => null);
    await page.waitForTimeout(1500);
    await page.fill("#email", state.manager);
    await page.fill("#password", state.password);
    await page.click('button[type="submit"]').catch(() => null);
    if (await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120_000 }).then(() => true, () => false)) return;
  }
  throw new Error("вход не удался");
}

async function openPosters(page: Page, query: string) {
  await page.goto(`${BASE}/settings/qr-posters?${query}&origin=${encodeURIComponent(BASE)}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.waitForSelector("[data-qr-page]", { timeout: 300_000 });
  await page.waitForSelector("[data-qr-summary]", { timeout: 60_000 });
}

async function cards(page: Page) {
  return page.$$eval("[data-qr-poster]", (nodes) =>
    nodes.map((node) => ({ id: node.getAttribute("data-qr-id") ?? "", url: node.getAttribute("data-qr-url") ?? "", selected: node.getAttribute("data-qr-selected") === "true" }))
  );
}

/** Растр страницы PDF (pdf.js) при dpi — PNG. */
async function rasterPage(pdf: Buffer, pageNo: number, dpi: number, crop?: { x: number; y: number; w: number; h: number }): Promise<Buffer> {
  const { standardFontsDir, workerFileUrl } = await import("@/lib/journal-preview/render");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf), disableWorker: true, isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: standardFontsDir() } as Parameters<typeof pdfjs.getDocument>[0]);
  try {
    const doc = await task.promise;
    const page = await doc.getPage(pageNo);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport } as Parameters<typeof page.render>[0]).promise;
    if (!crop) return canvas.toBuffer("image/png");
    const px = dpi / 25.4;
    const x0 = Math.round(crop.x * px);
    const y0 = Math.round(crop.y * px);
    const w = Math.min(canvas.width - x0, Math.round(crop.w * px));
    const h = Math.min(canvas.height - y0, Math.round(crop.h * px));
    const out = createCanvas(w, h);
    out.getContext("2d").putImageData(ctx.getImageData(x0, y0, w, h), 0, 0);
    return out.toBuffer("image/png");
  } finally {
    await task.destroy();
  }
}

async function jsqrDecode(png: Buffer): Promise<string | null> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height).data;
  return jsqr(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), image.width, image.height)?.data ?? null;
}

type DecodeItem =
  | { id: string; kind: "print"; master: string; captures: number[]; url: string }
  | { id: string; kind: "screen"; file: string; dpi: number; url: string };
const decodeItems: DecodeItem[] = [];
const CAPTURES = [150, 200, 300];
const PRINT_RASTER = new Set(["clean", "gray", "threshold", "dither"]);
/** Приёмка: печать 300 dpi — все снимки спеки, 200 dpi — растр печати; экран ×2; phone-hard — стресс. */
const inAcceptance = (kind: string, dpi: number, transform: string) =>
  transform !== "phone-hard" && (kind === "screen" ? dpi >= 192 : dpi >= 300 || (dpi >= 200 && PRINT_RASTER.has(transform)));

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=swiftshader", "--no-sandbox"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.setDefaultTimeout(120_000);
    await login(page);

    // 1. Экран QR-кодов журнала: превью карточек — новый вид.
    await openPosters(page, "journal=hygiene");
    const list = await cards(page);
    const main = list.find((card) => card.id === "hygiene");
    check("SCR-1", "экран QR-кодов журнала открылся, у основного QR есть адрес", Boolean(main?.url), list.map((c) => c.id));
    const previewSvg = await page.locator('[data-qr-id="hygiene"] .qr-box svg').first().evaluate((svg) => ({
      text: Array.from(svg.querySelectorAll("text"), (t) => t.textContent),
      image: Boolean(svg.querySelector("image")),
      width: svg.getBoundingClientRect().width,
      height: svg.getBoundingClientRect().height,
    }));
    check(
      "SCR-2",
      "превью карточки — фирменный QR: знак сайта и плашка «Отсканировать / wesetup.ru», пропорции плитки",
      previewSvg.image && previewSvg.text.join("|") === "Отсканировать|wesetup.ru" && Math.abs(previewSvg.height / previewSvg.width - 1.185) < 0.02,
      previewSvg
    );
    await page.screenshot({ path: path.join(SHOTS, "posters-screen-1440.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(SHOTS, "posters-screen-390.png"), fullPage: false });
    await page.setViewportSize({ width: 1440, height: 1000 });

    // 2. Печать: основной QR журнала — плакат A4.
    for (const card of list) {
      const selector = `[data-qr-id="${card.id}"]`;
      if (card.id === "hygiene") {
        if (!card.selected) await page.locator(`${selector} input[type=checkbox]`).first().check();
        await page.locator(`${selector} [data-qr-format-option="a4"]`).first().click();
      } else if (card.selected) {
        await page.locator(`${selector} input[type=checkbox]`).first().uncheck();
      }
    }
    await page.waitForFunction((url) => Array.from(document.querySelectorAll("[data-qr-print-url]")).some((n) => n.getAttribute("data-qr-print-url") === url && n.getAttribute("data-qr-print-mm") === "105"), main!.url);
    await page.emulateMedia({ media: "print" });
    const a4 = page.locator('[data-qr-sheet="a4"]').first();
    const a4Code = await a4.locator("svg").first().evaluate((svg) => {
      const r = svg.getBoundingClientRect();
      return { widthMm: (r.width * 25.4) / 96, heightMm: (r.height * 25.4) / 96 };
    });
    check("PR-1", "плакат A4: код 105 мм по ширине, плитка с плашкой (≈ 124 мм)", Math.abs(a4Code.widthMm - 105) < 0.5 && Math.abs(a4Code.heightMm - 105 * 1.185) < 1, a4Code);
    const a4Overflow = await a4.evaluate((sheet) => {
      const box = sheet.getBoundingClientRect();
      const last = sheet.querySelector(".qrp-a4")?.lastElementChild?.getBoundingClientRect();
      return { sheetBottom: box.bottom, lastBottom: last?.bottom ?? 0 };
    });
    check("PR-2", "плакат A4 целиком на листе (последняя строка выше низа листа 250 мм)", a4Overflow.lastBottom <= a4Overflow.sheetBottom, a4Overflow);
    await a4.screenshot({ path: path.join(SHOTS, "print-a4-poster.png") });
    // Где код на листе (мм от угла листа; у страницы PDF ещё поля 10 мм).
    // Без вложенных функций: esbuild добавил бы в код для браузера свой __name.
    const a4Box = await a4.evaluate((sheet) => {
      const s = sheet.getBoundingClientRect();
      const c = sheet.querySelector("svg")!.getBoundingClientRect();
      const k = 25.4 / 96;
      return { x: (c.left - s.left) * k, y: (c.top - s.top) * k, w: c.width * k, h: c.height * k };
    });
    const a4Pdf = await page.pdf({ preferCSSPageSize: true, printBackground: false });
    fs.writeFileSync(path.join(OUT, "a4.pdf"), a4Pdf);
    for (const dpi of [150, 200, 300]) {
      const png = await rasterPage(a4Pdf, 1, dpi);
      check(`PR-3@${dpi}`, `печать Chrome (PDF) плаката A4, вся страница при ${dpi} dpi — jsQR читает адрес`, (await jsqrDecode(png)) === main!.url);
    }
    const a4Master = path.join(OUT, "a4-code@600.png");
    fs.writeFileSync(a4Master, await rasterPage(a4Pdf, 1, 600, { x: 10 + a4Box.x - 8, y: 10 + a4Box.y - 8, w: a4Box.w + 16, h: a4Box.h + 16 }));
    decodeItems.push({ id: "print-pdf-a4", kind: "print", master: a4Master, captures: CAPTURES, url: main!.url });
    await page.emulateMedia({ media: "screen" });

    // 3. Лист наклеек: холодильники + самый длинный адрес (допуск гигиены по документу).
    const verifyId = `hygiene@verify:${state.hygieneDoc}`;
    await openPosters(page, `kind=journals&layout=sheet&ids=${encodeURIComponent([verifyId, `hygiene:${state.hygieneDoc}`].join(","))}`);
    const journalCards = await cards(page);
    await openPosters(page, "kind=equipment&layout=sheet");
    const objectCards = await cards(page);
    check("ST-1", "наклейки холодильников отмечены по умолчанию", objectCards.filter((c) => c.selected).length >= 8, objectCards.length);
    // Лист смешанный: печатаем по очереди два экрана — журнальные наклейки и объекты.
    const stickerRuns: { name: string; query: string; expected: { id: string; url: string }[] }[] = [
      { name: "objects", query: "kind=equipment&layout=sheet", expected: objectCards.filter((c) => c.selected) },
      {
        name: "journal",
        query: `kind=journals&layout=sheet&ids=${encodeURIComponent([verifyId, `hygiene:${state.hygieneDoc}`].join(","))}`,
        expected: journalCards.filter((c) => c.selected),
      },
    ];
    const stickerWidths: { name: string; id: string; widthMm: number; heightMm: number; url: string; title: string }[] = [];
    for (const run of stickerRuns) {
      await openPosters(page, run.query);
      await page.emulateMedia({ media: "print" });
      const measured = await page.$$eval(".qrp-sticker", (nodes) =>
        nodes.map((node) => {
          const code = node.querySelector("[data-qr-print-code]");
          const svg = code?.querySelector("svg")?.getBoundingClientRect();
          const box = node.getBoundingClientRect();
          const inner = Array.from(node.children).map((child) => child.getBoundingClientRect());
          return {
            url: code?.getAttribute("data-qr-print-url") ?? "",
            title: node.querySelector(".qrp-sticker-title")?.textContent ?? "",
            widthMm: ((svg?.width ?? 0) * 25.4) / 96,
            heightMm: ((svg?.height ?? 0) * 25.4) / 96,
            overflow: inner.some((r) => r.bottom > box.bottom - 0.5 || r.top < box.top + 0.5),
          };
        })
      );
      for (const m of measured) stickerWidths.push({ name: run.name, id: run.expected.find((c) => c.url === m.url)?.id ?? "?", widthMm: +m.widthMm.toFixed(2), heightMm: +m.heightMm.toFixed(2), url: m.url, title: m.title });
      check(
        `ST-2-${run.name}`,
        `наклейки (${run.name}): код 29–36 мм по ширине, пропорция плитки сохранена, текст не вылезает за наклейку`,
        measured.length > 0 && measured.every((m) => m.widthMm >= 28.95 && m.widthMm <= 36.05 && Math.abs(m.heightMm / m.widthMm - 1.185) < 0.02 && !m.overflow),
        measured
      );
      const sheet = page.locator('[data-qr-sheet="sticker"]').first();
      await sheet.screenshot({ path: path.join(SHOTS, `print-stickers-${run.name}.png`) });
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: false });
      fs.writeFileSync(path.join(OUT, `stickers-${run.name}.pdf`), pdf);
      // Ячейки листа: поля 10 мм, 3 колонки по (190 − 2·3)/3 мм, строки по 60 мм, зазор 3 мм.
      const colW = (190 - 6) / 3;
      for (let index = 0; index < measured.length; index += 1) {
        const cell = { x: 10 + (index % 3) * (colW + 3), y: 10 + Math.floor(index / 3) * 63, w: colW, h: 60 };
        const master = path.join(OUT, `sticker-${run.name}-${index}@600.png`);
        fs.writeFileSync(master, await rasterPage(pdf, 1, 600, cell));
        decodeItems.push({ id: `print-pdf-sticker-${run.name}-${index}`, kind: "print", master, captures: CAPTURES, url: measured[index].url });
      }
      await page.emulateMedia({ media: "screen" });
    }
    fs.writeFileSync(path.join(RAW, "sticker-widths.json"), JSON.stringify(stickerWidths, null, 2));
    const longest = stickerWidths.reduce((a, b) => (b.url.length > a.url.length ? b : a));
    check("ST-3", `самый длинный адрес (${longest.url.length} симв.) на наклейке: ширина кода ${longest.widthMm} мм`, longest.url.includes("view=all"), longest);

    // 4. «Личный вход»: окно сотрудника → выпустить QR → карточка с фирменным QR.
    await page.goto(`${BASE}/staff`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    // Ближайший к имени предок с кнопкой «Изменить» — строка этого сотрудника.
    const edit = page.locator(
      'xpath=//*[normalize-space(text())="Пётр Повар"]/ancestor::*[.//*[@aria-label="Редактировать сотрудника"]][1]//*[@aria-label="Редактировать сотрудника"]'
    );
    await page.waitForLoadState("networkidle").catch(() => null);
    await edit.first().click({ timeout: 180_000 });
    const card = page.locator('[data-testid="personal-qr-card"]');
    await card.waitFor({ timeout: 60_000 });
    await card.locator('[data-testid="personal-qr-issue"]').click();
    const qrBox = card.locator("svg").filter({ has: page.locator("image") }).first();
    await qrBox.waitFor({ timeout: 60_000 });
    await page.waitForTimeout(300);
    const loginSvg = await qrBox.evaluate((svg) => ({ width: svg.getBoundingClientRect().width, height: svg.getBoundingClientRect().height, text: Array.from(svg.querySelectorAll("text"), (t) => t.textContent) }));
    const loginUrl = (await card.locator(".break-all").first().textContent())?.trim() ?? "";
    check("LG-1", "карточка «Личный вход»: фирменный QR 180 px по ширине, плашка «Отсканировать»", Math.abs(loginSvg.width - 180) < 1 && loginSvg.text.includes("Отсканировать"), loginSvg);
    await card.screenshot({ path: path.join(SHOTS, "personal-login-card.png") });
    for (const scale of [1, 2]) {
      const hi = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: scale, storageState: await context.storageState() });
      const hiPage = await hi.newPage();
      await hiPage.setContent(`<html><body style="margin:0;background:#fff"><div id="c" style="display:inline-block;padding:24px">${await qrBox.evaluate((svg) => svg.outerHTML)}</div></body></html>`);
      await hiPage.waitForTimeout(200);
      const file = path.join(OUT, `login-screen@${scale * 96}.png`);
      await hiPage.locator("#c").screenshot({ path: file });
      decodeItems.push({ id: `screen-login-card@${scale * 96}`, kind: "screen", file, dpi: scale * 96, url: loginUrl });
      check(`LG-2@x${scale}`, `QR входа с экрана (плотность ×${scale}) — jsQR читает выданную ссылку`, (await jsqrDecode(fs.readFileSync(file))) === loginUrl, loginUrl);
      await hi.close();
    }
    await context.close();
  } finally {
    await browser.close();
  }

  // Второй и третий декодеры по тем же файлам (чистый / серый / порог / растр / телефон).
  const python = spawnSync(process.env.PYTHON ?? "python", [path.join(TASK_DIR, "decode-brand-qr.py")], {
    input: JSON.stringify({ out: path.join(OUT, "transformed"), items: decodeItems }),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: process.env,
  });
  if (python.status !== 0) throw new Error(`decode-brand-qr.py: ${python.stderr}`);
  const rows = JSON.parse(python.stdout) as { id: string; dpi: number; transform: string; file: string; cv: boolean; zx: boolean }[];
  const decoded = [];
  for (const row of rows) {
    const item = decodeItems.find((i) => i.id === row.id)!;
    const jsqr = (await jsqrDecode(fs.readFileSync(row.file))) === item.url;
    decoded.push({ ...row, kind: item.kind, jsqr, twoOfThree: [jsqr, row.cv, row.zx].filter(Boolean).length >= 2, acceptance: inAcceptance(item.kind, row.dpi, row.transform) });
  }
  const pct = (field: "jsqr" | "cv" | "zx" | "twoOfThree", list: typeof decoded) => `${list.filter((r) => r[field]).length}/${list.length}`;
  const accepted = decoded.filter((r) => r.acceptance);
  const stress = decoded.filter((r) => !r.acceptance);
  console.log(`E2E приёмка (печать 300 dpi — все снимки, 200 dpi — растр печати, экран ×2): jsQR ${pct("jsqr", accepted)}, OpenCV ${pct("cv", accepted)}, zxing-cpp ${pct("zx", accepted)}`);
  console.log(`E2E стресс (150 dpi, «телефон» при 200 dpi, экран ×1, phone-hard): jsQR ${pct("jsqr", stress)}, OpenCV ${pct("cv", stress)}, zxing-cpp ${pct("zx", stress)}, ≥ 2 из 3 — ${pct("twoOfThree", stress)}`);
  check(
    "DEC-1",
    "печать Chrome (PDF) и экран: приёмочный набор читают jsQR и zxing-cpp — 100 %",
    accepted.every((r) => r.jsqr && r.zx),
    accepted.filter((r) => !r.jsqr || !r.zx).map((r) => `${r.id}@${r.dpi}/${r.transform}`)
  );
  fs.writeFileSync(path.join(RAW, "e2e-decode.json"), JSON.stringify(decoded, null, 2));
  fs.writeFileSync(path.join(RAW, "e2e-checks.json"), JSON.stringify(checks, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
