/**
 * Перерисовка миниатюр образцов журналов (`public/journal-samples/*.png` и
 * `*.webp`) после смены шрифта и названий — без сайта и браузера.
 *
 * Продуктовый `scripts/render-journal-sample-thumbs.ts` снимает PDF с
 * запущенного сайта встроенным просмотрщиком Chromium. Здесь тот же PDF
 * (что отдаёт `/api/journal-samples/<код>/pdf?inline=1`: образец + QR на /qb,
 * бумажные бланки — то же для `/paper/<id>`) собирается в процессе и
 * растрируется pdf.js в той же геометрии: страница во всю ширину 1228 px,
 * кадр 1228 × 862 сверху (так резал скрипт), WebP 768 × 539 — как было.
 *
 *   node --import tsx .agent/tasks/pdf-continuation-2026-09/sample-thumbs.ts [папка]
 */
process.env.NEXTAUTH_SECRET ||= "journal-qr-header-pages-secret-0123456789";
process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "journal-qr-header-pages-secret-0123456789";

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { createCanvas, loadImage } from "@napi-rs/canvas";

import { blankPdfQr } from "@/lib/blank-qr-token";
import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { SAMPLE_JOURNAL_CODES, SAMPLE_ORGANIZATION, buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { renderPaperJournalPdf } from "@/lib/paper-journal-pdf";
import { PAPER_JOURNALS } from "@/lib/sphere-journal-rules";

import { openPdf } from "../journal-qr-header-2026-09/qr-sim";

const requireCjs = createRequire(__filename);
const ORIGIN = "https://wesetup.ru";
const WIDTH = 1228;
const HEIGHT = 862;
const THUMB_WIDTH = 768;
const THUMB_HEIGHT = 539;

async function pagePng(pdf: Buffer): Promise<Buffer> {
  const doc = await openPdf(pdf);
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  // Двойное разрешение и уменьшение — тонкие линии не рвутся в пунктир.
  const scale = (WIDTH * 2) / base.width;
  const viewport = page.getViewport({ scale });
  const big = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
  const ctx = big.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, big.width, big.height);
  await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
  page.cleanup();
  await doc.close();
  const out = createCanvas(WIDTH, HEIGHT);
  const octx = out.getContext("2d");
  octx.fillStyle = "#ffffff";
  octx.fillRect(0, 0, WIDTH, HEIGHT);
  octx.drawImage(big, 0, 0, big.width, HEIGHT * 2, 0, 0, WIDTH, HEIGHT);
  // Бланки только ч/б и серые — PNG в оттенках серого (pngjs) легче RGBA на треть.
  const rgba = octx.getImageData(0, 0, WIDTH, HEIGHT).data;
  type PngCtor = {
    new (o: { width: number; height: number }): { data: Buffer };
    sync: { write: (png: unknown, o: Record<string, number>) => Buffer };
  };
  const { PNG } = requireCjs("pngjs") as { PNG: PngCtor };
  const png = new PNG({ width: WIDTH, height: HEIGHT });
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  return PNG.sync.write(png, { colorType: 0, inputColorType: 6, bitDepth: 8 });
}

async function webp(png: Buffer): Promise<Buffer> {
  const image = await loadImage(png);
  const canvas = createCanvas(THUMB_WIDTH, THUMB_HEIGHT);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
  ctx.drawImage(image, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
  return canvas.toBuffer("image/webp", 82);
}

async function main() {
  const out = path.resolve(process.argv[2] ?? path.join(process.cwd(), "public", "journal-samples"));
  fs.mkdirSync(out, { recursive: true });
  const jobs: Array<{ name: string; pdf: () => Buffer }> = [
    ...SAMPLE_JOURNAL_CODES.map((code) => ({
      name: code,
      pdf: () =>
        renderJournalDocumentPdf({
          ...buildJournalSampleInput(code),
          qr: blankPdfQr(ORIGIN, { target: { kind: "code", code }, email: null }),
        }).buffer,
    })),
    ...PAPER_JOURNALS.map((journal) => ({
      name: `paper_${journal.id}`,
      pdf: () =>
        renderPaperJournalPdf({
          journal,
          organization: SAMPLE_ORGANIZATION,
          rows: [],
          blankRows: 18,
          qr: blankPdfQr(ORIGIN, { target: { kind: "paper", paperId: journal.id }, email: null }),
        }),
    })),
  ];
  let bytes = 0;
  for (const job of jobs) {
    const png = await pagePng(job.pdf());
    const small = await webp(png);
    fs.writeFileSync(path.join(out, `${job.name}.png`), png);
    fs.writeFileSync(path.join(out, `${job.name}.webp`), small);
    bytes += png.length + small.length;
    console.log(`OK ${job.name}: png ${Math.round(png.length / 1024)} КБ, webp ${Math.round(small.length / 1024)} КБ`);
  }
  console.log(`${jobs.length} образцов, ${(bytes / 1048576).toFixed(1)} МБ → ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
