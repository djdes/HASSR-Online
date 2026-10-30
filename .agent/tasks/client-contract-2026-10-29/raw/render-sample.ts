/**
 * Черновой рендер договора без базы — чтобы посмотреть вёрстку глазами.
 * Запуск (из корня worktree):
 *   npx tsx .agent/tasks/client-contract-2026-10-29/raw/render-sample.ts [out-dir]
 * Пишет contract-sample.pdf, contract-sample-ip.pdf, .docx и PNG всех листов.
 */
import fs from "node:fs";
import path from "node:path";

import { createCanvas } from "@napi-rs/canvas";

import { renderContractDocx } from "@/lib/contracts/docx";
import { renderContractPdf } from "@/lib/contracts/pdf";
import { buildContractDocument, CONTRACT_TEMPLATE_VERSION } from "@/lib/contracts/template";
import type { ContractSnapshot } from "@/lib/contracts/types";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";

const out = process.argv[2] ?? path.join(process.cwd(), ".agent/tasks/client-contract-2026-10-29/raw/out");
fs.mkdirSync(out, { recursive: true });

const seller: ContractSnapshot["seller"] = {
  nameFull: "Общество с ограниченной ответственностью «БФС»",
  nameShort: "ООО «БФС»",
  inn: "5018215599",
  kpp: "501801001",
  ogrn: "1235000105306",
  address: "141065, Московская область, г. Королёв, ул. Ленина, д. 10/6",
  bank: { name: "АО «Тестовый банк»", bik: "044500000", account: "40702810000000000001", corrAccount: "30101810000000000001" },
  head: { post: "Генеральный директор", name: "Волков Денис Владимирович" },
  vatMode: "none",
  email: "admin@wesetup.ru",
  phone: "+7 (495) 109-65-43",
  site: "wesetup.ru",
};

const legal: ContractSnapshot = {
  number: "WS-2026/0001",
  date: "2026-10-29",
  city: "Королёв",
  templateVersion: CONTRACT_TEMPLATE_VERSION,
  seller,
  buyer: {
    kind: "legal",
    nameFull: "Общество с ограниченной ответственностью «Центр детского отдыха и молодёжных инициатив»",
    nameShort: "ООО «ЦДОМИ»",
    inn: "7707083893",
    kpp: "773101001",
    ogrn: "1027700132195",
    legalAddress: "121087, г. Москва, ул. Горбунова, д. 2, стр. 3, этаж 8, помещение II, комната 38Д, офис 19А",
    actualAddress: null,
    phone: "+7 (900) 000-00-00",
    email: "buh@example.ru",
  },
  params: { signerName: "Куликова Виктория Викторовна", signerPost: "ГЕНЕРАЛЬНЫЙ ДИРЕКТОР", signerBasis: "Устава", useFacsimile: true },
};

const individual: ContractSnapshot = {
  ...legal,
  number: "WS-2026/____",
  buyer: {
    kind: "individual",
    nameFull: "Индивидуальный предприниматель Петров Пётр Петрович",
    nameShort: "ИП Петров Пётр Петрович",
    inn: "500100732259",
    kpp: null,
    ogrn: "304500116000157",
    legalAddress: null,
    actualAddress: null,
    phone: null,
    email: null,
  },
  params: { signerName: null, signerPost: null, signerBasis: null, useFacsimile: false },
};

async function pagesToPng(bytes: Buffer, prefix: string) {
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
    fs.writeFileSync(path.join(out, `${prefix}-${n}.png`), canvas.toBuffer("image/png"));
  }
  await task.destroy();
  return doc.numPages;
}

async function main() {
  for (const [name, snapshot] of [["contract-sample", legal], ["contract-sample-ip", individual]] as const) {
    const document = buildContractDocument(snapshot);
    const { bytes, pages } = renderContractPdf(document, snapshot.seller, { facsimile: null, stamp: null });
    fs.writeFileSync(path.join(out, `${name}.pdf`), bytes);
    fs.writeFileSync(path.join(out, `${name}.docx`), await renderContractDocx(document, snapshot.seller));
    const rendered = await pagesToPng(bytes, name);
    console.log(name, "pages", pages, rendered, "bytes", bytes.length);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
