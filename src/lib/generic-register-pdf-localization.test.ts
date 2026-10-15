import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { loadMessages } from "@/i18n/messages";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { REGISTER_JOURNALS } from "@/lib/register-journals";
import { parseRegisterFields, type RegisterField } from "@/lib/register-document";
import { presentRegisterField, registerCell } from "@/components/journals/generic-register-presentation";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";

for (const journal of REGISTER_JOURNALS) test(`${journal.code}: nine real PDFs preserve values/custom metadata/showIf and localize RU/EN/UZ`, async () => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  for (const locale of ["ru", "en", "uz"] as const) for (const count of [0, 1, 45]) {
    const sample = buildJournalSampleInput(journal.code), messages = await loadMessages(locale);
    const config = {
      rows: Array.from({ length: count }, (_, index) => ({ id: `original-${index}`, values: Object.fromEntries(journal.fields.map(field => [field.key,
        field.type === "date" ? "2026-10-15" : field.type === "time" ? "12:30" : field.type === "number" ? "12.5" : field.type === "select" ? field.options![index % field.options!.length].value : "Customer O‘rik original"
      ])) })),
      defaultResponsibleUserId: "person-id", defaultResponsibleTitle: "Original job", finishedAt: null,
    };
    let fields = parseRegisterFields(journal.fields);
    const selected = journal.fields.find(field => field.type === "select");
    if (count === 1) {
      fields = fields.map(field => field.key === (selected?.key ?? journal.titleKey) ? { ...field, label: "Custom column", options: field.options.map(option => ({ ...option, label: "Custom option" })) } : field);
      const conditionKey = selected?.key ?? journal.titleKey, conditionValue = config.rows[0].values[conditionKey];
      const extra: RegisterField[] = [
        { key: "customVisible", label: "Customer visible", type: "text", required: false, options: [], showIf: { field: conditionKey, equals: conditionValue } },
        { key: "customHidden", label: "Customer hidden", type: "text", required: false, options: [], showIf: { field: conditionKey, equals: "different original" } },
        { key: "customEmployee", label: "Customer employee", type: "employee", required: false, options: [], showIf: null },
        { key: "customEquipment", label: "Customer equipment", type: "equipment", required: false, options: [], showIf: null },
      ];
      fields.push(...extra); Object.assign(config.rows[0].values, { customVisible: "Visible original", customHidden: "MUST NOT APPEAR", customEmployee: "original-person", customEquipment: "original-equipment" });
    }
    if (count === 45 && selected) config.rows[44].values[selected.key] = "Unknown customer option";
    const before = JSON.stringify({ config, fields });
    const result = renderJournalDocumentPdf({ ...sample, locale, users: [{ id: "original-person", name: "Original person", email: "", positionTitle: "", role: "cook" }], equipment: [{ id: "original-equipment", name: "Original machine" }], document: { ...sample.document, title: count === 1 ? "Original custom document" : journal.name, template: { ...sample.document.template, fields }, config } });
    if (process.env.CAPTURE_GENERIC_REGISTER_PDF === "1") writeFileSync(`.agent/tasks/english-version-1375e736/batches/generic-register/sample-${journal.code}-${locale}-${count}.pdf`, result.buffer);
    const task = pdfjs.getDocument({ data: new Uint8Array(result.buffer), disableWorker: true, isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: standardFontsDir() } as Parameters<typeof pdfjs.getDocument>[0]);
    try {
      const pdf = await task.promise; if (count === 45) assert.ok(pdf.numPages > 1);
      const parts: string[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber), viewport = page.getViewport({ scale: 1 }), content = await page.getTextContent();
        for (const item of content.items) if ("str" in item && item.str.trim()) {
          parts.push(item.str);
          assert.ok(item.transform[4] >= -1 && item.transform[4] + item.width <= viewport.width + 1, `${locale}/${count}: outside width ${item.str}`);
          assert.ok(item.transform[5] >= -1 && item.transform[5] <= viewport.height + 1, `${locale}/${count}: outside height ${item.str}`);
        }
      }
      const text = parts.join(" ").replace(/\s+/g, " "), compact = (value: string) => value.replace(/\s/g, "").toLowerCase(), compactText = compact(text);
      assert.ok(compactText.includes(compact(messages.journals.names[journal.code as keyof typeof messages.journals.names])), `${locale}/${count}: title`);
      for (const field of fields) assert.ok(compactText.includes(compact(presentRegisterField(journal.code, field, messages).displayLabel)), `${locale}/${count}: ${field.key} header`);
      if (count) assert.ok(compactText.includes(compact("Customer O‘rik original")));
      if (count === 1) for (const expected of ["Original custom document", "Custom column", "Visible original", "Original person", "Original machine", ...(selected ? ["Custom option"] : [])]) assert.ok(compactText.includes(compact(expected)), `${locale}/${count}: ${expected}`);
      if (count === 45) for (const field of journal.fields.filter(field => field.type === "select")) {
        for (const option of field.options!) assert.ok(compactText.includes(compact(registerCell(journal.code, field, option.value, locale, messages))), `${locale}/${count}: ${field.key}/${option.value}`);
        if (field === selected) assert.ok(compactText.includes(compact("Unknown customer option")));
      }
      assert.ok(!text.includes("MUST NOT APPEAR")); assert.equal(JSON.stringify({ config, fields }), before);
    } finally { await task.destroy(); }
  }
});
