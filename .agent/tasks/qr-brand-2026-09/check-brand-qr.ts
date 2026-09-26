/**
 * Проверка распознавания фирменного QR (AC2 спеки qr-brand-2026-09).
 *
 * Для каждого места выдачи QR — настоящий адрес того же вида, что выдаёт
 * продукт, и настоящий путь отрисовки на реальном размере. Печатные места
 * рисуются один раз «как принтер» — 600 dpi:
 *   • SVG (плакаты A4/A5, наклейки, лист проверяющих, карточка входа) —
 *     Chromium рисует SVG помощника в мм;
 *   • PNG печатного окна (QR-регистрация) — <img> в CSS px;
 *   • PDF (сертификат, угловой QR журнала и шаблона) — jsPDF → pdf.js,
 *     вырезка вокруг кода;
 *   • Word (подвал шаблона) — .docx → LibreOffice → PDF → pdf.js.
 * decode-brand-qr.py снимает этот «лист» камерой при 150/200/300 dpi
 * (чистый снимок, оттенки серого, порог, ч/б лазерный растр, «телефон» с
 * поворотом, наклоном, размытием и JPEG, ч/б + телефон) и читает каждый
 * снимок OpenCV и zxing-cpp; здесь те же файлы читает jsQR. Экранные места
 * (окна, превью, QR входа на экране) — <img>/SVG в CSS px при плотности
 * экрана ×1/×2/×3. Успех — строка декодера ровно равна адресу.
 *
 * Запуск (из корня репо):
 *   QR_DECODER=<путь к jsqr> ZXING_PY=<папка с zxingcpp> [SOFFICE=<soffice.exe>] \
 *     npx tsx --env-file=.env .agent/tasks/qr-brand-2026-09/check-brand-qr.ts
 * QR_BRAND_OUT — папка для растров (по умолчанию C:/wt/qrbrand-tmp/check, вне репо);
 * STICKER_MIN_MM — самая узкая наклейка (код в наклейке тянется по месту над текстом).
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { createCanvas, loadImage } from "@napi-rs/canvas";

// Адреса — как на проде: личный вход и QR проверяющих берут домен из NEXTAUTH_URL при импорте.
process.env.NEXTAUTH_URL = "https://wesetup.ru";
process.env.TELEGRAM_BOT_USERNAME ||= "wesetupbot";

const ORIGIN = "https://wesetup.ru";
const TASK_DIR = path.join(process.cwd(), ".agent", "tasks", "qr-brand-2026-09");
const OUT = path.resolve(process.env.QR_BRAND_OUT ?? "C:/wt/qrbrand-tmp/check");
const RAW_DIR = path.join(TASK_DIR, "raw");
const CAPTURE_DPI = [150, 200, 300];
const MASTER_DPI = 600;
/** Наклейка: код тянется по месту над текстом, 29–36 мм (qr-print-sheets.tsx). */
const STICKER_MIN_MM = Number(process.env.STICKER_MIN_MM ?? 29);
const STICKER_MAX_MM = 36;
const SOFFICE = process.env.SOFFICE ?? "C:/Program Files/LibreOffice/program/soffice.exe";

type Kind = "print" | "screen";
type Source =
  | { type: "svg"; svg: string; widthMm: number }
  | { type: "html"; html: string; widthPx: number }
  | { type: "img"; dataUrl: string; widthPx: number }
  | { type: "pdf"; pdf: Buffer; crop: { x: number; y: number; w: number; h: number } };
type Variant = {
  id: string;
  place: string;
  size: string;
  kind: Kind;
  url: string;
  source: Source;
  /** Экран — плотности ×1/×2/×3 (96/192/288 dpi); печать рисуется при 600 dpi. */
  densities: number[];
  note?: string;
  /** Ширина плитки кода: мм (печать) или CSS px (экран); `matrix` — размер только матрицы (угловой QR). */
  width: { mm?: number; px?: number; matrix?: boolean };
  /** Сторона модуля: мм на бумаге / CSS px на экране (считается по раскладке). */
  module?: number;
  /** Прежний вид (до фирменного QR) — для сравнения, в приёмку не входит. */
  baseline?: boolean;
  /** Опыт для решения (угловой QR с логотипом) — в приёмку не входит. */
  experiment?: boolean;
};

