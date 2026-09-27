/**
 * Скриншоты до/после для evidence: пары «до» (сверху) и «после» (снизу) с
 * подписями, опционально — в ч/б (яркость пикселя, как драйвер ч/б
 * принтера). Источники — растры shots.ts и e2e-print.ts во временной папке;
 * итог — PNG в папке задачи (`shots/`), ширина ≤ MAX_W.
 *
 * Запуск (из корня репо): npx tsx .agent/tasks/print-bw-2026-09/compose.ts
 */
import fs from "node:fs";
import path from "node:path";

import { GlobalFonts, createCanvas, loadImage, type Image } from "@napi-rs/canvas";

const TMP = path.resolve(process.env.BW_TMP ?? "D:/wt-build/tmp-bwprint");
const OUT = path.join(process.cwd(), ".agent", "tasks", "print-bw-2026-09", "shots");
const MAX_W = 1000;
// Подписи — кириллицей: шрифт бланков (у холста по умолчанию кириллицы нет).
const FONT_DIR = path.join(process.cwd(), "src", "lib", "pdf-fonts");
GlobalFonts.registerFromPath(path.join(FONT_DIR, "DejaVuSans.ttf"), "DejaVu Sans");
GlobalFonts.registerFromPath(path.join(FONT_DIR, "DejaVuSans-Bold.ttf"), "DejaVu Sans Bold");
const LABEL_H = 26;

type Pair = { name: string; before: string; after: string; caption: string; gray?: boolean; crop?: { x: number; y: number; w: number; h: number } };

const PAIRS: Pair[] = [
  { name: "pdf-hygiene-weekends", before: "shots/before/hygiene-may.png", after: "shots/after/hygiene-may.png", caption: "PDF гигиены, май 2026: праздник 1, 9, 11 мая, выходные 2–3, 9–10 мая, сокращённый 8 мая" },
  { name: "pdf-hygiene-weekends-bw", before: "shots/before/hygiene-may-bw.png", after: "shots/after/hygiene-may-bw.png", caption: "Тот же лист на ч/б принтере (яркость пикселя)" },
  { name: "pdf-cleaning-legend", before: "shots/before/cleaning-may.png", after: "shots/after/cleaning-may.png", caption: "PDF уборки за май: колонки дней и легенда «Выходной или праздник / Сокращённый день / Рабочий день»", crop: { x: 0, y: 220, w: 1287, h: 210 } },
  { name: "pdf-cold-deviations", before: "shots/before/cold-deviations.png", after: "shots/after/cold-deviations.png", caption: "PDF температуры холодильников с отклонениями от нормы (отклонения и до правки печатались без цвета — менять нечего)", crop: { x: 0, y: 0, w: 1218, h: 470 } },
  { name: "pdf-calibration-overdue", before: "shots/before/calibration.png", after: "shots/after/calibration.png", caption: "PDF графика поверки: просроченная дата — было красным жирным, стало чёрным жирным на серой заливке" },
  { name: "pdf-calibration-overdue-bw", before: "shots/before/calibration-bw.png", after: "shots/after/calibration-bw.png", caption: "График поверки на ч/б принтере: красный был почти как обычный текст, серая заливка видна" },
  { name: "pdf-checklist", before: "shots/before/checklist.png", after: "shots/after/checklist.png", caption: "PDF чек-листа уборки и проветривания (цвета не было — вне плитки QR без изменений)", crop: { x: 0, y: 0, w: 1218, h: 380 } },
  { name: "pdf-paper-blank", before: "shots/before/paper-ot_intro.png", after: "shots/after/paper-ot_intro.png", caption: "Бумажный бланк: тёмно-синие линии и текст, голубая шапка → чёрные линии и текст, серая шапка" },
  { name: "word-template", before: "shots/before/docx-hygiene.png", after: "shots/after/docx-hygiene.png", caption: "Word-шаблон (DOCX → PDF, LibreOffice): синий заголовок → чёрный", crop: { x: 90, y: 90, w: 740, h: 150 } },
  { name: "word-template-footer", before: "shots/before/docx-hygiene.png", after: "shots/after/docx-hygiene.png", caption: "Подвал Word-шаблона: подписи серые (QR — bwqr)", crop: { x: 440, y: 1140, w: 400, h: 100 } },
  { name: "screen-hygiene-light", before: "e2e/before/screen-hygiene-light.png", after: "e2e/after2/screen-hygiene-light.png", caption: "Сетка гигиены на экране, светлая тема (май 2026)" },
  { name: "screen-hygiene-dark", before: "e2e/before/screen-hygiene-dark.png", after: "e2e/after2/screen-hygiene-dark.png", caption: "Сетка гигиены на экране, тёмная тема" },
  { name: "screen-cleaning-light", before: "e2e/before/screen-cleaning-light.png", after: "e2e/after2/screen-cleaning-light.png", caption: "Сетка уборки с легендой дней, светлая тема" },
  { name: "screen-cleaning-dark", before: "e2e/before/screen-cleaning-dark.png", after: "e2e/after2/screen-cleaning-dark.png", caption: "Сетка уборки с легендой дней, тёмная тема" },
  { name: "browser-print-hygiene", before: "e2e/before/print-hygiene-p1.png", after: "e2e/after/print-hygiene-p1.png", caption: "Печать гигиены из браузера (Chrome, «Печать»), первый лист", crop: { x: 0, y: 0, w: 1287, h: 520 } },
  { name: "server-certificate", before: "e2e/before/server-certificate-p1.png", after: "e2e/after/server-certificate-p1.png", caption: "Сертификат организации: индиго-рамка и акценты → чёрный и серые (QR — задача bwqr)", crop: { x: 0, y: 0, w: 910, h: 760 } },
  { name: "server-inspector-summary", before: "e2e/before/server-inspector-summary-p2.png", after: "e2e/after/server-inspector-summary-p2.png", caption: "Сводка для проверяющего, лист 2: синяя «электронная отметка» → чёрная", crop: { x: 60, y: 600, w: 800, h: 300 } },
];

