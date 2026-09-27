/**
 * Опыт для выбора размера плитки QR в шапке: какой высоты плитка читается
 * обоими декодерами во всех снимках (150/300 dpi × чистый / ч/б / ч/б
 * принтер / телефон / ч/б + телефон) при плотности настоящих адресов.
 *
 * Лист A4 альбомный, рамка «шапки» с текстом и ячейка QR справа (как в
 * бланке), плитка — `drawBrandQrTilePdf`. Высоты плитки — от 19,7 мм (шапка
 * 20 мм не растёт) до 23,7 мм (шапка +4 мм, предел спеки) и выше — для
 * сравнения.
 *
 *   npx tsx .agent/tasks/journal-qr-header-2026-09/size-experiment.ts
 */
process.env.NEXTAUTH_SECRET ||= "journal-qr-header-pages-secret-0123456789";
process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "journal-qr-header-pages-secret-0123456789";

import fs from "node:fs";
import path from "node:path";

import { jsPDF } from "jspdf";

import { blankQrUrl } from "@/lib/blank-qr-token";
import { brandQrLayout, drawBrandQrTilePdf } from "@/lib/brand-qr";
import { journalShortQrUrl } from "@/lib/journal-pdf-qr-link";
import { registerJournalUnicodeFont } from "@/lib/pdf-journal-font";

import { SHOT_KINDS, decodeJsQr, decodeZxing, openPdf, savePng, shotsOf } from "./qr-sim";

const ORG = "cmg7k2x9d0000qz8r4tv1abcd";
const OUT = path.resolve(process.env.EXP_OUT ?? "C:/wt/_verify-pdfqr/size-exp");
const HEIGHTS = (process.env.EXP_HEIGHTS ?? "19.7,21,22.3,23.7,26,28").split(",").map(Number);
const DPIS = [150, 300];

const urls: Array<{ label: string; url: string }> = [
  { label: "sample hygiene", url: "https://wesetup.ru/journals-info/hygiene" },
  { label: "sample incoming_raw_materials_control", url: "https://wesetup.ru/journals-info/incoming_raw_materials_control" },
  { label: "doc hygiene", url: journalShortQrUrl("https://wesetup.ru", ORG, "hygiene") },
  { label: "doc cleaning_ventilation_checklist", url: journalShortQrUrl("https://wesetup.ru", ORG, "cleaning_ventilation_checklist") },
  {
    label: "blank + email 31",
    url: blankQrUrl("https://wesetup.ru", { target: { kind: "code", code: "hygiene" }, email: "a".repeat(25) + "@b.com" }).url,
  },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const rows: string[] = [];
  const summary: Record<string, { ok: number; total: number }> = {};
  for (const { label, url } of urls) {
    const layout = brandQrLayout(url);
    for (const height of HEIGHTS) {
      const width = height / (layout.height / layout.width);
      const module = width / layout.width;
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const fontName = registerJournalUnicodeFont(doc);
      // Шапка: рамка 277 × (плитка + 0,3) мм, ячейка QR справа, текст слева.
      const cellW = width + 0.3;
      const cellH = Math.max(20, height + 0.3);
      doc.setLineWidth(0.2);
      doc.rect(10, 10, 277, cellH);
      doc.line(66, 10, 66, 10 + cellH);
      doc.line(287 - cellW - 42, 10, 287 - cellW - 42, 10 + cellH);
      doc.line(287 - cellW, 10, 287 - cellW, 10 + cellH);
      doc.line(66, 20, 287 - cellW, 20);
      doc.setFont(fontName, "bold");
      doc.setFontSize(10);
      doc.text("СИСТЕМА ХАССП", 150, 16.5, { align: "center" });
      doc.text("ЖУРНАЛ УЧЁТА", 150, 27, { align: "center" });
      doc.setFontSize(9);
      doc.text("Начат 01-04-2026", 287 - cellW - 39, 14);
      doc.text("Окончен ______", 287 - cellW - 39, 18);
      doc.setFontSize(10);
      doc.text("СТР. 1 ИЗ 3", 287 - cellW - 21, 27, { align: "center" });
      drawBrandQrTilePdf(doc, layout, 287 - cellW + 0.15, 10 + (cellH - height) / 2, width, { fontName });
      // Таблица под шапкой.
      for (let i = 0; i < 6; i += 1) doc.rect(10, 10 + cellH + 6 + i * 7, 277, 7);
      const pdf = Buffer.from(doc.output("arraybuffer"));
      const pdfDoc = await openPdf(pdf);
      const box = { x0: 287 - cellW - 12, y0: 4, x1: 293, y1: 10 + cellH + 8 };
      const shots = await shotsOf(pdfDoc, 1, box, DPIS);
      await pdfDoc.close();
      const line: string[] = [];
      for (const shot of shots) {
        const j = decodeJsQr(shot.raster) === url;
        const z = (await decodeZxing(shot.raster)) === url;
        const key = `${layout.size}|${height}|${shot.dpi}|${shot.kind}`;
        for (const [dec, ok] of [["jsqr", j], ["zxing", z]] as const) {
          const k = `${key}|${dec}`;
          summary[k] ??= { ok: 0, total: 0 };
          summary[k].total += 1;
          if (ok) summary[k].ok += 1;
        }
        line.push(`${shot.dpi}${shot.kind}:${j ? "J" : "-"}${z ? "Z" : "-"}`);
        if (process.env.EXP_SAVE === "1" && height === HEIGHTS[0]) {
          savePng(shot.raster, path.join(OUT, `${layout.size}-${height}-${shot.dpi}-${shot.kind}.png`));
        }
      }
      const row = `${label.padEnd(40)} n=${layout.size} h=${height.toFixed(1)} w=${width.toFixed(2)} m=${module.toFixed(3)} | ${line.join(" ")}`;
      rows.push(row);
      console.log(row);
    }
  }
  fs.writeFileSync(path.join(OUT, "size-experiment.txt"), rows.join("\n") + "\n");
  // Сводка: по высоте плитки — сколько снимков прочитали оба декодера.
  console.log("\nсводка (n | высота | dpi | снимок | декодер → прочитано/всего):");
  for (const kind of SHOT_KINDS) {
    for (const [k, v] of Object.entries(summary)) if (k.includes(`|${kind}|`) && v.ok < v.total) console.log(k, `${v.ok}/${v.total}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
