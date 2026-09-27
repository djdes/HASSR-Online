/**
 * Поля листа печатных журналов по растру (AC1–AC3).
 *
 * Для каждого журнала: рендер с QR в углу (как отдаёт сайт) → растр каждой
 * страницы (150 dpi, по одной, в памяти) → рамка «чернил»: первая/последняя
 * строка и первый/последний столбец с тёмным пикселем (любой канал < 235:
 * рамки таблиц, текст, заливки, QR и его серая подпись). Поля страницы:
 *   верх = от края листа до первой тёмной строки,
 *   низ  = от последней тёмной строки до нижнего края,
 *   лево/право — так же по столбцам. Всё в мм.
 * Страница «симметрична», если все четыре поля = MARGIN_MM ± TOL_MM.
 *
 * Запуск (из корня репо):
 *   npx tsx .agent/tasks/pdf-top-margin-2026-09/measure-margins.ts <метка> samples [код,код]
 *   npx tsx .agent/tasks/pdf-top-margin-2026-09/measure-margins.ts <метка> docs <orgId> <docId,docId,...>
 *   npx tsx .agent/tasks/pdf-top-margin-2026-09/measure-margins.ts <метка> variants
 *     — варианты, которых нет среди образцов: гигиена по форме Приложения №1
 *       (hygieneFormVersion = 2) и все образцы с подвалом партнёра (white-label).
 * Переменные:
 *   OUT_DIR=<папка>  — куда класть кадры страниц (по умолчанию C:/wt/pdfm-tmp/<метка>);
 *   SHOTS=all|<код,код> — сохранять кадры первой страницы и первой страницы-
 *                      продолжения (уменьшенные, с красной рамкой MARGIN_MM);
 *   MARGIN_MM (10), TOL_MM (1).
 * Итог — raw/margins-<метка>-<режим>.json в папке задачи.
 */
import fs from "node:fs";
import path from "node:path";
import { createCanvas, type Canvas } from "@napi-rs/canvas";

import {
  loadJournalDocumentPdfInput,
  renderJournalDocumentPdf,
  type JournalDocumentPdfInput,
} from "@/lib/document-pdf";
import { HYGIENE_FORM_VERSION_KEY } from "@/lib/hygiene-v2";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";
import { journalPdfQrOrigin, journalSamplePdfQr } from "@/lib/journal-pdf-qr-link";
import { SAMPLE_JOURNAL_CODES, buildJournalSampleInput } from "@/lib/journal-sample-fixtures";

const DPI = 150;
const PX_PER_MM = DPI / 25.4;
const SHOT_SCALE = 0.4; // кадр ~60 dpi
const MARGIN_MM = Number(process.env.MARGIN_MM ?? 10);
const TOL_MM = Number(process.env.TOL_MM ?? 1);
const TASK_DIR = path.join(process.cwd(), ".agent", "tasks", "pdf-top-margin-2026-09");

type PageMargins = {
  page: number;
  orientation: "portrait" | "landscape";
  widthMm: number;
  heightMm: number;
  top: number | null;
  bottom: number | null;
  left: number | null;
  right: number | null;
  /** Все четыре поля = MARGIN_MM ± TOL_MM. */
  symmetric: boolean;
  /** Разброс полей страницы (макс − мин), мм. */
  spread: number | null;
};

type JournalMargins = {
  label: string;
  code: string;
  pages: number;
  qrPages: number;
  qrMoved: number;
  qrUp: number;
  pagesMargins: PageMargins[];
  ok: boolean;
};

const round = (value: number) => Math.round(value * 100) / 100;

async function forEachPage(
  pdf: Buffer,
  visit: (page: number, canvas: Canvas, widthMm: number, heightMm: number) => Promise<void> | void,
): Promise<number> {
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
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: DPI / 72 });
      const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport } as Parameters<
        typeof page.render
      >[0]).promise;
      await visit(n, canvas, (base.width / 72) * 25.4, (base.height / 72) * 25.4);
      page.cleanup();
    }
    return doc.numPages;
  } finally {
    await task.destroy();
  }
}

function measure(canvas: Canvas, page: number, widthMm: number, heightMm: number): PageMargins {
  const { width, height } = canvas;
  const data = canvas.getContext("2d").getImageData(0, 0, width, height).data;
  let x0 = width;
  let x1 = -1;
  let y0 = height;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const i = row + x * 4;
      if (Math.min(data[i], data[i + 1], data[i + 2]) < 235) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const orientation = widthMm > heightMm ? "landscape" : "portrait";
  if (x1 < 0) {
    return { page, orientation, widthMm: round(widthMm), heightMm: round(heightMm), top: null, bottom: null, left: null, right: null, symmetric: false, spread: null };
  }
  const top = round(y0 / PX_PER_MM);
  const bottom = round(heightMm - (y1 + 1) / PX_PER_MM);
  const left = round(x0 / PX_PER_MM);
  const right = round(widthMm - (x1 + 1) / PX_PER_MM);
  const sides = [top, bottom, left, right];
  return {
    page,
    orientation,
    widthMm: round(widthMm),
    heightMm: round(heightMm),
    top,
    bottom,
    left,
    right,
    symmetric: sides.every((value) => Math.abs(value - MARGIN_MM) <= TOL_MM),
    spread: round(Math.max(...sides) - Math.min(...sides)),
  };
}

function saveShot(canvas: Canvas, file: string) {
  const w = Math.round(canvas.width * SHOT_SCALE);
  const h = Math.round(canvas.height * SHOT_SCALE);
  const small = createCanvas(w, h);
  const ctx = small.getContext("2d");
  ctx.drawImage(canvas, 0, 0, w, h);
  // Рамка MARGIN_MM от краёв листа — видно, где поле ровное.
  const m = MARGIN_MM * PX_PER_MM * SHOT_SCALE;
  ctx.strokeStyle = "rgba(220, 38, 38, 0.85)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(m, m, w - 2 * m, h - 2 * m);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, small.toBuffer("image/png"));
}