async function load(rel: string): Promise<Image | null> {
  const file = path.join(TMP, rel);
  return fs.existsSync(file) ? loadImage(fs.readFileSync(file)) : null;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
  for (const pair of PAIRS) {
    if (only && !only.has(pair.name)) continue;
    const images = [await load(pair.before), await load(pair.after)];
    if (!images[0] || !images[1]) {
      console.log(`${pair.name}: нет исходника`);
      continue;
    }
    const crop = pair.crop;
    const srcW = crop ? crop.w : Math.max(images[0].width, images[1].width);
    const scale = Math.min(1, MAX_W / srcW);
    const partH = (img: Image) => Math.round((crop ? crop.h : img.height) * scale);
    const width = Math.round(srcW * scale);
    const height = LABEL_H * 3 + partH(images[0]) + partH(images[1]) + 12;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#000000";
    ctx.font = "14px \"DejaVu Sans Bold\"";
    ctx.fillText(pair.caption.slice(0, 150), 6, 18);
    let y = LABEL_H;
    for (const [index, img] of images.entries()) {
      ctx.fillStyle = index === 0 ? "#555555" : "#000000";
      ctx.font = "13px \"DejaVu Sans Bold\"";
      ctx.fillText(index === 0 ? "ДО (master 495c4fc4)" : "ПОСЛЕ (эта ветка)", 6, y + 17);
      y += LABEL_H;
      const h = partH(img);
      if (crop) ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, y, width, h);
      else ctx.drawImage(img, 0, 0, img.width, img.height, 0, y, Math.round(img.width * scale), h);
      y += h + 6;
    }
    const file = path.join(OUT, `${pair.name}.png`);
    fs.writeFileSync(file, canvas.toBuffer("image/png"));
    console.log(`${pair.name}: ${width}×${height}, ${(fs.statSync(file).size / 1024).toFixed(0)} КБ`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
