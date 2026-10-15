import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { loadMessages } from "@/i18n/messages";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { COMPLAINT_REGISTER_TITLE, COMPLAINT_RECEIPT_OPTIONS, buildComplaintRow } from "@/lib/complaint-document";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";
import type { RegisterField } from "@/lib/register-document";

// The sample registry intentionally does not include complaint fields. Use the
// seven actual persisted seed definitions, not a number-only export fixture.
const fields: RegisterField[] = [
  { key: "receiptDate", label: "Дата поступления", type: "date", required: true, options: [], showIf: null },
  { key: "applicantName", label: "ФИО заявителя", type: "text", required: true, options: [], showIf: null },
  { key: "complaintReceiptForm", label: "Форма поступления жалобы", type: "select", required: true, options: [...COMPLAINT_RECEIPT_OPTIONS], showIf: null },
  { key: "applicantDetails", label: "Реквизиты заявителя", type: "textarea", required: false, options: [], showIf: null },
  { key: "complaintContent", label: "Содержание жалобы", type: "textarea", required: true, options: [], showIf: null },
  { key: "decisionDate", label: "Дата решения", type: "date", required: false, options: [], showIf: null },
  { key: "decisionSummary", label: "Решение, краткое содержание", type: "textarea", required: false, options: [], showIf: null },
];

test("nine actual complaint PDFs localize built-in fields/options and preserve custom metadata, conditions and original records", async () => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  for (const locale of ["ru", "en", "uz"] as const) for (const count of [0, 1, 45]) {
    const sample = buildJournalSampleInput("complaint_register");
    const config = { rows: Array.from({ length: count }, (_, index) => buildComplaintRow({ id: `original-${index}`, receiptDate: "2026-10-15", applicantName: "Customer O‘rik", complaintReceiptForm: COMPLAINT_RECEIPT_OPTIONS[index % 5].value, applicantDetails: "Customer address", complaintContent: "Customer original complaint with original details", decisionDate: "2026-10-16", decisionSummary: "Customer original decision" })), defaultResponsibleUserId: "person-id", defaultResponsibleTitle: "Original job", finishedAt: null };
    let printFields = fields.map(field => ({ ...field, options: field.options.map(option => ({ ...option })) }));
    if (count === 1) {
      printFields = printFields.map(field => field.key === "complaintReceiptForm" ? { ...field, label: "Custom receipt column", options: [{ value: "по почте", label: "Customer custom option" }] } : field);
      printFields.push({ key: "customVisible", label: "Customer visible column", type: "text", required: false, options: [], showIf: { field: "complaintReceiptForm", equals: "по почте" } });
      printFields.push({ key: "customHidden", label: "Customer hidden column", type: "text", required: false, options: [], showIf: { field: "complaintReceiptForm", equals: "по телефону" } });
      config.rows[0].values.customVisible = "Original visible data";
      config.rows[0].values.customHidden = "MUST NOT APPEAR";
    }
    if (count === 45) config.rows[44].values.complaintReceiptForm = "Customer unknown method";
    const before = JSON.stringify({ config, printFields });
    const result = renderJournalDocumentPdf({ ...sample, locale, document: { ...sample.document, title: count === 1 ? "Customer O‘rik document" : COMPLAINT_REGISTER_TITLE, template: { ...sample.document.template, fields: printFields }, config, dateFrom: new Date("2026-01-01T00:00:00Z"), dateTo: new Date("2026-12-31T00:00:00Z") } });
    if (process.env.CAPTURE_COMPLAINT_PDF === "1") writeFileSync(`.agent/tasks/english-version-1375e736/batches/complaint-register/sample-${locale}-${count}.pdf`, result.buffer);
    const task = pdfjs.getDocument({ data: new Uint8Array(result.buffer), disableWorker: true, isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: standardFontsDir() } as Parameters<typeof pdfjs.getDocument>[0]);
    try {
      const pdf = await task.promise; if (count === 45) assert.ok(pdf.numPages > 1);
      const parts: string[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber), viewport = page.getViewport({ scale: 1 }), content = await page.getTextContent();
        for (const item of content.items) if ("str" in item && item.str.trim()) {
          parts.push(item.str);
          assert.ok(item.transform[4] >= -1 && item.transform[4] + item.width <= viewport.width + 1, `${locale}: outside page width ${item.str}`);
          assert.ok(item.transform[5] >= -1 && item.transform[5] <= viewport.height + 1, `${locale}: outside page height ${item.str}`);
        }
      }
      const text = parts.join(" ").replace(/\s+/g, " "), m = (await loadMessages(locale)).complaintRegister;
      for (const key of ["receiptDate", "applicantName", "complaintContent", "decisionDate", "decisionSummary"] as const) assert.ok(text.includes(m.fields[key]), `${locale}/${count}: ${m.fields[key]}`);
      assert.ok(text.toLowerCase().includes(m.title.toLowerCase()), `${locale}/${count}: localized title`);
      if (count) for (const expected of ["Customer O‘rik", "Customer address", "Customer original decision"]) assert.ok(text.includes(expected), `${locale}/${count}: ${expected}`);
      if (count === 1) for (const expected of ["Customer O‘rik document", "Custom receipt column", "Customer custom option", "Original visible data"]) assert.ok(text.includes(expected), `${locale}/${count}: ${expected}`);
      if (count === 45) { for (const expected of Object.values(m.receipt)) assert.ok(text.includes(expected), `${locale}: ${expected}`); assert.ok(text.includes("Customer unknown method")); }
      assert.ok(!text.includes("MUST NOT APPEAR"));
      if (locale !== "ru") assert.doesNotMatch(text, /Журнал регистрации жалоб|Дата поступления|Содержание жалобы/);
      assert.equal(JSON.stringify({ config, printFields }), before);
    } finally { await task.destroy(); }
  }
});
