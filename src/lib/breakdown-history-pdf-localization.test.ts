import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { loadMessages } from "@/i18n/messages";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { BREAKDOWN_HISTORY_DOCUMENT_TITLE, createBreakdownRow } from "@/lib/breakdown-history-document";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";

test("breakdown actual PDF localizes all columns and preserves custom repair records across blank/single/multipage outputs", async () => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  for (const locale of ["ru", "en", "uz"] as const) for (const count of [0, 1, 45]) {
    const sample = buildJournalSampleInput("breakdown_history");
    const config = { rows: Array.from({ length: count }, (_, index) => createBreakdownRow({ id: `original-${index}`, startDate: "2026-10-15", startHour: "23", startMinute: "30", endDate: index % 2 ? "" : "2026-10-16", endHour: index % 2 ? "" : "01", endMinute: index % 2 ? "" : "05", equipmentName: "Original equipment", sourceEquipmentId: "equipment-id", breakdownDescription: "Original description", repairPerformed: "Original repair", partsReplaced: "Original parts", downtimeHours: "1,5", responsiblePerson: "Original person" })) };
    if (count === 45) { config.rows[44].sourceEquipmentId = null; config.rows[44].equipmentName = "Custom unit O‘rik"; }
    const before = JSON.stringify(config);
    const result = renderJournalDocumentPdf({ ...sample, locale, equipment: [{ id: "equipment-id", name: "Renamed O‘rik equipment" }], document: { ...sample.document, title: count === 1 ? "Customer O‘rik document" : BREAKDOWN_HISTORY_DOCUMENT_TITLE, config, dateFrom: new Date("2026-10-01T00:00:00Z") } });
    if (process.env.CAPTURE_BREAKDOWN_PDF === "1") writeFileSync(`.agent/tasks/english-version-1375e736/batches/breakdown-history/sample-${locale}-${count}.pdf`, result.buffer);
    const task = pdfjs.getDocument({ data: new Uint8Array(result.buffer), disableWorker: true, isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: standardFontsDir() } as Parameters<typeof pdfjs.getDocument>[0]);
    try {
      const pdf = await task.promise;
      if (count === 45) assert.ok(pdf.numPages > 1);
      const parts: string[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber); const viewport = page.getViewport({ scale: 1 }); const content = await page.getTextContent();
        for (const item of content.items) if ("str" in item && item.str.trim()) { parts.push(item.str); assert.ok(item.transform[4] >= -1 && item.transform[4] + item.width <= viewport.width + 1, `${locale}: text outside page: ${item.str}`); }
      }
      const text = parts.join(" ").replace(/\s+/g, " "); const m = (await loadMessages(locale)).breakdownHistory;
      for (const expected of [m.title.toUpperCase(), ...Object.values(m.columns)]) assert.ok(text.includes(expected), `${locale}: ${expected}`);
      if (count) for (const expected of ["Renamed O‘rik equipment", "Original description", "Original repair", "Original parts", "Original person", "1,5", "23:30", "01:05"]) assert.ok(text.includes(expected), `${locale}/${count}: ${expected}`);
      if (count === 1) assert.ok(text.includes("Customer O‘rik document"));
      if (count === 45) assert.ok(text.includes("Custom unit O‘rik"));
      if (locale !== "ru") assert.doesNotMatch(text, /КАРТОЧКА ИСТОРИИ ПОЛОМОК|Выполненный ремонт|Часы простоя/);
      assert.equal(JSON.stringify(config), before);
    } finally { await task.destroy(); }
  }
});
