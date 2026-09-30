// Помощник e2e bzhgp на модулях проекта. Запуск из d:/wt/bzhgp (tsx, пути @/…):
//   token <orgId> <docId>          → QR-токен журнала БЖГП
//   pdf <in.pdf> <out-prefix>      → текст PDF и PNG каждой страницы
//   docx <out.docx>                → образец Word БЖГП и его таблица
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { mintQrFillToken } from "d:/wt/bzhgp/src/lib/qr-fill-token";
import { countPdfPages, renderPdfPageToPng } from "d:/wt/bzhgp/src/lib/journal-preview/render-pages";
import { renderJournalDocumentDocx } from "d:/wt/bzhgp/src/lib/document-docx";
import { buildJournalSampleInput } from "d:/wt/bzhgp/src/lib/journal-sample-fixtures";

// Пакеты — из node_modules рабочей копии (помощник лежит вне проекта).
const projectRequire = createRequire("d:/wt/bzhgp/package.json");

async function pdfText(data: Uint8Array): Promise<string[]> {
  const pdfjs = (await import(
    pathToFileURL("d:/wt/bzhgp/node_modules/pdfjs-dist/legacy/build/pdf.mjs").href
  )) as typeof import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: data.slice(), useSystemFonts: false, isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return pages;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "token") {
    const [orgId, docId] = args;
    console.log(JSON.stringify({ token: mintQrFillToken("journal", `${orgId}:finished_product:${docId}`) }));
    return;
  }
  if (cmd === "pdf") {
    const [file, prefix] = args;
    const data = new Uint8Array(fs.readFileSync(file));
    const pages = await pdfText(data);
    const count = await countPdfPages(data.slice());
    const png: string[] = [];
    for (let n = 1; n <= count; n += 1) {
      const sheet = await renderPdfPageToPng(data.slice(), n, { width: 1600 });
      const out = `${prefix}-p${n}.png`;
      fs.writeFileSync(out, sheet.png);
      png.push(out);
    }
    console.log(JSON.stringify({ pages, png }));
    return;
  }
  if (cmd === "docx") {
    const [out] = args;
    const { buffer } = await renderJournalDocumentDocx(buildJournalSampleInput("finished_product"), "finished_product");
    fs.writeFileSync(out, buffer);
    const JSZip = projectRequire("jszip") as typeof import("jszip");
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("string");
    const cells = [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]);
    console.log(JSON.stringify({ cells, times: cells.filter((c) => /\d{1,2}:\d{2}/.test(c)) }));
    return;
  }
  throw new Error(`неизвестная команда ${cmd}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
