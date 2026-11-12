import assert from "node:assert/strict";
import test from "node:test";

import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { JOURNAL_COVERS, coverDate, journalCover } from "@/lib/journal-cover-pdf";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";

async function pages(bytes: Buffer): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableWorker: true, isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: standardFontsDir() } as Parameters<typeof pdfjs.getDocument>[0]);
  try {
    const pdf = await task.promise;
    const out: string[] = [];
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const content = await (await pdf.getPage(i)).getTextContent();
      out.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " "));
    }
    return out;
  } finally {
    await task.destroy();
  }
}

test("титульник: 11 журналов из образцов владельца, СанПиН-приложения 1–5", () => {
  assert.equal(Object.keys(JOURNAL_COVERS).length, 11);
  assert.equal(journalCover("hygiene")?.appendix, "Приложение N 1");
  assert.equal(journalCover("perishable_rejection")?.appendix, "Приложение N 5");
  assert.equal(journalCover("cleaning"), null);
  assert.deepEqual(coverDate(null), { day: "\"___\" __________", year: "20___ г." });
  assert.deepEqual(coverDate(new Date("2026-11-11T22:00:00Z")), { day: "\"12\" ноября", year: "2026 г." });
});

test("титульник — первой страницей при печати, бланк и его нумерация не меняются", async () => {
  const input = buildJournalSampleInput("hygiene");
  const plain = await pages(renderJournalDocumentPdf(input).buffer);
  const withCover = await pages(renderJournalDocumentPdf({ ...input, cover: true }).buffer);
  assert.equal(withCover.length, plain.length + 1);
  assert.match(withCover[0], /ГИГИЕНИЧЕСКИЙ ЖУРНАЛ/);
  assert.match(withCover[0], /Приложение N 1/);
  assert.match(withCover[0], /Ответственный за ведение журнала/);
  assert.match(withCover[0], /Журнал начат/);
  assert.ok(!/СТР\. 1 ИЗ/i.test(withCover[0]), "у титульника нет номера страницы");
  assert.equal(withCover[1], plain[0]);
  // Журнал без титульника и другой язык — как раньше.
  assert.equal((await pages(renderJournalDocumentPdf({ ...buildJournalSampleInput("cleaning"), cover: true }).buffer)).length, (await pages(renderJournalDocumentPdf(buildJournalSampleInput("cleaning")).buffer)).length);
  assert.equal((await pages(renderJournalDocumentPdf({ ...input, cover: true, locale: "en" }).buffer)).length, (await pages(renderJournalDocumentPdf({ ...input, locale: "en" }).buffer)).length);
});
