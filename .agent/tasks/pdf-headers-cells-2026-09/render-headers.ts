/**
 * Шапки печатных журналов «до/после» (AC1–AC4).
 *
 * Для каждого образца каталога (45 журналов):
 *   1. рендер без QR → растр первой страницы (150 dpi);
 *   2. поиск длинных горизонталей (≥ 30 мм) в верхней части листа:
 *      кластеры подряд идущих тёмных строк = одна линия; толщина кластера,
 *      левый/правый край. Шапка — кластеры до первого разрыва ≥ 5 мм
 *      (заголовок журнала), таблица — первые кластеры после него;
 *   3. метрики: ширина шапки против ширины таблицы (левый и правый край,
 *      допуск 0,5 мм), «двойные» линии (две горизонтали ближе 1 мм),
 *      разброс толщины линий шапки;
 *   4. для кодов из SHOTS — кадр верхних 90 мм листа в shots/<prefix>-<code>.png.
 *
 * Запуск: npx tsx .agent/tasks/pdf-headers-cells-2026-09/render-headers.ts <prefix> [код,код]
 *   SHOTS=<код,код,...> — какие шапки сохранить.
 */
import fs from "node:fs";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";

import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";
import { SAMPLE_JOURNAL_CODES, buildJournalSampleInput } from "@/lib/journal-sample-fixtures";

const DPI = 150;
const PX_PER_MM = DPI / 25.4;
const TASK_DIR = path.join(process.cwd(), ".agent", "tasks", "pdf-headers-cells-2026-09");

type Raster = { width: number; height: number; data: Uint8ClampedArray };

async function rasterFirstPage(pdf: Buffer): Promise<Raster> {
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
    const viewport = page.getViewport({ scale: DPI / 72 });
    const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport } as Parameters<
      typeof page.render
    >[0]).promise;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, data: img.data };
  } finally {
    await task.destroy();
  }
}

const dark = (r: Raster, x: number, y: number) => {
  const i = (y * r.width + x) * 4;
  return Math.min(r.data[i], r.data[i + 1], r.data[i + 2]) < 150;
};

/** Самый длинный непрерывный тёмный отрезок строки: [x0, x1] в px или null. */
function longestRun(r: Raster, y: number): [number, number] | null {
  let best: [number, number] | null = null;
  let start = -1;
  for (let x = 0; x <= r.width; x += 1) {
    const d = x < r.width && dark(r, x, y);
    if (d && start < 0) start = x;
    if (!d && start >= 0) {
      if (!best || x - start > best[1] - best[0]) best = [start, x];
      start = -1;
    }
  }
  return best;
}

type Line = { y0: number; y1: number; x0: number; x1: number };

function horizontalLines(r: Raster, maxYmm: number): Line[] {
  const minLen = 30 * PX_PER_MM;
  const lines: Line[] = [];
  let current: Line | null = null;
  const maxY = Math.min(r.height, Math.round(maxYmm * PX_PER_MM));
  for (let y = 0; y < maxY; y += 1) {
    const run = longestRun(r, y);
    if (run && run[1] - run[0] >= minLen) {
      if (current && current.y1 === y) {
        current.y1 = y + 1;
        current.x0 = Math.min(current.x0, run[0]);
        current.x1 = Math.max(current.x1, run[1]);
      } else {
        current = { y0: y, y1: y + 1, x0: run[0], x1: run[1] };
        lines.push(current);
      }
    }
  }
  return lines;
}

const mm = (px: number) => +(px / PX_PER_MM).toFixed(2);

async function main() {
  const [prefix = "run", onlyArg] = process.argv.slice(2);
  const only = onlyArg ? new Set(onlyArg.split(",")) : null;
  const shots = new Set((process.env.SHOTS ?? "").split(",").filter(Boolean));
  const results: Array<Record<string, unknown>> = [];
  for (const code of SAMPLE_JOURNAL_CODES) {
    if (only && !only.has(code)) continue;
    const rendered = renderJournalDocumentPdf({ ...buildJournalSampleInput(code), qr: null });
    const r = await rasterFirstPage(rendered.buffer);
    const lines = horizontalLines(r, 140);
    // Шапка — до первого разрыва ≥ 5 мм.
    let split = lines.length;
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].y0 - lines[i - 1].y1 >= 5 * PX_PER_MM) {
        split = i;
        break;
      }
    }
    const header = lines.slice(0, split);
    const table = lines.slice(split, split + 3);
    const hx0 = header.length ? Math.min(...header.map((l) => l.x0)) : null;
    const hx1 = header.length ? Math.max(...header.map((l) => l.x1)) : null;
    const tx0 = table.length ? Math.min(...table.map((l) => l.x0)) : null;
    const tx1 = table.length ? Math.max(...table.map((l) => l.x1)) : null;
    const thick = header.map((l) => l.y1 - l.y0);
    const doubles = header.filter((l, i) => i > 0 && l.y0 - header[i - 1].y1 < 1 * PX_PER_MM).length;
    const leftDiff = hx0 !== null && tx0 !== null ? mm(Math.abs(hx0 - tx0)) : null;
    const rightDiff = hx1 !== null && tx1 !== null ? mm(Math.abs(hx1 - tx1)) : null;
    const widthOk = leftDiff !== null && rightDiff !== null ? leftDiff <= 0.5 && rightDiff <= 0.5 : null;
    const thickOk = thick.length ? Math.max(...thick) - Math.min(...thick) <= 1 : null;
    const row = {
      code,
      headerLines: header.length,
      header: hx0 === null ? null : [mm(hx0), mm(hx1!)],
      table: tx0 === null ? null : [mm(tx0), mm(tx1!)],
      leftDiff,
      rightDiff,
      widthOk,
      thicknessPx: thick,
      thickOk,
      doubles,
    };
    results.push(row);
    console.log(
      `${widthOk === false || doubles || thickOk === false ? "WARN" : "ok  "} ${code.padEnd(34)} ` +
        `hdr=${JSON.stringify(row.header)} tbl=${JSON.stringify(row.table)} dL=${leftDiff} dR=${rightDiff} ` +
        `thick=${thick.join(",")} dbl=${doubles}`,
    );
    if (shots.has(code)) {
      const hMm = Number(process.env.SHOT_H_MM ?? 90);
      const w = r.width;
      const h = Math.min(r.height, Math.round(hMm * PX_PER_MM));
      const canvas = createCanvas(w, h);
      const ctx = canvas.getContext("2d");
      const img = ctx.createImageData(w, h);
      img.data.set(r.data.subarray(0, w * h * 4));
      ctx.putImageData(img, 0, 0);
      const dir = path.join(TASK_DIR, "shots");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${prefix}-${code}.png`), canvas.toBuffer("image/png"));
    }
  }
  const dir = path.join(TASK_DIR, "raw");
  fs.mkdirSync(dir, { recursive: true });
  if (!only) fs.writeFileSync(path.join(dir, `headers-${prefix}.json`), JSON.stringify(results, null, 2));
  const bad = results.filter((x) => x.widthOk === false || (x.doubles as number) > 0 || x.thickOk === false);
  console.log(`\n${results.length - bad.length}/${results.length} шапок без замечаний`);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
