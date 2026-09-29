/**
 * Предпросмотр КП без базы и сервера: PDF → PNG первой страницы (pdf.js +
 * @napi-rs/canvas). Для подбора вёрстки.
 *
 *   KP_OUT=d:/wt/tmp-kp/preview node --import tsx .agent/tasks/proposal-kp/preview.ts [sphere...]
 *
 * Данные — образец (`src/lib/proposal/sample.ts`): тариф 1 990 ₽, бесплатный период
 * по умолчанию, условные реквизиты и отправитель.
 */
import fs from "node:fs";
import path from "node:path";

import { createCanvas } from "@napi-rs/canvas";

import { buildProposalContent } from "@/lib/proposal/content";
import { renderProposalPdfDocument } from "@/lib/proposal/pdf";
import type { ProposalVars } from "@/lib/proposal/types";

import { openPdf } from "../journal-qr-header-2026-09/qr-sim";
import { SAMPLE_PROMO_LIFETIME, SAMPLE_PROMO_UNTIL, sampleProposalContext } from "@/lib/proposal/sample";

const OUT = path.resolve(process.env.KP_OUT ?? "d:/wt/tmp-kp/preview");

export async function pageToPng(pdf: Buffer, file: string, dpi = 150, grayscale = false): Promise<void> {
  const doc = await openPdf(pdf);
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: dpi / 72 });
  const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
  if (grayscale) {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, canvas.toBuffer("image/png"));
  await doc.close();
}

async function main() {
  const spheres = process.argv.slice(2);
  const list = (spheres.length ? spheres : ["cafe"]) as ProposalVars["sphere"][];
  for (const sphere of list) {
    const promoKey = process.env.KP_PROMO ?? "lifetime";
    const vars: ProposalVars = {
      sphere,
      companyName: process.env.KP_COMPANY ?? "Кафе «Ромашка»",
      recipientName: process.env.KP_RECIPIENT ?? "Анна Сергеевна",
      promo: promoKey === "none" ? null : promoKey === "until" ? SAMPLE_PROMO_UNTIL : SAMPLE_PROMO_LIFETIME,
    };
    const content = buildProposalContent(vars, sampleProposalContext());
    const render = renderProposalPdfDocument(content);
    const base = path.join(OUT, `${sphere}${process.env.KP_TAG ? `-${process.env.KP_TAG}` : ""}`);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(`${base}.pdf`, render.buffer);
    await pageToPng(render.buffer, `${base}.png`, 150);
    console.log(`${sphere}: pages=${render.pages} scale=${render.scale} size=${render.buffer.length} → ${base}.png`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("preview.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
