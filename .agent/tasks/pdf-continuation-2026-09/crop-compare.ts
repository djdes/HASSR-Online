/**
 * Мелкий текст «до / после» рядом: один и тот же участок листа из PDF master
 * и PDF ветки при заданном dpi, под ним — то же в ч/б (серый + порог 50 %,
 * как ч/б принтер). Для проверки читаемости мелких кеглей после смены шрифта.
 *
 *   node --import tsx .agent/tasks/pdf-continuation-2026-09/crop-compare.ts <выход.png> <dpi> <до.pdf> <после.pdf> <стр> <x0,y0,x1,y1 мм> [подпись]
 */
import fs from "node:fs";
import path from "node:path";

import { GlobalFonts, createCanvas, loadImage } from "@napi-rs/canvas";

import { openPdf, renderRegion, threshold, type Raster } from "../journal-qr-header-2026-09/qr-sim";

GlobalFonts.registerFromPath(path.join(process.cwd(), "src", "lib", "pdf-fonts", "DejaVuSans-Bold.ttf"), "LabelBold");

async function toImage(r: Raster) {
  const c = createCanvas(r.width, r.height);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(r.width, r.height);
  img.data.set(r.data);
  ctx.putImageData(img, 0, 0);
  return loadImage(c.toBuffer("image/png"));
}

async function main() {
  const [out, dpiArg, before, after, pageArg, boxArg, caption = ""] = process.argv.slice(2);
  const dpi = Number(dpiArg);
  const [x0, y0, x1, y1] = boxArg.split(",").map(Number);
  const box = { x0, y0, x1, y1 };
  const page = Number(pageArg);
  const shots: Raster[] = [];
  for (const file of [before, after]) {
    const doc = await openPdf(fs.readFileSync(file));
    shots.push(await renderRegion(doc, Math.min(page, doc.numPages), box, dpi));
    await doc.close();
  }
  const tiles = [shots[0], shots[1], threshold(shots[0]), threshold(shots[1])];
  const labels = ["ДО (master, DejaVu Sans)", "ПОСЛЕ (Liberation Serif)", "ДО, ч/б", "ПОСЛЕ, ч/б"];
  const w = tiles[0].width;
  const h = tiles[0].height;
  const labelH = 22;
  const gap = 8;
  const canvas = createCanvas(w * 2 + gap * 3, (h + labelH) * 2 + gap * 3 + (caption ? 24 : 0));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#d1d5db";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let top = gap;
  if (caption) {
    ctx.fillStyle = "#111827";
    ctx.font = "15px LabelBold";
    ctx.fillText(caption, gap, 18);
    top += 24;
  }
  for (let i = 0; i < 4; i += 1) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = gap + col * (w + gap);
    const y = top + row * (h + labelH + gap);
    ctx.fillStyle = "#111827";
    ctx.font = "13px LabelBold";
    ctx.fillText(labels[i], x, y + 15);
    ctx.drawImage(await toImage(tiles[i]), x, y + labelH);
  }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, canvas.toBuffer("image/png"));
  console.log(`${out}: ${canvas.width}×${canvas.height}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