const cuid = (seed: string) => `cm${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 23)}`;

async function buildVariants(): Promise<Variant[]> {
  const { brandQrLayout, brandQrPngDataUrl, brandQrSvg } = await import("@/lib/brand-qr");
  const { qrFillUrl } = await import("@/lib/qr-fill-poster");
  const { journalFillSubject } = await import("@/lib/journal-fill");
  const { personalLoginUrl } = await import("@/lib/personal-login");
  const { inspectorQrUrl } = await import("@/lib/inspector-qr-service");
  const { buildTelegramInviteUrl } = await import("@/lib/staff-telegram-invite");
  const { generateBotInviteRaw } = await import("@/lib/bot-invite-tokens");
  const { generateInviteToken } = await import("@/lib/invite-tokens");
  const { blankPdfQr, blankQrUrl } = await import("@/lib/blank-qr-token");
  const { journalDocumentPdfQr } = await import("@/lib/journal-pdf-qr-link");
  const { renderJournalDocumentPdf } = await import("@/lib/document-pdf");
  const { buildJournalSampleInput } = await import("@/lib/journal-sample-fixtures");
  const { renderJournalDocumentDocx } = await import("@/lib/document-docx");
  const { jsPDF } = await import("jspdf");

  const org = cuid("org");
  const urls = {
    journalMain: qrFillUrl(ORIGIN, "journal", journalFillSubject(org, "hygiene")),
    // Самый длинный адрес продукта: допуск гигиены по документу до конца периода (+ &view=all).
    journalLongest:
      qrFillUrl(ORIGIN, "journal", journalFillSubject(org, "hygiene", cuid("doc"), { validUntil: "2026-09-30" })) + "&view=all",
    equipment: qrFillUrl(ORIGIN, "equipment", cuid("fridge")),
    personal: personalLoginUrl(crypto.randomBytes(24).toString("base64url")),
    inspector: inspectorQrUrl(cuid("inspector")),
    tgInvite: buildTelegramInviteUrl(process.env.TELEGRAM_BOT_USERNAME ?? "wesetupbot", generateBotInviteRaw()),
    pair: `${ORIGIN}/pair/${generateInviteToken()}`,
    join: `${ORIGIN}/join/${generateInviteToken()}`,
    kiosk: `${ORIGIN}/api/kiosk/claim/${generateInviteToken()}`,
    landing: "https://wesetup.ru/#qr",
  };
  const blankTarget = { kind: "code", code: "hygiene" } as const;
  // Самая длинная почта, что помещается в QR шаблона (как в blanks-email-gate-2026-09).
  const blankEmail = "zaveduyushchaya.proizv@kombinat-pita.ru";

  const variants: Variant[] = [];
  const svgVariant = async (id: string, place: string, url: string, widthMm: number, note?: string) => {
    variants.push({ id, place, size: `${widthMm} мм`, kind: "print", url, source: { type: "svg", svg: await brandQrSvg(url), widthMm }, densities: [], note, width: { mm: widthMm } });
  };
  await svgVariant("poster-a4", "Плакат A4 журнала (основной QR)", urls.journalMain, 105);
  await svgVariant("poster-a4-longest", "Плакат A4, самый длинный адрес (допуск гигиены по документу)", urls.journalLongest, 105);
  await svgVariant("poster-a5-longest", "Плакат A5, самый длинный адрес", urls.journalLongest, 78);
  await svgVariant("sticker-object", "Наклейка на холодильник (A4, 12 на листе)", urls.equipment, STICKER_MAX_MM);
  await svgVariant("sticker-longest-min", "Наклейка, самый длинный адрес, самая узкая", urls.journalLongest, STICKER_MIN_MM, "нижняя граница кода наклейки");
  await svgVariant("inspector-sheet", "Лист A4 «Для проверяющих»", urls.inspector, 80);
  await svgVariant("personal-card", "Карточка «Личный вход» (печать)", urls.personal, 70);
  // Для сравнения — прежний вид (библиотека qrcode, M, поле 1 модуль) той же самой длинной наклейки 34 мм.
  const QRCode = (await import("qrcode")).default;
  variants.push({
    id: "baseline-sticker-old",
    place: "Для сравнения: прежняя наклейка (M, без логотипа), самый длинный адрес",
    size: "34 мм",
    kind: "print",
    url: urls.journalLongest,
    source: { type: "svg", svg: await QRCode.toString(urls.journalLongest, { type: "svg", errorCorrectionLevel: "M", margin: 1, width: 600 }), widthMm: 34 },
    densities: [],
    width: { mm: 34 },
    baseline: true,
  });

  // Печать окна QR-регистрации: <img> 320 CSS px = 84,7 мм.
  const joinPng = await brandQrPngDataUrl(urls.join, { width: 640 });
  variants.push({
    id: "join-print",
    place: "QR-регистрация сотрудника (печать окна)",
    size: "320 CSS px = 84,7 мм",
    kind: "print",
    url: urls.join,
    source: { type: "img", dataUrl: joinPng, widthPx: 320 },
    densities: [],
    width: { mm: (320 * 25.4) / 96 },
  });

  // Сертификат: PNG помощника в jsPDF, как в /api/certificate (50 мм, верх 187 мм).
  const certPng = await brandQrPngDataUrl(urls.inspector, { width: 1000 });
  const cert = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const certProps = cert.getImageProperties(certPng);
  const certH = (50 * certProps.height) / certProps.width;
  cert.addImage(certPng, "PNG", 80, 187, 50, certH);
  variants.push({
    id: "certificate",
    place: "Сертификат соответствия (PDF, A4)",
    size: "50 мм",
    kind: "print",
    url: urls.inspector,
    source: { type: "pdf", pdf: Buffer.from(cert.output("arraybuffer")), crop: { x: 74, y: 181, w: 62, h: certH + 12 } },
    densities: [],
    width: { mm: 50 },
  });

  // Угловой QR журнала: настоящий PDF документа (короткий адрес /qj/…).
  const journalQr = journalDocumentPdfQr(ORIGIN, org, "hygiene");
  const journal = renderJournalDocumentPdf({ ...buildJournalSampleInput("hygiene"), qr: journalQr });
  const jp = journal.qrPlacements![0];
  variants.push({
    id: "journal-corner",
    place: "Угловой QR печатного журнала (компактный)",
    size: `${jp.size} мм`,
    kind: "print",
    url: journalQr.url,
    source: { type: "pdf", pdf: journal.buffer, crop: { x: jp.x - 3, y: jp.y - 3, w: jp.size + 6, h: jp.size + 6 } },
    densities: [],
    width: { mm: jp.size, matrix: true },
  });
  // Угловой QR скачанного шаблона: /qb/<токен> с самой длинной почтой — самый плотный.
  const blankQr = blankPdfQr(ORIGIN, { target: blankTarget, email: blankEmail });
  const blank = renderJournalDocumentPdf({ ...buildJournalSampleInput("hygiene"), qr: blankQr });
  const bp = blank.qrPlacements![0];
  variants.push({
    id: "blank-corner",
    place: "Угловой QR шаблона PDF (компактный, самая длинная почта)",
    size: `${bp.size} мм`,
    kind: "print",
    url: blankQr.url,
    source: { type: "pdf", pdf: blank.buffer, crop: { x: bp.x - 3, y: bp.y - 3, w: bp.size + 6, h: bp.size + 6 } },
    densities: [],
    width: { mm: bp.size, matrix: true },
  });

  // Опыт (AC3): те же угловые коды 13 мм, но с логотипом (коррекция H, без плашки —
  // подпись у штампа своя). Матрица 13 мм, как у штампа; тихая зона — поле листа.
  for (const [id, url, label] of [
    ["experiment-corner-logo-journal", journalQr.url, "журнала"],
    ["experiment-corner-logo-blank", blankQr.url, "шаблона (самая длинная почта)"],
  ] as const) {
    const layout = brandQrLayout(url, { caption: false });
    variants.push({
      id,
      place: `Опыт: угловой QR ${label} С ЛОГОТИПОМ (H)`,
      size: "13 мм (матрица)",
      kind: "print",
      url,
      source: { type: "svg", svg: await brandQrSvg(url, { caption: false }), widthMm: (13 * layout.width) / layout.size },
      densities: [],
      width: { mm: 13, matrix: true },
      experiment: true,
    });
  }

  // Word: подвал шаблона → LibreOffice → PDF (правый нижний угол листа).
  const docxUrl = blankQrUrl(ORIGIN, { target: blankTarget, email: blankEmail }).url;
  const docx = await renderJournalDocumentDocx(buildJournalSampleInput("hygiene"), "hygiene", {
    footer: { qrUrl: docxUrl, lines: ["Заполнять с телефона — wesetup.ru", "© WeSetup"] },
  });
  const docxDir = path.join(OUT, "docx");
  fs.mkdirSync(docxDir, { recursive: true });
  const docxFile = path.join(docxDir, "blank-hygiene.docx");
  fs.writeFileSync(docxFile, docx.buffer);
  const converted = spawnSync(SOFFICE, ["--headless", "--convert-to", "pdf", "--outdir", docxDir, docxFile], { encoding: "utf8", timeout: 180_000 });
  const docxPdf = path.join(docxDir, "blank-hygiene.pdf");
  if (!fs.existsSync(docxPdf)) throw new Error(`LibreOffice не сконвертировал docx: ${converted.stderr || converted.stdout}`);
  variants.push({
    id: "docx-footer",
    place: "Подвал шаблона Word (компактный, через LibreOffice)",
    size: "18 мм",
    kind: "print",
    url: docxUrl,
    source: { type: "pdf", pdf: fs.readFileSync(docxPdf), crop: { x: 120, y: 245, w: 90, h: 52 } },
    densities: [],
    width: { mm: 18 },
  });

  // Экран: CSS px × плотность экрана.
  const screenPng = async (id: string, place: string, url: string, css: number, width: number) => {
    variants.push({
      id,
      place,
      size: `${css} CSS px`,
      kind: "screen",
      url,
      source: { type: "img", dataUrl: await brandQrPngDataUrl(url, { width }), widthPx: css },
      densities: [1, 2, 3],
      width: { px: css },
    });
  };
  const personalSvg = await brandQrSvg(urls.personal);
  variants.push({
    id: "login-screen",
    place: "QR входа на экране (карточка сотрудника)",
    size: "180 CSS px",
    kind: "screen",
    url: urls.personal,
    source: { type: "html", html: fluidSvg(personalSvg), widthPx: 180 },
    densities: [1, 2, 3],
    width: { px: 180 },
  });
  await screenPng("tg-invite", "Приглашение в Telegram (окно сотрудника)", urls.tgInvite, 220, 440);
  await screenPng("tg-invite-thumb", "Приглашение в Telegram (миниатюра в «Доступе»)", urls.tgInvite, 128, 440);
  await screenPng("pair", "Сопряжение (показ с телефона руководителя)", urls.pair, 280, 560);
  await screenPng("join-dialog", "QR-регистрация (окно)", urls.join, 260, 640);
  await screenPng("kiosk", "Планшет-киоск (окно)", urls.kiosk, 220, 600);
  variants.push({
    id: "poster-preview-dialog",
    place: "Превью в окне строки журнала (плакат)",
    size: "184 CSS px",
    kind: "screen",
    url: urls.equipment,
    source: { type: "html", html: fluidSvg(await brandQrSvg(urls.equipment)), widthPx: 184 },
    densities: [1, 2, 3],
    width: { px: 184 },
  });
  const landingSvg = await brandQrSvg(urls.landing, { caption: false });
  variants.push({
    id: "landing-sticker",
    place: "Золотая наклейка лендинга",
    size: "240 CSS px",
    kind: "screen",
    url: urls.landing,
    source: {
      type: "html",
      widthPx: 240,
      html: `<div style="font-size:30px;width:240px"><div style="border-radius:0.95em;padding:0.42em;background:linear-gradient(135deg,#fff3c4 0%,#fcd34d 40%,#f5b301 75%,#dc9d00 100%)"><div style="background:#fff;border-radius:0.6em;padding:0.4em">${fluidSvg(landingSvg)}</div><div style="margin-top:0.35em;color:#5b3a00;font-weight:700;font-size:0.66em;text-align:center">Отсканируйте</div></div></div>`,
    },
    densities: [1, 2],
    // Код внутри наклейки: 240 − 2·0,42em − 2·0,4em при кегле 30 px.
    width: { px: 240 - 2 * 0.42 * 30 - 2 * 0.4 * 30 },
  });

  for (const v of variants) {
    if (v.baseline) {
      const old = QRCode.create(v.url, { errorCorrectionLevel: "M" });
      v.module = (v.width.mm ?? 0) / (old.modules.size + 2);
      v.note = `M, v${old.version}, ${old.modules.size} мод.; ${v.module.toFixed(2)} мм/мод.`;
      continue;
    }
    const variant = (v.id.includes("corner") && !v.experiment) || v.id === "docx-footer" ? "compact" : "full";
    const layout = brandQrLayout(v.url, { variant, caption: v.id !== "landing-sticker" && !v.experiment });
    const across = v.width.matrix ? layout.size : layout.width;
    v.module = (v.width.mm ?? v.width.px ?? 0) / across;
    const moduleText = v.width.mm ? `${v.module.toFixed(2)} мм/мод.` : `${v.module.toFixed(1)} CSS px/мод.`;
    v.note = [v.note, `${layout.errorCorrection}, v${layout.version}, ${layout.size} мод.; ${moduleText}`].filter(Boolean).join("; ");
  }
  return variants;
}

