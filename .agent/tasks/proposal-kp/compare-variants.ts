/**
 * Две композиции листа А4 бок о бок: A — сверху вниз, предложение внизу
 * во всю ширину; B — основная колонка слева, панель предложения справа.
 * Одни и те же данные (кафе, промокод 10 % навсегда; детский сад без
 * промокода), 150 dpi, цвет и ч/б.
 *
 *   KP_OUT=d:/wt/tmp-kp/compare node --import tsx .agent/tasks/proposal-kp/compare-variants.ts
 *
 * Выбрана композиция A (обоснование — evidence.md); B удалена из pdf.ts
 * отдельным коммитом. Скрипт работает с `src/lib/proposal/pdf.ts` из
 * коммита 8bda0995, где у `renderProposalPdfDocument` ещё есть параметр
 * `layout` (`git show 8bda0995:src/lib/proposal/pdf.ts`).
 */
import fs from "node:fs";
import path from "node:path";

import { GlobalFonts, createCanvas, loadImage } from "@napi-rs/canvas";

import { buildProposalContent } from "@/lib/proposal/content";
import { renderProposalPdfDocument, type ProposalPdfLayout } from "@/lib/proposal/pdf";
import { SAMPLE_PROMO_LIFETIME, sampleProposalContext } from "@/lib/proposal/sample";
import type { ProposalVars } from "@/lib/proposal/types";

import { pageToPng } from "./preview";

const OUT = path.resolve(process.env.KP_OUT ?? "d:/wt/tmp-kp/compare");

// Системный sans-serif у skia без кириллицы — подписи тем же Manrope, что в КП.
GlobalFonts.registerFromPath(path.join(process.cwd(), "src", "lib", "pdf-fonts", "Manrope-ExtraBold.ttf"), "KpCaption");

async function sideBySide(files: string[], labels: string[], target: string) {
  const images = await Promise.all(files.map((file) => loadImage(fs.readFileSync(file))));
  const gap = 48;
  const head = 90;
  const width = images.reduce((sum, img) => sum + img.width, 0) + gap * (images.length + 1);
  const height = Math.max(...images.map((img) => img.height)) + head + gap;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e9ebf3";
  ctx.fillRect(0, 0, width, height);
  let x = gap;
  images.forEach((img, index) => {
    ctx.fillStyle = "#0b1024";
    ctx.font = "40px KpCaption";
    ctx.fillText(labels[index], x, 60);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x, head, img.width, img.height);
    ctx.drawImage(img, x, head);
    x += img.width + gap;
  });
  fs.writeFileSync(target, canvas.toBuffer("image/png"));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const cases: Array<[string, ProposalVars]> = [
    ["cafe", { sphere: "cafe", companyName: "Кафе «Ромашка»", recipientName: "Анна Сергеевна", promo: SAMPLE_PROMO_LIFETIME }],
    ["education", { sphere: "education", companyName: "Детский сад № 5 «Солнышко»", recipientName: null, promo: null }],
  ];
  for (const [name, vars] of cases) {
    const files: string[] = [];
    const grays: string[] = [];
    const labels: string[] = [];
    for (const layout of ["a", "b"] as ProposalPdfLayout[]) {
      const content = buildProposalContent(vars, sampleProposalContext());
      const render = renderProposalPdfDocument(content, { layout });
      const file = path.join(OUT, `${name}-${layout}.png`);
      const gray = path.join(OUT, `${name}-${layout}-bw.png`);
      await pageToPng(render.buffer, file, 150);
      await pageToPng(render.buffer, gray, 150, true);
      files.push(file);
      grays.push(gray);
      labels.push(`Вариант ${layout.toUpperCase()} · плотность ${render.scale}`);
      console.log(`${name} ${layout}: scale=${render.scale} bytes=${render.buffer.length}`);
    }
    await sideBySide(files, labels, path.join(OUT, `compare-a-b-${name}.png`));
    await sideBySide(grays, labels.map((label) => `${label} · ч/б`), path.join(OUT, `compare-a-b-${name}-bw.png`));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
