import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { loadMessages } from "@/i18n/messages";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { PERISHABLE_REJECTION_DOCUMENT_TITLE, normalizePerishableRejectionConfig } from "@/lib/perishable-rejection-document";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";

test("perishable actual PDF covers blank/single/multipage RU EN UZ exports with custom columns and legacy signatures intact", async () => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  for (const locale of ["ru", "en", "uz"] as const) for (const rowCount of [0, 1, 40]) {
    const sample = buildJournalSampleInput("perishable_rejection");
    const config = normalizePerishableRejectionConfig({
      columns: { labels: { note: "Custom column O‘rik" }, hidden: [], custom: [{ key: "custom:original", label: "Custom original", type: "text" }] },
      showNote: true,
      rows: Array.from({ length: rowCount }, (_, index) => ({ id: `original-${index}`, productName: `Original O‘rik ${index}`, arrivalDate: "2026-10-15", arrivalTime: "23:30", productionDate: "2026-10-14", manufacturer: "Original manufacturer", supplier: "Original supplier", packaging: "Original packaging", quantity: "20 кг", documentNumber: "CERT-001", organolepticResult: "poor_quality", storageCondition: "minus18", expiryDate: "2026-10-16", expiryTime: "11:30", actualSaleDate: "2026-10-16", actualSaleTime: "08:00", responsiblePerson: "Иван, Особая должность", note: "Custom note", custom: { "custom:original": "Customer O‘zgarmas" }, signatures: index === 0 ? [{ userId: "signer-1", name: "Original signer", role: "Председатель", signedAt: "2026-10-15T07:00:00Z", method: "session" }] : [] })),
    });
    const before = JSON.stringify(config);
    const rendered = renderJournalDocumentPdf({ ...sample, locale, document: { ...sample.document, title: PERISHABLE_REJECTION_DOCUMENT_TITLE, config: config as unknown as typeof sample.document.config, dateFrom: new Date("2026-10-01T00:00:00Z"), dateTo: new Date("2026-10-31T00:00:00Z") } });
    if (process.env.CAPTURE_PERISHABLE_PDF === "1") writeFileSync(`.agent/tasks/english-version-1375e736/batches/perishable-rejection/sample-${locale}-${rowCount}.pdf`, rendered.buffer);
    const task = pdfjs.getDocument({ data: new Uint8Array(rendered.buffer), disableWorker: true, isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: standardFontsDir() } as Parameters<typeof pdfjs.getDocument>[0]);
    try {
      const pdf = await task.promise;
      if (rowCount === 40) assert.ok(pdf.numPages > 1);
      const parts: string[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        for (const item of content.items) if ("str" in item && item.str.trim()) {
          parts.push(item.str);
          assert.ok(item.transform[4] >= -1 && item.transform[4] + item.width <= viewport.width + 1, `${locale}: text outside PDF page: ${item.str}`);
        }
      }
      const text = parts.join(" ").replace(/\s+/g, " ");
      const m = (await loadMessages(locale)).perishableRejection;
      for (const expected of [m.title.toUpperCase(), m.columns.supplier, "Custom column O‘rik", "Custom original"]) assert.ok(text.includes(expected), `${locale}: ${expected}`);
      if (rowCount) for (const expected of [m.organoleptic.poor_quality, m.storage.minus18, m.signatures.title, "Original O‘rik", "Original signer (Председатель)", "Иван, Особая должность", "Customer O‘zgarmas", "23:30", "10:00", "11:30"]) assert.ok(text.includes(expected), `${locale}: ${expected}`);
      else { assert.ok(!text.includes(m.organoleptic.poor_quality)); assert.ok(!text.includes(m.storage.minus18)); }
      if (locale !== "ru") assert.doesNotMatch(text, /ЖУРНАЛ БРАКЕРАЖА|Недоброкачественно|Подписи бракеражной комиссии|Дата и час, поступления/);
      assert.equal(JSON.stringify(config), before);
    } finally { await task.destroy(); }
  }
});
