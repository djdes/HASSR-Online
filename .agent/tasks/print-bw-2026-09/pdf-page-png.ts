/**
 * Растр одной страницы PDF в PNG (pdf.js) — для скриншотов evidence.
 * Запуск (из корня репо): npx tsx .agent/tasks/print-bw-2026-09/pdf-page-png.ts <pdf> <страница> <png> [dpi]
 */
import fs from "node:fs";

import { openPdf, renderRegion, savePng } from "../journal-qr-header-2026-09/qr-sim";

async function main() {
  const [file, pageArg, out, dpiArg] = process.argv.slice(2);
  const page = Number(pageArg);
  const doc = await openPdf(fs.readFileSync(file));
  try {
    const p = await doc.getPage(page);
    const vp = p.getViewport({ scale: 1 });
    const raster = await renderRegion(doc, page, { x0: 0, y0: 0, x1: (vp.width / 72) * 25.4, y1: (vp.height / 72) * 25.4 }, Number(dpiArg ?? 110));
    savePng(raster, out);
    console.log(`${out}: ${raster.width}×${raster.height}`);
  } finally {
    await doc.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
