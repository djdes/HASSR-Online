/**
 * Проверка QR для очень длинного документа (сотни страниц) — то же, что
 * пункты 2–3 `journal-pdf-qr-2026-09/check-qr-overlap.ts`, но растр по одной
 * странице: check-qr-overlap держит в памяти растры всех страниц трёх
 * рендеров, и на плане аудитов из 394 страниц съедал 40+ ГБ.
 *
 *   1. проба (место под QR посчитано, QR не нарисован) → растр 200 dpi →
 *      тёмные пиксели (< 235) в прямоугольнике QR + подпись (+1 мм);
 *   2. рендер с QR → модули матрицы в центрах клеток против `journalQrMatrix`;
 *   3. проба ставит QR туда же, что и настоящий штамп.
 *
 *   npx tsx --env-file=.env .agent/tasks/pdf-top-margin-2026-09/qr-zone-stream.ts <orgId> <docId>
 */
import { createCanvas, type Canvas } from "@napi-rs/canvas";

import { loadJournalDocumentPdfInput, renderJournalDocumentPdf } from "@/lib/document-pdf";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";
import { journalQrMatrix } from "@/lib/pdf-journal-qr";

const DPI = 200;
const PX_PER_MM = DPI / 25.4;

async function forEachPage(pdf: Buffer, visit: (page: number, canvas: Canvas) => void): Promise<number> {
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
      const viewport = page.getViewport({ scale: DPI / 72 });
      const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport } as Parameters<
        typeof page.render
      >[0]).promise;
      visit(n, canvas);
      page.cleanup();
    }
    return doc.numPages;
  } finally {
    await task.destroy();
  }
}

async function main() {
  const [organizationId, documentId] = process.argv.slice(2);
  const input = await loadJournalDocumentPdfInput({ documentId, organizationId });
  if (!input.qr) throw new Error("нет qr во входе");
  const url = input.qr.url;
  const probe = renderJournalDocumentPdf({ ...input, qr: { ...input.qr, probeOnly: true } });
  const probePlacements = probe.qrPlacements ?? [];
  let inkPages = 0;
  let inkTotal = 0;
  const probePages = await forEachPage(probe.buffer, (page, canvas) => {
    const p = probePlacements[page - 1];
    const x0 = Math.max(0, Math.floor((p.block.x0 - 1) * PX_PER_MM));
    const y0 = Math.max(0, Math.floor((p.block.y0 - 1) * PX_PER_MM));
    const x1 = Math.min(canvas.width, Math.ceil((p.block.x1 + 1) * PX_PER_MM));
    const y1 = Math.min(canvas.height, Math.ceil((p.block.y1 + 1) * PX_PER_MM));
    const data = canvas.getContext("2d").getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if (Math.min(data[i], data[i + 1], data[i + 2]) < 235) count += 1;
    if (count > 0) inkPages += 1;
    inkTotal += count;
  });

  const stamped = renderJournalDocumentPdf(input);
  const placements = stamped.qrPlacements ?? [];
  const samePlaces =
    probePlacements.length === placements.length &&
    probePlacements.every((p, i) => Math.abs(p.x - placements[i].x) < 1e-6 && Math.abs(p.y - placements[i].y) < 1e-6);
  const qr = journalQrMatrix(url);
  const n = qr.modules.size;
  let mismatches = 0;
  const stampedPages = await forEachPage(stamped.buffer, (page, canvas) => {
    const p = placements[page - 1];
    const cell = p.size / n;
    const ctx = canvas.getContext("2d");
    const x0 = Math.floor(p.x * PX_PER_MM) - 2;
    const y0 = Math.floor(p.y * PX_PER_MM) - 2;
    const w = Math.ceil(p.size * PX_PER_MM) + 4;
    const data = ctx.getImageData(x0, y0, w, w).data;
    const dark = (px: number, py: number) => {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const x = Math.min(w - 1, Math.max(0, Math.floor(px) - x0 + dx));
          const y = Math.min(w - 1, Math.max(0, Math.floor(py) - y0 + dy));
          const i = (y * w + x) * 4;
          sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
        }
      }
      return sum / 9 < 128;
    };
    for (let row = 0; row < n; row += 1) {
      for (let col = 0; col < n; col += 1) {
        const cx = (p.x + (col + 0.5) * cell) * PX_PER_MM;
        const cy = (p.y + (row + 0.5) * cell) * PX_PER_MM;
        if (dark(cx, cy) !== Boolean(qr.modules.get(row, col))) mismatches += 1;
      }
    }
  });

  const ok =
    samePlaces &&
    inkTotal === 0 &&
    mismatches === 0 &&
    placements.length === stampedPages &&
    placements.every((p) => !p.overlap);
  console.log(
    `${ok ? "OK  " : "FAIL"} ${input.document.template.code} pages probe=${probePages} stamped=${stampedPages} ` +
      `qr=${placements.length} samePlaces=${samePlaces} inkPages=${inkPages} inkPx=${inkTotal} mism=${mismatches} ` +
      `bottomRow=${placements.filter((p) => p.bottomRow).length} moved=${placements.filter((p) => p.moved).length} ` +
      `overlap=${placements.filter((p) => p.overlap).length} modules=${n}`,
  );
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
