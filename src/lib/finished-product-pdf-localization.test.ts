import assert from "node:assert/strict";
import test from "node:test";
import { loadMessages } from "@/i18n/messages";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { FINISHED_PRODUCT_DOCUMENT_TITLE, normalizeFinishedProductDocumentConfig } from "@/lib/finished-product-document";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";

test("finished-product PDF uses the requested language and preserves custom cells, grades, titles and signatures", async () => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  for (const locale of ["ru", "en", "uz"] as const) {
    for (const rowCount of [1, 45]) {
      const sample = buildJournalSampleInput("finished_product");
      const config = normalizeFinishedProductDocumentConfig({
        footerNote: rowCount === 1 ? "Customer footer O‘tkir" : "Customer footer O‘tkir ".repeat(18),
        commissionMembers: [
          { employeeId: "employee-1", employeeName: "O‘tkir", role: "Custom role" },
          { employeeId: "employee-2", employeeName: "Chair person", role: "Председатель", roleKind: "chair" },
          { employeeId: "employee-3", employeeName: "Member person", role: "Член комиссии", roleKind: "member" },
          { employeeId: "employee-4", employeeName: "Custom person", role: "Председатель" },
        ],
        columns: { labels: { note: "Customer note" }, hidden: [] },
        rows: Array.from({ length: rowCount }, (_, index) => ({ id: `row-${index}`, productName: `O‘tkir dish ${index}`, productionDateTime: "2026-10-15 10:00", rejectionTime: "2026-10-15 10:05", releaseAllowed: "yes", releasePermissionTime: "2026-10-15 10:10", organoleptic: "Отлично", portionWeight: "200/10", note: "Original note", signatures: [{ userId: "employee-1", name: "O‘tkir", role: "Custom role", signedAt: "2026-10-15T07:06:00Z", journalAt: "2026-10-15 10:06", method: "session" }] })),
      });
      const before = JSON.stringify(config);
      const rendered = renderJournalDocumentPdf({ ...sample, locale, document: { ...sample.document, title: FINISHED_PRODUCT_DOCUMENT_TITLE, config: config as unknown as typeof sample.document.config, dateFrom: new Date("2026-10-01T00:00:00Z"), dateTo: new Date("2026-10-31T00:00:00Z") } });
      const task = pdfjs.getDocument({ data: new Uint8Array(rendered.buffer), disableWorker: true, isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: standardFontsDir() } as Parameters<typeof pdfjs.getDocument>[0]);
      try {
        const pdf = await task.promise;
        if (rowCount === 45) assert.ok(pdf.numPages > 1);
        const parts: string[] = [];
        for (let index = 1; index <= pdf.numPages; index++) {
          const page = await pdf.getPage(index);
          const viewport = page.getViewport({ scale: 1 });
          const content = await page.getTextContent();
          for (const item of content.items) if ("str" in item && item.str.trim()) {
            parts.push(item.str);
            assert.ok(item.transform[4] >= -1 && item.transform[4] + item.width <= viewport.width + 1, locale + " text outside page: " + item.str);
          }
        }
        const text = parts.join(" ").replace(/\s+/g, " ");
        const messages = (await loadMessages(locale)).finishedProduct;
        const roles = (await loadMessages(locale)).journalControls.commissionDialog;
        for (const expected of [`${roles.chair}: Chair person`, `${roles.member}: Member person`, "Председатель: Custom person"]) assert.ok(text.includes(expected), locale + ": " + expected);
        for (const expected of [messages.title.toUpperCase(), messages.grades.excellent, messages.fields.allowed, messages.commission.heading, "O‘tkir", "Custom role", "Customer note", "200/10", "Original note", "10:06", "Customer footer O‘tkir"]) assert.ok(text.includes(expected), locale + ": " + expected);
        if (locale !== "ru") assert.doesNotMatch(text, /ЖУРНАЛ БРАКЕРАЖА|Разрешено|Отлично|Состав бракеражной/);
        assert.equal(JSON.stringify(config), before);
      } finally { await task.destroy(); }
    }
  }
});
