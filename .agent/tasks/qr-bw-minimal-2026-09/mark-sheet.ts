/**
 * Знак сайта на печати: квадрат знака из PNG плитки (`brandQrPng`, модуль —
 * целое число пикселей 600 dpi) при размере знака ≈ 2,3 / 3 / 4 мм, каждый —
 * пиксели принтера 600 dpi, увеличенные ×4 без сглаживания (видно, что
 * печатается), и тот же знак крупно (плакат).
 *
 *   node --import tsx .agent/tasks/qr-bw-minimal-2026-09/mark-sheet.ts <out.png>
 */
import fs from "node:fs";

import { GlobalFonts, createCanvas, loadImage } from "@napi-rs/canvas";

import { brandQrLayout, brandQrPng } from "@/lib/brand-qr";

const URL_SAMPLE = "https://wesetup.ru/journals-info/hygiene";
const DPI = 600;
const ZOOM = 4;

async function markAt(mm: number) {
  const layout = brandQrLayout(URL_SAMPLE);
  const scale = Math.max(1, Math.round((mm * DPI) / 25.4 / layout.mark.w));
  const png = await brandQrPng(URL_SAMPLE, { width: layout.width * scale - 1 });
  const image = await loadImage(png);
  const frame = (image.width - layout.window.w * scale) / 2;
  const x = frame + (layout.pad.x - layout.window.x) * scale;
  const y = frame + (layout.pad.y - layout.window.y) * scale;
  const side = layout.pad.w * scale;
  return { image, x, y, side, markMm: (layout.mark.w * scale * 25.4) / DPI };
}

async function main() {
  const out = process.argv[2];
  const sizes = [2.3, 3, 4];
  const marks = await Promise.all(sizes.map(markAt));
  const big = await markAt(14);
  const pad = 24;
  const width = pad + marks.reduce((s, m) => s + m.side * ZOOM + pad, 0) + 360 + pad;
  const height = Math.max(...marks.map((m) => m.side * ZOOM), 360) + 70;
  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#000";
  GlobalFonts.registerFromPath("src/lib/pdf-fonts/DejaVuSans.ttf", "MarkSheetSans");
  ctx.font = "16px MarkSheetSans";
  let x = pad;
  for (const m of marks) {
    ctx.drawImage(m.image, m.x, m.y, m.side, m.side, x, 40, m.side * ZOOM, m.side * ZOOM);
    ctx.fillText(`знак ${m.markMm.toFixed(1)} мм, 600 dpi ×${ZOOM}`, x, 26);
    x += m.side * ZOOM + pad;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(big.image, big.x, big.y, big.side, big.side, x, 40, 320, 320);
  ctx.fillText("крупно (плакат)", x, 26);
  fs.writeFileSync(out, canvas.toBuffer("image/png"));
  console.log(out, canvas.width, canvas.height, marks.map((m) => m.markMm.toFixed(2)).join(" / "));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
