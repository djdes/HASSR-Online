/**
 * PDF и растры страниц (реальный размер A4, pdf.js) для просмотра и печати.
 *
 *   node --import tsx .agent/tasks/pdf-continuation-2026-09/render-shots.ts <папка> <dpi> <набор:метка[:стр,стр]> …
 *
 * Для каждого бланка пишет <набор>-<метка>.pdf и <набор>-<метка>-p<N>.png
 * (по умолчанию страницы 1 и 2). Наборы — из journal-qr-header-2026-09/pages.ts.
 */
import fs from "node:fs";
import path from "node:path";

import { buildCases } from "../journal-qr-header-2026-09/pages";
import { openPdf, pageSizeMm, renderRegion, savePng } from "../journal-qr-header-2026-09/qr-sim";

async function main() {
  const [outArg, dpiArg, ...specs] = process.argv.slice(2);
  const out = path.resolve(outArg);
  const dpi = Number(dpiArg);
  fs.mkdirSync(out, { recursive: true });
  const sets = new Set(specs.map((s) => s.split(":")[0]));
  const cases = buildCases(sets);
  for (const spec of specs) {
    const [set, label, pagesArg] = spec.split(":");
    const item = cases.find((c) => c.set === set && c.label === label);
    if (!item) throw new Error(`нет бланка ${spec}`);
    const rendered = item.render("stamp");
    const base = `${set}-${label}`;
    fs.writeFileSync(path.join(out, `${base}.pdf`), rendered.buffer);
    const doc = await openPdf(rendered.buffer);
    const pages = pagesArg ? pagesArg.split(",").map(Number) : [1, 2];
    for (const page of pages) {
      if (page > doc.numPages) continue;
      const size = await pageSizeMm(doc, page);
      const raster = await renderRegion(doc, page, { x0: 0, y0: 0, x1: size.width, y1: size.height }, dpi);
      savePng(raster, path.join(out, `${base}-p${page}.png`));
    }
    console.log(`${base}: ${doc.numPages} стр., ${Math.round(rendered.buffer.length / 1024)} КБ`);
    await doc.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