function fluidSvg(svg: string): string {
  return svg.replace(/ width="\d+" height="\d+"/, ' style="display:block;width:100%;height:auto"');
}

// ---------------------------------------------------------------------------

/** Печать — один «лист» 600 dpi (снимки 150/200/300 dpi делает decode-brand-qr.py); экран — по плотности. */
type Raster = { key: string; variant: Variant; kind: Kind; dpi: number; file: string };

async function rasterizePdf(pdf: Buffer, dpi: number, crop: { x: number; y: number; w: number; h: number }, file: string) {
  const { standardFontsDir, workerFileUrl } = await import("@/lib/journal-preview/render");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  const task = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: standardFontsDir(),
  } as Parameters<typeof pdfjs.getDocument>[0]);
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport } as Parameters<typeof page.render>[0]).promise;
    const px = dpi / 25.4;
    const x0 = Math.max(0, Math.round(crop.x * px));
    const y0 = Math.max(0, Math.round(crop.y * px));
    const w = Math.min(canvas.width - x0, Math.round(crop.w * px));
    const h = Math.min(canvas.height - y0, Math.round(crop.h * px));
    const out = createCanvas(w, h);
    out.getContext("2d").putImageData(ctx.getImageData(x0, y0, w, h), 0, 0);
    fs.writeFileSync(file, out.toBuffer("image/png"));
  } finally {
    await task.destroy();
  }
}

