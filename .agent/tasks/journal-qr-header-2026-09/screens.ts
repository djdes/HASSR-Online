/**
 * PNG страниц бланков — для глаз и для evidence.
 *
 *   npx tsx .agent/tasks/journal-qr-header-2026-09/screens.ts <папка> <набор:метка:стр[:dpi[:кроп]]> ...
 *
 * набор/метка — как в `pages.ts` (samples|blanks|long|paper|variants, код журнала);
 * «portrait:<код>» — образец журнала на книжном листе (`portrait-inputs.ts`).
 * кроп — «x0,y0,x1,y1» в мм (по умолчанию страница целиком). dpi по умолчанию 110.
 */
import path from "node:path";

import { buildCases } from "./pages";
import { renderPortraitSample } from "./portrait-inputs";
import { openPdf, pageSizeMm, renderRegion, savePng } from "./qr-sim";

async function main() {
  const [outDir, ...specs] = process.argv.slice(2);
  if (!outDir || specs.length === 0) throw new Error("папка и хотя бы один набор:метка:страница");
  const cases = buildCases(null);
  for (const spec of specs) {
    const [set, label, pageArg, dpiArg, cropArg] = spec.split(":");
    const buffer =
      set === "portrait"
        ? renderPortraitSample(label).buffer
        : (() => {
            const item = cases.find((c) => c.set === set && c.label === label);
            if (!item) throw new Error(`нет ${set}:${label}`);
            return item.render().buffer;
          })();
    const doc = await openPdf(buffer);
    const page = Number(pageArg ?? 1);
    const dpi = Number(dpiArg ?? 110);
    const size = await pageSizeMm(doc, page);
    const crop = cropArg ? cropArg.split(",").map(Number) : [0, 0, size.width, size.height];
    const raster = await renderRegion(doc, page, { x0: crop[0], y0: crop[1], x1: crop[2], y1: crop[3] }, dpi);
    await doc.close();
    const file = path.join(outDir, `${set}-${label}-p${page}${cropArg ? "-crop" : ""}.png`);
    savePng(raster, file);
    console.log(file, `${raster.width}×${raster.height}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
