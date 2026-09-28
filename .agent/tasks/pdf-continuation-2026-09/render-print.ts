/**
 * Печатный набор (`print-inputs.ts`) → PDF и PNG стр. 1 и 2 (реальный размер
 * A4, 150 dpi, оттенки серого — как ч/б принтер).
 *
 *   node --import tsx .agent/tasks/pdf-continuation-2026-09/render-print.ts <папка>
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { renderJournalDocumentPdf } from "@/lib/document-pdf";

import { countPdfPages } from "../journal-qr-header-2026-09/pages";
import { openPdf, pageSizeMm, renderRegion, toGray, type Raster } from "../journal-qr-header-2026-09/qr-sim";
import { PRINT_ITEMS } from "./print-inputs";

const requireCjs = createRequire(__filename);

/** PNG в оттенках серого, 8 бит (pngjs): страница бланка — 100–250 КБ, а не мегабайт. */
function grayPng(r: Raster): Buffer {
  type PngCtor = {
    new (o: { width: number; height: number }): { data: Buffer };
    sync: { write: (png: unknown, o: Record<string, number>) => Buffer };
  };
  const { PNG } = requireCjs("pngjs") as { PNG: PngCtor };
  const gray = toGray(r);
  const png = new PNG({ width: r.width, height: r.height });
  png.data = Buffer.from(gray.data.buffer, gray.data.byteOffset, gray.data.byteLength);
  return PNG.sync.write(png, { colorType: 0, inputColorType: 6, bitDepth: 8 });
}

async function main() {
  const out = path.resolve(process.argv[2] ?? "D:/wt-build/tmp-pdfcont/print");
  fs.mkdirSync(out, { recursive: true });
  const summary: Array<{ file: string; title: string; pages: number; pdfKb: number; pngKb: number[] }> = [];
  for (const item of PRINT_ITEMS) {
    const { buffer } = renderJournalDocumentPdf(item.build());
    fs.writeFileSync(path.join(out, `${item.file}.pdf`), buffer);
    const doc = await openPdf(buffer);
    const pngKb: number[] = [];
    for (const page of [1, 2]) {
      if (page > doc.numPages) continue;
      const size = await pageSizeMm(doc, page);
      const raster = await renderRegion(doc, page, { x0: 0, y0: 0, x1: size.width, y1: size.height }, 150);
      const png = grayPng(raster);
      fs.writeFileSync(path.join(out, `${item.file}-p${page}.png`), png);
      pngKb.push(Math.round(png.length / 1024));
    }
    await doc.close();
    const pages = countPdfPages(buffer);
    summary.push({ file: item.file, title: item.title, pages, pdfKb: Math.round(buffer.length / 1024), pngKb });
    console.log(`${item.file}: ${pages} стр., PDF ${Math.round(buffer.length / 1024)} КБ, PNG ${pngKb.join(" + ")} КБ`);
  }
  fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 1));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