async function rasterizeAll(variants: Variant[]): Promise<Raster[]> {
  const { chromium } = await import("playwright");
  const dir = path.join(OUT, "raster");
  fs.mkdirSync(dir, { recursive: true });
  const rasters: Raster[] = [];
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=swiftshader", "--no-sandbox"] });
  try {
    for (const v of variants) {
      // Печать: один проход при 600 dpi; экран: CSS px × плотность.
      const passes = v.kind === "print" ? [MASTER_DPI] : v.densities.map((density) => density * 96);
      for (const dpi of passes) {
        const file = path.join(dir, `${v.id}@${dpi}.png`);
        if (v.source.type === "pdf") {
          await rasterizePdf(v.source.pdf, dpi, v.source.crop, file);
        } else {
          const context = await browser.newContext({ deviceScaleFactor: dpi / 96, viewport: { width: 1200, height: 1600 } });
          const page = await context.newPage();
          const body =
            v.source.type === "svg"
              ? `<div style="width:${v.source.widthMm}mm">${fluidSvg(v.source.svg)}</div>`
              : v.source.type === "img"
                ? `<img src="${v.source.dataUrl}" style="display:block;width:${v.source.widthPx}px;height:auto">`
                : `<div style="width:${v.source.widthPx}px">${v.source.html}</div>`;
          // Поле вокруг — белый лист (6 мм), как вокруг кода на бумаге и в окне.
          await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff"><div id="c" style="display:inline-block;padding:6mm;background:#fff">${body}</div></body></html>`);
          // Картинки (и знак сайта внутри SVG) — раскодированы до снимка.
          await page.evaluate(async () => {
            const hrefs = [
              ...Array.from(document.images, (img) => img.src),
              ...Array.from(document.querySelectorAll("image"), (img) => img.getAttribute("href") ?? ""),
            ].filter(Boolean);
            await Promise.all(
              hrefs.map((href) => {
                const img = new Image();
                img.src = href;
                return img.decode().catch(() => null);
              })
            );
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          });
          await page.locator("#c").screenshot({ path: file });
          await context.close();
        }
        rasters.push({ key: v.kind === "print" ? v.id : `${v.id}@${dpi}`, variant: v, kind: v.kind, dpi, file });
      }
    }
  } finally {
    await browser.close();
  }
  return rasters;
}

