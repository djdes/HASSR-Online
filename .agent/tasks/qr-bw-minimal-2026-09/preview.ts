/**
 * Быстрый просмотр плитки во всех выходах: PNG (как окна сайта), шапка PDF
 * документа (альбомный лист, ячейка), плитка с рамкой (бумажный бланк) —
 * растры 300 dpi в папку `out` (по умолчанию D:/wt-build/tmp-bwqr/preview).
 *
 *   node --import tsx .agent/tasks/qr-bw-minimal-2026-09/preview.ts [out]
 */
process.env.NEXTAUTH_SECRET ||= "journal-qr-header-pages-secret-0123456789";
process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "journal-qr-header-pages-secret-0123456789";

import fs from "node:fs";
import path from "node:path";

import { brandQrPng, brandQrSvg } from "@/lib/brand-qr";
import type { JournalQrPlacement } from "@/lib/pdf-journal-qr";

import { buildCases } from "../journal-qr-header-2026-09/pages";
import { openPdf, renderRegion, savePng } from "../journal-qr-header-2026-09/qr-sim";

async function main() {
  const out = path.resolve(process.argv[2] ?? "D:/wt-build/tmp-bwqr/preview");
  fs.mkdirSync(out, { recursive: true });
  const url = "https://wesetup.ru/qj/cmg7k2x9d0000qz8r4tv1abcd/hygiene/AbCdEfGhIjKl";
  fs.writeFileSync(path.join(out, "tile-600.png"), await brandQrPng(url, { width: 600 }));
  fs.writeFileSync(path.join(out, "tile.svg"), await brandQrSvg(url));
  fs.writeFileSync(path.join(out, "tile-bare.svg"), await brandQrSvg(url, { caption: false }));
  const cases = buildCases(new Set(["samples", "long", "paper"]));
  for (const [set, label] of [
    ["samples", "hygiene"],
    ["long", "cleaning_ventilation_checklist"],
    ["paper", "ot_intro"],
  ]) {
    const item = cases.find((c) => c.set === set && c.label === label)!;
    const rendered = item.render("stamp");
    const p = (rendered.qrPlacements as JournalQrPlacement[]).find((q) => q.box)!;
    const doc = await openPdf(rendered.buffer);
    const box = { x0: p.box!.x0 - 40, y0: Math.max(0, p.box!.y0 - 4), x1: p.box!.x1 + 4, y1: p.box!.y1 + 12 };
    savePng(await renderRegion(doc, p.page, box, 300), path.join(out, `${set}-${label}-p${p.page}.png`));
    await doc.close();
    console.log(set, label, p.where, p.modules, p.module.toFixed(4), JSON.stringify(p.box), JSON.stringify(p.slot));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