async function measureOne(
  label: string,
  input: Parameters<typeof renderJournalDocumentPdf>[0],
  shotPrefix: string | null,
): Promise<JournalMargins> {
  const rendered = renderJournalDocumentPdf(input);
  const placements = rendered.qrPlacements ?? [];
  const pagesMargins: PageMargins[] = [];
  const pages = await forEachPage(rendered.buffer, (page, canvas, widthMm, heightMm) => {
    pagesMargins.push(measure(canvas, page, widthMm, heightMm));
    if (shotPrefix && (page === 1 || page === 2)) saveShot(canvas, `${shotPrefix}-p${page}.png`);
  });
  return {
    label,
    code: input.document.template.code,
    pages,
    qrPages: placements.length,
    qrMoved: placements.filter((p) => p.moved).length,
    qrUp: placements.filter((p) => !p.bottomRow).length,
    pagesMargins,
    ok: pagesMargins.every((p) => p.symmetric),
  };
}

function fmt(p: PageMargins | undefined) {
  if (!p || p.top === null) return "—";
  return `${p.top.toFixed(1)}/${p.bottom!.toFixed(1)}/${p.left!.toFixed(1)}/${p.right!.toFixed(1)}`;
}

async function main() {
  const [tag = "run", mode = "samples", ...args] = process.argv.slice(2);
  const outDir = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : path.join("C:/wt/pdfm-tmp", tag);
  const shotsEnv = process.env.SHOTS ?? "";
  const shotAll = shotsEnv === "all";
  const shotSet = new Set(shotsEnv.split(",").filter(Boolean));
  const results: JournalMargins[] = [];

  const report = (r: JournalMargins) => {
    const cont = r.pagesMargins.slice(1);
    const worst = r.pagesMargins.reduce((m, p) => Math.max(m, p.spread ?? 99), 0);
    console.log(
      `${r.ok ? "OK  " : "DIFF"} ${r.code.padEnd(32)} pages=${String(r.pages).padStart(3)} ` +
        `p1 T/B/L/R=${fmt(r.pagesMargins[0])} cont=${cont.length ? fmt(cont[0]) : "—"} ` +
        `asym=${r.pagesMargins.filter((p) => !p.symmetric).map((p) => p.page).join(",") || "-"} ` +
        `spreadMax=${worst.toFixed(1)} qrUp=${r.qrUp} qrMoved=${r.qrMoved}`,
    );
  };

  if (mode === "samples") {
    const origin = journalPdfQrOrigin();
    const only = args[0] ? new Set(args[0].split(",")) : null;
    for (const code of SAMPLE_JOURNAL_CODES) {
      if (only && !only.has(code)) continue;
      const input = { ...buildJournalSampleInput(code), qr: journalSamplePdfQr(origin, code) };
      const shot = shotAll || shotSet.has(code) ? path.join(outDir, `sample-${code}`) : null;
      const r = await measureOne(`sample:${code}`, input, shot);
      results.push(r);
      report(r);
    }
  } else if (mode === "docs") {
    const [organizationId, ids] = args;
    for (const documentId of (ids ?? "").split(",").filter(Boolean)) {
      const input = await loadJournalDocumentPdfInput({ documentId, organizationId });
      const code = input.document.template.code;
      const shot = shotAll || shotSet.has(code) ? path.join(outDir, `doc-${code}`) : null;
      const r = await measureOne(`doc:${code}:${documentId}`, input, shot);
      results.push(r);
      report(r);
    }
  } else if (mode === "variants") {
    const origin = journalPdfQrOrigin();
    const partner = {
      brandName: "Партнёр Тест",
      pdfSignature:
        "Сопровождение и настройка журналов: ООО «Очень Длинное Название Партнёра по Внедрению ХАССП», тел. +7 900 000-00-00",
    };
    const variants: Array<{ label: string; build: () => JournalDocumentPdfInput }> = [
      {
        label: "hygiene-v2",
        build: () => {
          const sample = buildJournalSampleInput("hygiene");
          const config = { ...(sample.document.config as Record<string, unknown>), [HYGIENE_FORM_VERSION_KEY]: 2 };
          return {
            ...sample,
            document: { ...sample.document, config: config as typeof sample.document.config },
            qr: journalSamplePdfQr(origin, "hygiene"),
          };
        },
      },
      ...SAMPLE_JOURNAL_CODES.map((code) => ({
        label: `partner-${code}`,
        build: () => ({ ...buildJournalSampleInput(code), qr: journalSamplePdfQr(origin, code), branding: partner }),
      })),
    ];
    for (const variant of variants) {
      const shot = shotAll || shotSet.has(variant.label) ? path.join(outDir, variant.label) : null;
      const r = await measureOne(variant.label, variant.build(), shot);
      r.code = variant.label;
      results.push(r);
      report(r);
    }
  } else {
    throw new Error("режим: samples | docs <orgId> <ids> | variants");
  }

  const rawDir = path.join(TASK_DIR, "raw");
  fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(path.join(rawDir, `margins-${tag}-${mode}.json`), JSON.stringify(results, null, 1));
  const pages = results.flatMap((r) => r.pagesMargins);
  const asym = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - asym.length}/${results.length} журналов: все страницы с полями ${MARGIN_MM}±${TOL_MM} мм; ` +
      `страниц ${pages.length}, симметричных ${pages.filter((p) => p.symmetric).length}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
