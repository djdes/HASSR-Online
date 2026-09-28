/**
 * «До / после» одного участка листа: PDF master слева, PDF ветки справа
 * (или одна под другой — `stack`), подписи сверху; PNG в оттенках серого.
 *
 *   node --import tsx .agent/tasks/pdf-continuation-2026-09/before-after.ts <выход.png> <dpi> <до.pdf> <стр> <после.pdf> <стр> <x0,y0,x1,y1 мм> [подпись] [stack]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { GlobalFonts, createCanvas, loadImage } from "@napi-rs/canvas";

import { openPdf, renderRegion, type Raster } from "../journal-qr-header-2026-09/qr-sim";

const requireCjs = createRequire(__filename);
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
  const [out, dpiArg, before, beforePage, after, afterPage, boxArg, caption = "", layout = "side"] = process.argv.slice(2);
  const dpi = Number(dpiArg);
  const [x0, y0, x1, y1] = boxArg.split(",").map(Number);
  const shots: Raster[] = [];
  for (const [file, page] of [
    [before, beforePage],
    [after, afterPage],
  ]) {
    const doc = await openPdf(fs.readFileSync(file));
    shots.push(await renderRegion(doc, Number(page), { x0, y0, x1, y1 }, dpi));
    await doc.close();
  }
  const labels = [`ДО — master, стр. ${beforePage}`, `ПОСЛЕ — ветка, стр. ${afterPage}`];
  const w = shots[0].width;
  const h = shots[0].height;
  const gap = 10;
  const labelH = 24;
  const top = caption ? 28 : 0;
  const stack = layout === "stack";
  const width = stack ? w + gap * 2 : w * 2 + gap * 3;
  const height = top + (stack ? (h + labelH) * 2 + gap * 3 : h + labelH + gap * 2);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#c8c8c8";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#111111";
  if (caption) {
    ctx.font = "16px LabelBold";
    ctx.fillText(caption, gap, 20);
  }
  for (let i = 0; i < 2; i += 1) {
    const x = stack ? gap : gap + i * (w + gap);
    const y = top + gap + (stack ? i * (h + labelH + gap) : 0);
    ctx.fillStyle = "#111111";
    ctx.font = "14px LabelBold";
    ctx.fillText(labels[i], x, y + 16);
    ctx.drawImage(await toImage(shots[i]), x, y + labelH);
  }
  type PngCtor = {
    new (o: { width: number; height: number }): { data: Buffer };
    sync: { write: (png: unknown, o: Record<string, number>) => Buffer };
  };
  const { PNG } = requireCjs("pngjs") as { PNG: PngCtor };
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  const buffer = PNG.sync.write(png, { colorType: 0, inputColorType: 6, bitDepth: 8 });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, buffer);
  console.log(`${out}: ${width}×${height}, ${Math.round(buffer.length / 1024)} КБ`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