type Jsqr = (data: Uint8ClampedArray, w: number, h: number) => { data: string } | null;

const PRINT_RASTER = new Set(["clean", "gray", "threshold", "dither"]);

/**
 * Приёмочный набор (AC2): печать — снимок 300 dpi (так видит код телефон в
 * 10–15 см) со всеми преобразованиями спеки: чистый, серый, порог, ч/б
 * растр, «телефон» (поворот + лёгкое размытие) и ч/б + телефон; снимок
 * 200 dpi — растр печати (чистый, серый, порог, ч/б растр); экран —
 * плотность ×2 и ×3. Остальное — стресс: 150 dpi, «телефон» при 200 dpi,
 * экран ×1 и `phone-hard` (жёстче спеки: наклон, шум, JPEG 75).
 */
function acceptance(variant: Variant, dpi: number, transform: string): boolean {
  if (variant.baseline || variant.experiment || transform === "phone-hard") return false;
  if (variant.kind === "screen") return dpi >= 192;
  if (dpi >= 300) return true;
  return dpi >= 200 && PRINT_RASTER.has(transform);
}

async function main() {
  if (!process.env.QR_DECODER) throw new Error("QR_DECODER=<путь к jsqr> обязателен");
  const required = createRequire(__filename)(process.env.QR_DECODER) as { default?: Jsqr } & Jsqr;
  const jsqr: Jsqr = required.default ?? required;
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const variants = await buildVariants();
  const rasters = await rasterizeAll(variants);
  const job = {
    out: path.join(OUT, "transformed"),
    items: rasters.map((r) =>
      r.kind === "print"
        ? { id: r.key, kind: "print", master: r.file, captures: CAPTURE_DPI, url: r.variant.url }
        : { id: r.key, kind: "screen", file: r.file, dpi: r.dpi, url: r.variant.url }
    ),
  };
  const python = spawnSync(process.env.PYTHON ?? "python", [path.join(TASK_DIR, "decode-brand-qr.py")], {
    input: JSON.stringify(job),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: process.env,
  });
  if (python.status !== 0) throw new Error(`decode-brand-qr.py: ${python.stderr}`);
  const cvRows = JSON.parse(python.stdout) as { id: string; dpi: number; transform: string; file: string; cv: boolean; cvHow: string | null; zx: boolean }[];

  const results = [];
  for (const row of cvRows) {
    const raster = rasters.find((r) => r.key === row.id)!;
    const variant = raster.variant;
    const image = await loadImage(fs.readFileSync(row.file));
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, image.width, image.height).data;
    const js = jsqr(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), image.width, image.height)?.data === variant.url;
    const pxPerModule = variant.kind === "print" ? ((variant.module ?? 0) * row.dpi) / 25.4 : ((variant.module ?? 0) * row.dpi) / 96;
    results.push({
      variant: variant.id,
      place: variant.place,
      size: variant.size,
      kind: variant.kind,
      note: variant.note,
      baseline: Boolean(variant.baseline),
      experiment: Boolean(variant.experiment),
      dpi: row.dpi,
      pxPerModule: +pxPerModule.toFixed(2),
      transform: row.transform,
      jsqr: js,
      opencv: row.cv,
      opencvHow: row.cvHow,
      zxing: row.zx,
      twoOfThree: [js, row.cv, row.zx].filter(Boolean).length >= 2,
      acceptance: acceptance(variant, row.dpi, row.transform),
      urlLength: variant.url.length,
    });
  }

  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.writeFileSync(path.join(RAW_DIR, "decode-results.json"), JSON.stringify(results, null, 2));

  // Сводная таблица: место × dpi снимка — сколько снимков прочитал каждый декодер.
  const lines: string[] = [];
  lines.push("| Место | Размер | Код | dpi снимка | px/модуль | jsQR | OpenCV | zxing-cpp | ≥ 2 из 3 |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  const byKey = new Map<string, typeof results>();
  for (const r of results) {
    const key = `${r.variant}@${r.dpi}`;
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  for (const [, rows] of byKey) {
    const first = rows[0];
    const count = (field: "jsqr" | "opencv" | "zxing" | "twoOfThree") => {
      const ok = rows.filter((r) => r[field]).length;
      const failed = rows.filter((r) => !r[field]).map((r) => r.transform);
      return `${ok}/${rows.length}${failed.length ? ` (нет: ${failed.join(", ")})` : ""}`;
    };
    const dpiLabel = first.kind === "screen" ? `экран ×${first.dpi / 96}` : String(first.dpi);
    lines.push(
      `| ${first.place} | ${first.size} | ${first.note} | ${dpiLabel} | ${first.pxPerModule.toFixed(1)} | ${count("jsqr")} | ${count("opencv")} | ${count("zxing")} | ${count("twoOfThree")} |`
    );
  }
  const summarize = (label: string, list: typeof results) => {
    const n = list.length;
    const sum = (field: "jsqr" | "opencv" | "zxing" | "twoOfThree") => list.filter((r) => r[field]).length;
    return `${label}: ${n} снимков; jsQR ${sum("jsqr")}/${n}, OpenCV ${sum("opencv")}/${n}, zxing-cpp ${sum("zxing")}/${n}, ≥ 2 из 3 — ${sum("twoOfThree")}/${n}`;
  };
  const own = results.filter((r) => !r.baseline && !r.experiment);
  const accepted = own.filter((r) => r.acceptance);
  const stress = own.filter((r) => !r.acceptance);
  lines.push(
    "",
    summarize("Приёмка (печать 300 dpi — все снимки, 200 dpi — чистый/серый/порог/растр; экран ×2 и ×3)", accepted),
    summarize("Стресс (150 dpi, «телефон» при 200 dpi, экран ×1, phone-hard везде)", stress),
    summarize("Для сравнения: прежний вид", results.filter((r) => r.baseline)),
    summarize("Опыт AC3 — угловой QR 13 мм с логотипом (H)", results.filter((r) => r.experiment)),
    summarize(
      "Угловые QR 13 мм как есть (компактные, M), те же снимки",
      results.filter((r) => r.variant === "journal-corner" || r.variant === "blank-corner"),
    ),
  );
  const stressFailed = stress.filter((r) => !r.twoOfThree);
  if (stressFailed.length) {
    lines.push("", "Стресс, где читают меньше двух декодеров (px/модуль):");
    for (const r of stressFailed) lines.push(`- ${r.variant} @${r.dpi} ${r.transform}: ${r.pxPerModule} px/модуль`);
  }
  fs.writeFileSync(path.join(RAW_DIR, "decode-table.md"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  const failed = accepted.filter((r) => !r.jsqr || !r.zxing);
  if (failed.length) console.log(`\nПРИЁМКА НЕ ПРОЙДЕНА: ${failed.map((r) => `${r.variant}@${r.dpi}/${r.transform}`).join(", ")}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
