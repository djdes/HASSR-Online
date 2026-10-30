/**
 * КП в новом дизайне без базы — посмотреть вёрстку глазами.
 * npx tsx .agent/tasks/kp-invoice-design-2026-10-30/raw/render-kp.ts [out-dir]
 */
import fs from "node:fs";
import path from "node:path";

import { createCanvas } from "@napi-rs/canvas";

import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";
import { buildProposalContent } from "@/lib/proposal/content";
import { renderProposalPdfDocument } from "@/lib/proposal/pdf";
import { SAMPLE_PROMO_LIFETIME, sampleProposalContext } from "@/lib/proposal/sample";
import type { ProposalVars } from "@/lib/proposal/types";
import { addresseePostLine, formalGreeting, fullNameDative } from "@/lib/russian-names";

const out = process.argv[2] ?? path.join(process.cwd(), ".agent/tasks/kp-invoice-design-2026-10-30/raw/out");
fs.mkdirSync(out, { recursive: true });

async function toPng(bytes: Buffer, file: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableWorker: true, isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: standardFontsDir() } as Parameters<typeof pdfjs.getDocument>[0]);
  const doc = await task.promise;
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport } as Parameters<typeof page.render>[0]).promise;
    fs.writeFileSync(path.join(out, `${file}-${n}.png`), canvas.toBuffer("image/png"));
  }
  await task.destroy();
}

async function main() {
  const director = "Куликова Виктория Викторовна";
  const base: ProposalVars = {
    sphere: "education",
    companyName: "ООО «Центр детского отдыха и молодежных инициатив»",
    addressee: `${addresseePostLine("Генеральный директор")} ${fullNameDative(director)}`,
    greeting: formalGreeting(director),
    sender: { name: "Волков Денис Владимирович", position: "Генеральный директор", phone: "+7 (495) 109-65-43", email: "admin@wesetup.ru" },
  };
  const variants: Array<[string, ProposalVars]> = [
    ["kp-standard", { ...base, plan: "standard" }],
    ["kp-premium", { ...base, plan: "premium" }],
    ["kp-mailing-default", { sphere: "cafe", companyName: "Кафе «Ромашка»", recipientName: "Анна Сергеевна", promo: SAMPLE_PROMO_LIFETIME }],
  ];
  const context = sampleProposalContext({
    requisites: {
      ...sampleProposalContext().requisites!,
      nameFull: "Общество с ограниченной ответственностью «БФС»",
      nameShort: "ООО «БФС»",
      inn: "5018215599",
      kpp: "501801001",
      ogrn: "1235000105306",
      address: "141065, Московская область, г. Королёв, ул. Ленина, д. 10/6",
      phone: "+74951096543",
      email: "admin@wesetup.ru",
    },
  });
  for (const [name, vars] of variants) {
    const render = renderProposalPdfDocument(buildProposalContent(vars, context));
    fs.writeFileSync(path.join(out, `${name}.pdf`), render.buffer);
    await toPng(render.buffer, name);
    console.log(name, "pages", render.pages, "scale", render.scale, "qr", render.qr.url, render.qr.module.toFixed(2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
