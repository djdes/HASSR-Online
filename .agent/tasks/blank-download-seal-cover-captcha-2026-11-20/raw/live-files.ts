/**
 * Live check (2026-11-20): signed links with and without the title page go to the
 * running `next dev`, the files come back and are inspected (pages, first-page text,
 * Word sections). Run: `npx tsx .agent/tasks/<id>/raw/live-files.ts <out-dir>`.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import JSZip from "jszip";

import { blankDownloadHref, signBlankDownloadToken } from "@/lib/blank-download-token";
import type { BlankFormat, BlankTarget } from "@/lib/blank-download";
import { PAPER_JOURNALS } from "@/lib/sphere-journal-rules";

const BASE = "http://127.0.0.1:3100";
const out = process.argv[2] ?? ".";

async function pdfPages(bytes: Buffer): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false } as Parameters<typeof pdfjs.getDocument>[0]);
  const pdf = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const content = await (await pdf.getPage(i)).getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " "));
  }
  await task.destroy();
  return pages;
}

async function fetchFile(target: BlankTarget, format: BlankFormat, cover: boolean, company?: string) {
  const token = signBlankDownloadToken({ email: "cook@example.com", target, format, company, cover });
  const response = await fetch(`${BASE}${blankDownloadHref(target, format, token)}`);
  return { status: response.status, type: response.headers.get("content-type"), bytes: Buffer.from(await response.arrayBuffer()) };
}

async function main() {
  const cases: Array<[string, BlankTarget, BlankFormat]> = [
    ["hygiene-pdf", { kind: "code", code: "hygiene" }, "pdf"],
    ["cleaning-pdf", { kind: "code", code: "cleaning" }, "pdf"],
    [`paper-${PAPER_JOURNALS[0].id}-pdf`, { kind: "paper", paperId: PAPER_JOURNALS[0].id }, "pdf"],
    ["hygiene-docx", { kind: "code", code: "hygiene" }, "docx"],
  ];
  for (const [name, target, format] of cases) {
    const plain = await fetchFile(target, format, false, "ООО «Ромашка»");
    const cover = await fetchFile(target, format, true, "ООО «Ромашка»");
    writeFileSync(`${out}/${name}-cover.${format}`, cover.bytes);
    if (format === "pdf") {
      const a = await pdfPages(plain.bytes);
      const b = await pdfPages(cover.bytes);
      console.log(`${name}: ${plain.status}/${cover.status} pages ${a.length} -> ${b.length}; cover page: ${b[0].slice(0, 170)}`);
      console.log(`  second page equals plain first page: ${b[1] === a[0]}`);
    } else {
      const xml = async (bytes: Buffer) => (await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string"));
      const [x, y] = [await xml(plain.bytes), await xml(cover.bytes)];
      const sections = (value: string) => (value.match(/<w:sectPr/g) ?? []).length;
      console.log(`${name}: ${plain.status}/${cover.status} sections ${sections(x)} -> ${sections(y)}; cover has «Журнал начат»: ${y.includes("Журнал начат")}, «ООО «Ромашка»»: ${y.includes("Ромашка")}`);
    }
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
