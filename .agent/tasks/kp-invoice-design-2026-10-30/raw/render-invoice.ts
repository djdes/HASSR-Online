/**
 * Счёт в новом дизайне без базы.
 * npx tsx .agent/tasks/kp-invoice-design-2026-10-30/raw/render-invoice.ts [out-dir]
 */
import fs from "node:fs";
import path from "node:path";

import { createCanvas } from "@napi-rs/canvas";

import { brandSeller } from "@/lib/brand-docs/pdf-kit";
import { buildSellerSnapshot } from "@/lib/closing-documents/build";
import { EMPTY_REQUISITES } from "@/lib/closing-documents/types";
import { buildInvoiceDraft } from "@/lib/invoices/build";
import { renderInvoicePdf } from "@/lib/invoices/pdf";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";

const out = process.argv[2] ?? path.join(process.cwd(), ".agent/tasks/kp-invoice-design-2026-10-30/raw/out");
fs.mkdirSync(out, { recursive: true });

const requisites = {
  ...EMPTY_REQUISITES,
  nameFull: "Общество с ограниченной ответственностью «БФС»",
  nameShort: "ООО «БФС»",
  inn: "5018215599",
  kpp: "501801001",
  ogrn: "1235000105306",
  address: "141065, Московская область, г. Королёв, ул. Ленина, д. 10/6",
  bank: { name: "АО «ТЕСТОВЫЙ БАНК»", bik: "044500000", account: "40702810000000000001", corrAccount: "30101810000000000001" },
  head: { post: "Генеральный директор", name: "Волков Денис Владимирович" },
  email: "admin@wesetup.ru",
  phone: "+74951096543",
};

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
  return doc.numPages;
}

async function main() {
  const draft = buildInvoiceDraft({
    order: { id: 1287, createdAt: new Date("2026-10-30T09:00:00Z"), amountRub: 3000, bundleConfig: null },
    tariff: { title: "Стандарт, 1 точка", periodDays: 30, priceRub: 3000 },
    seller: buildSellerSnapshot(requisites),
    buyer: {
      name: "Общество с ограниченной ответственностью «Центр детского отдыха и молодежных инициатив»",
      inn: "7707083893",
      kpp: "773101001",
      ogrn: "1027700132195",
      address: "Россия, г. Москва, ул. Горбунова, д. 2, стр. 3, этаж 8, помещение II, комната 38Д, офис 19А",
      head: null,
    },
  });
  draft.basis = "Договор № WS-2026/0001 от 29.10.2026";
  const bytes = renderInvoicePdf(draft, { facsimile: null, stamp: null }, { brand: brandSeller({ ...requisites, site: "wesetup.ru" }) });
  fs.writeFileSync(path.join(out, "invoice.pdf"), bytes);
  console.log("invoice pages", await toPng(bytes, "invoice"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
