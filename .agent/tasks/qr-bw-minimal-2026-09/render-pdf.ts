/**
 * Растр участка страницы PDF для evidence: файл PDF или бланк из pages.ts.
 *
 *   node --import tsx .agent/tasks/qr-bw-minimal-2026-09/render-pdf.ts <pdf | case:набор:метка> <out.png> <стр> <dpi> [x0,y0,x1,y1 мм | mark]
 * `mark` — квадрат знака QR страницы (по месту плитки) с полем 1 мм.
 */
process.env.NEXTAUTH_SECRET ||= "journal-qr-header-pages-secret-0123456789";
process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "journal-qr-header-pages-secret-0123456789";

import fs from "node:fs";

import { brandQrLayout } from "@/lib/brand-qr";
import type { JournalQrPlacement } from "@/lib/pdf-journal-qr";

import { buildCases } from "../journal-qr-header-2026-09/pages";
import { openPdf, pageSizeMm, renderRegion, savePng } from "../journal-qr-header-2026-09/qr-sim";

async function main() {
  const [source, out, pageArg, dpiArg, cropArg] = process.argv.slice(2);
  let pdf: Buffer;
  let placements: JournalQrPlacement[] = [];
  let url = "";
  if (source.startsWith("case:")) {
    const [, set, label] = source.split(":");
    const item = buildCases(null).find((c) => c.set === set && c.label === label)!;
    const rendered = item.render("stamp");
    pdf = rendered.buffer;
    placements = (rendered.qrPlacements ?? []) as JournalQrPlacement[];
    url = item.url;
  } else {
    pdf = fs.readFileSync(source);
  }
  const page = Number(pageArg ?? 1);
  const doc = await openPdf(pdf);
  const size = await pageSizeMm(doc, page);
  let crop = { x0: 0, y0: 0, x1: size.width, y1: size.height };
  if (cropArg === "mark") {
    const p = placements.find((q) => q.page === page && q.window)!;
    const layout = brandQrLayout(url);
    const x = p.window!.x0 + (layout.pad.x - layout.window.x) * p.module;
    const y = p.window!.y0 + (layout.pad.y - layout.window.y) * p.module;
    const side = layout.pad.w * p.module;
    crop = { x0: x - 1, y0: y - 1, x1: x + side + 1, y1: y + side + 1 };
    console.log(`подложка знака ${side.toFixed(2)} мм, знак ${(layout.mark.w * p.module).toFixed(2)} мм`);
  } else if (cropArg) {
    const [x0, y0, x1, y1] = cropArg.split(",").map(Number);
    crop = { x0, y0, x1, y1 };
  }
  const raster = await renderRegion(doc, page, crop, Number(dpiArg ?? 110));
  await doc.close();
  savePng(raster, out);
  console.log(out, `${raster.width}×${raster.height}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
