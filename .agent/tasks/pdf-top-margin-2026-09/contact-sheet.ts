/**
 * Картинки «до/после» из кадров measure-margins.ts (кадр ~60 dpi, красный
 * пунктир — поле 10 мм от края листа):
 *
 *   сводный лист миниатюр — первая страница и первая страница-продолжение
 *   каждого образца:
 *     npx tsx .agent/tasks/pdf-top-margin-2026-09/contact-sheet.ts sheet <папка кадров> <выход.jpg> <подпись>
 *
 *   пары «до | после» одной страницы рядом:
 *     npx tsx .agent/tasks/pdf-top-margin-2026-09/contact-sheet.ts pairs <папка «до»> <папка «после»> <папка выхода> <кадр,кадр,...>
 *     (кадр — имя без .png, например sample-hygiene-p1)
 */
import fs from "node:fs";
import path from "node:path";
import { GlobalFonts, createCanvas, loadImage } from "@napi-rs/canvas";

import { SAMPLE_JOURNAL_CODES } from "@/lib/journal-sample-fixtures";

// Шрифт с кириллицей для подписей (тот же DejaVu, что в бланках).
GlobalFonts.registerFromPath(path.join(process.cwd(), "src", "lib", "pdf-fonts", "DejaVuSans.ttf"), "DejaVuSans");
GlobalFonts.registerFromPath(path.join(process.cwd(), "src", "lib", "pdf-fonts", "DejaVuSans-Bold.ttf"), "DejaVuSansBold");

const THUMB_W = 250;
const COLS = 8;
const LABEL_H = 14;
const GAP = 8;

async function sheet(dir: string, out: string, caption: string) {
  const files: Array<{ file: string; label: string }> = [];
  for (const code of SAMPLE_JOURNAL_CODES) {
    for (const page of [1, 2]) {
      const file = path.join(dir, `sample-${code}-p${page}.png`);
      if (fs.existsSync(file)) files.push({ file, label: `${code} · стр. ${page}` });
    }
  }
  const first = await loadImage(fs.readFileSync(files[0].file));
  const thumbH = Math.round((THUMB_W * first.height) / first.width);
  const rows = Math.ceil(files.length / COLS);
  const headerH = caption ? 28 : 0;
  const canvas = createCanvas(COLS * (THUMB_W + GAP) + GAP, headerH + rows * (thumbH + LABEL_H + GAP) + GAP);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (caption) {
    ctx.fillStyle = "#111827";
    ctx.font = "18px DejaVuSansBold";
    ctx.fillText(caption, GAP, 20);
  }
  for (const [index, item] of files.entries()) {
    const img = await loadImage(fs.readFileSync(item.file));
    const x = GAP + (index % COLS) * (THUMB_W + GAP);
    const y = headerH + GAP + Math.floor(index / COLS) * (thumbH + LABEL_H + GAP);
    ctx.drawImage(img, x, y, THUMB_W, thumbH);
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, THUMB_W - 1, thumbH - 1);
    ctx.fillStyle = "#111827";
    ctx.font = "11px DejaVuSans";
    ctx.fillText(item.label, x, y + thumbH + 11);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, canvas.toBuffer("image/jpeg", 82));
  console.log(`${files.length} кадров → ${out} (${Math.round(fs.statSync(out).size / 1024)} КБ)`);
}

async function pairs(beforeDir: string, afterDir: string, outDir: string, names: string[]) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of names) {
    const before = await loadImage(fs.readFileSync(path.join(beforeDir, `${name}.png`)));
    const after = await loadImage(fs.readFileSync(path.join(afterDir, `${name}.png`)));
    const labelH = 22;
    const canvas = createCanvas(before.width + after.width + GAP * 3, labelH + Math.max(before.height, after.height) + GAP);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e5e7eb";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#111827";
    ctx.font = "14px DejaVuSansBold";
    ctx.fillText(`ДО · ${name}`, GAP, 16);
    ctx.fillText(`ПОСЛЕ · ${name}`, before.width + GAP * 2, 16);
    ctx.drawImage(before, GAP, labelH);
    ctx.drawImage(after, before.width + GAP * 2, labelH);
    const out = path.join(outDir, `${name}.png`);
    fs.writeFileSync(out, canvas.toBuffer("image/png"));
    console.log(`${name} → ${out} (${Math.round(fs.statSync(out).size / 1024)} КБ)`);
  }
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "sheet") await sheet(args[0], args[1], args[2] ?? "");
  else if (mode === "pairs") await pairs(args[0], args[1], args[2], (args[3] ?? "").split(",").filter(Boolean));
  else throw new Error("режим: sheet | pairs");
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
