import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { loadMessages } from "@/i18n/messages";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { ACCIDENT_DOCUMENT_TITLE, createAccidentRow } from "@/lib/accident-document";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";

test("accident actual PDF localizes all columns and preserves custom incident records across blank/single/multipage outputs", async () => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  for (const locale of ["ru", "en", "uz"] as const) for (const count of [0, 1, 45]) {
    const sample = buildJournalSampleInput("accident_journal");
    const config = { rows: Array.from({ length: count }, (_, index) => createAccidentRow({ id: `original-${index}`, accidentDate: "2026-10-15", accidentHour: "23", accidentMinute: "30", resolvedDate: "2026-10-16", resolvedHour: "01", resolvedMinute: "05", locationName: "O‘rik original room", accidentDescription: "Original description", affectedProducts: "Original 20 кг", responsiblePeople: "Original people", correctiveActions: "Original actions" })) };
    const before = JSON.stringify(config);
    const result = renderJournalDocumentPdf({ ...sample, locale, document: { ...sample.document, title: ACCIDENT_DOCUMENT_TITLE, config, dateFrom: new Date("2026-10-01T00:00:00Z") } });
    if (process.env.CAPTURE_ACCIDENT_PDF === "1") writeFileSync(`.agent/tasks/english-version-1375e736/batches/accident-journal/sample-${locale}-${count}.pdf`, result.buffer);
    const task = pdfjs.getDocument({ data: new Uint8Array(result.buffer), disableWorker: true, isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: standardFontsDir() } as Parameters<typeof pdfjs.getDocument>[0]);
    try {
      const pdf = await task.promise;
      if (count === 45) assert.ok(pdf.numPages > 1);
      const parts: string[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber); const viewport = page.getViewport({ scale: 1 }); const content = await page.getTextContent();
        for (const item of content.items) if ("str" in item && item.str.trim()) { parts.push(item.str); assert.ok(item.transform[4] >= -1 && item.transform[4] + item.width <= viewport.width + 1, `${locale}: text outside page: ${item.str}`); }
      }
      const text = parts.join(" ").replace(/\s+/g, " "); const m = (await loadMessages(locale)).accidentJournal;
      for (const expected of [m.title.toUpperCase(), ...Object.values(m.columns)]) assert.ok(text.includes(expected), `${locale}: ${expected}`);
      if (count) for (const expected of ["O‘rik original room", "Original description", "Original 20 кг", "Original people", "Original actions", "23:30", "01:05"]) assert.ok(text.includes(expected));
      if (locale !== "ru") assert.doesNotMatch(text, /ЖУРНАЛ УЧЕТА АВАРИЙ|Мероприятия \(корректирующие действия\)|Дата и время аварии/);
      assert.equal(JSON.stringify(config), before);
    } finally { await task.destroy(); }
  }
});
