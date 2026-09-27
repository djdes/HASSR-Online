/**
 * Что мешает jsQR на «снимке телефоном» 300 dpi: плитка целиком / без плашки /
 * без знака / простой QR H; модуль 0,35 / 0,38 / 0,42 мм; линии ячейки рядом
 * (0,15 мм) / без линий / с полем 1 мм — по 10 поз (перспектива 8 %, σ 0,8 px,
 * JPEG 85). Итог — raw/design-ablation.txt: знак и плашка на чтение не влияют,
 * решает модуль (0,42 мм — 10/10), линии рядом немного мешают.
 *
 *   npx tsx .agent/tasks/journal-qr-header-2026-09/design-ablation.ts
 */
process.env.NEXTAUTH_SECRET ||= "journal-qr-header-pages-secret-0123456789";
process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "journal-qr-header-pages-secret-0123456789";
import { jsPDF } from "jspdf";
import { brandQrLayout, drawBrandQrTilePdf, type BrandQrLayout } from "@/lib/brand-qr";
import { journalShortQrUrl } from "@/lib/journal-pdf-qr-link";
import { registerJournalUnicodeFont } from "@/lib/pdf-journal-font";
import { decodeJsQr, decodeZxing, openPdf, phoneCapture, renderRegion, threshold } from "./qr-sim";

const ORG = "cmg7k2x9d0000qz8r4tv1abcd";
const POSES = [
  { angle: 5, keystone: 0.08 },
  { angle: 6, keystone: 0.06 },
  { angle: 7, keystone: 0.08 },
  { angle: 8, keystone: 0.05 },
  { angle: 9, keystone: 0.07 },
  { angle: 10, keystone: 0.08 },
  { angle: -5, keystone: 0.08 },
  { angle: -7, keystone: 0.06 },
  { angle: -9, keystone: 0.08 },
  { angle: -10, keystone: 0.05 },
];

async function master(layout: BrandQrLayout, url: string, height: number, lines: boolean, pad: number) {
  const width = height / (layout.height / layout.width);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const fontName = registerJournalUnicodeFont(doc);
  const cellW = width + 2 * pad;
  const cellH = height + 2 * pad;
  doc.setLineWidth(0.2);
  if (lines) {
    doc.rect(10, 10, 277, cellH);
    doc.line(287 - cellW, 10, 287 - cellW, 10 + cellH);
  }
  drawBrandQrTilePdf(doc, layout, 287 - cellW + pad, 10 + pad, width, { fontName });
  const pdf = await openPdf(Buffer.from(doc.output("arraybuffer")));
  const box = { x0: 287 - cellW - 12, y0: 4, x1: 293, y1: 10 + cellH + 8 };
  const m = await renderRegion(pdf, 1, box, 600);
  await pdf.close();
  return m;
}

async function main() {
  const urls = [
    journalShortQrUrl("https://wesetup.ru", ORG, "hygiene"),
    journalShortQrUrl("https://wesetup.ru", ORG, "cleaning_ventilation_checklist"),
  ];
  for (const url of urls) {
    const full = brandQrLayout(url);
    const designs: Array<[string, BrandQrLayout]> = [
      ["full", full],
      ["noplate", { ...full, plate: null, title: null, site: null, height: full.width }],
      ["nologo", { ...full, pad: null, mark: null, plain: full.dark }],
      ["plain-H", { ...full, pad: null, mark: null, plain: full.dark, plate: null, title: null, site: null, height: full.width }],
    ];
    for (const [name, layout] of designs) {
      for (const moduleMm of [0.35, 0.38, 0.42]) {
        const height = layout.height * moduleMm;
        for (const [lines, pad] of [[true, 0.15], [false, 0.15], [true, 1.0]] as const) {
          const m = await master(layout, url, height, lines, pad);
          const mbw = threshold(m);
          let j = 0;
          let z = 0;
          let jb = 0;
          let zb = 0;
          for (const pose of POSES) {
            const shot = await phoneCapture(m, 600, 300, { ...pose, blur: 0.8, jpeg: 85 });
            if (decodeJsQr(shot) === url) j += 1;
            if ((await decodeZxing(shot)) === url) z += 1;
            const shotBw = await phoneCapture(mbw, 600, 300, { ...pose, blur: 0.8, jpeg: 85 });
            if (decodeJsQr(shotBw) === url) jb += 1;
            if ((await decodeZxing(shotBw)) === url) zb += 1;
          }
          console.log(
            `n=${full.size} ${name.padEnd(8)} m=${moduleMm} lines=${lines ? 1 : 0} pad=${pad} | phone300 jsQR ${j}/${POSES.length} zxing ${z}/${POSES.length} | bw-phone300 jsQR ${jb}/${POSES.length} zxing ${zb}/${POSES.length}`,
          );
        }
      }
    }
  }
}
main();
