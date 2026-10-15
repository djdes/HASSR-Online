import assert from "node:assert/strict";
import test from "node:test";
import { createTranslator } from "use-intl/core";
import { loadMessages } from "@/i18n/messages";
import { calibrationDate } from "@/components/journals/equipment-calibration-presentation";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { calculateNextCalibrationDate, EQUIPMENT_CALIBRATION_DOCUMENT_TITLE, normalizeEquipmentCalibrationConfig } from "@/lib/equipment-calibration-document";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";

test("calibration PDF translates all static text and UTC dates while preserving stored instrument values", async () => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  for (const locale of ["ru", "en", "uz"] as const) {
    for (const rowCount of [1, 45]) {
      const sample = buildJournalSampleInput("equipment_calibration");
      const config = normalizeEquipmentCalibrationConfig({ year: 2026, documentDate: "2026-02-03", approveRole: "Управляющий", approveEmployee: "O‘tkir", approveEmployeeId: "approver-test", rows: Array.from({ length: rowCount }, (_, index) => ({ id: `calibration-${index}`, sourceEquipmentId: null, equipmentName: "O‘lchov Scale", equipmentNumber: `SN-${index}`, location: "Custom room", purpose: "Моя цель", measurementRange: "20...500 кг", calibrationInterval: 12, lastCalibrationDate: "2025-02-03", note: "Custom note" })) });
      const before = JSON.stringify(config);
      const rendered = renderJournalDocumentPdf({
        ...sample, locale,
        document: { ...sample.document, title: rowCount === 1 ? EQUIPMENT_CALIBRATION_DOCUMENT_TITLE : "Customer schedule O‘tkir", config: config as unknown as typeof sample.document.config, dateFrom: new Date("2026-01-01T00:00:00Z"), dateTo: new Date("2026-12-31T00:00:00Z") },
        users: [{ id: "approver-test", name: "O‘tkir", role: "manager", email: "", positionTitle: "" }],
      });
      const task = pdfjs.getDocument({ data: new Uint8Array(rendered.buffer), disableWorker: true, isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: standardFontsDir() } as Parameters<typeof pdfjs.getDocument>[0]);
      try {
        const pdf = await task.promise;
        if (rowCount === 1) assert.equal(pdf.numPages, 1, locale);
        else assert.ok(pdf.numPages > 1, locale + " multipage fixture");
        const parts: string[] = [];
        for (let index = 1; index <= pdf.numPages; index++) {
          const page = await pdf.getPage(index);
          const content = await page.getTextContent();
          const viewport = page.getViewport({ scale: 1 });
          for (const item of content.items) if ("str" in item && item.str.trim()) {
            parts.push(item.str);
            assert.ok(item.transform[4] >= -1 && item.transform[4] + item.width <= viewport.width + 1, locale + " text within page width: " + item.str);
          }
        }
        const text = parts.join(" ").replace(/\s+/g, " ");
        const messages = (await loadMessages(locale)).equipmentCalibration;
        const t = createTranslator({ locale, messages, onError: error => { throw error; } });
        for (const expected of [messages.pageTitle.toUpperCase(), messages.characteristics, messages.approve, messages.roles.manager, "O‘lchov Scale", "O‘tkir", "Моя цель", "20...500 кг", "Custom note", t("months", { count: 12 }), calibrationDate(calculateNextCalibrationDate("2025-02-03", 12), locale)]) assert.ok(text.includes(expected), locale + " expected " + expected);
        if (rowCount > 1) assert.ok(text.includes("Customer schedule O‘tkir"));
        if (locale !== "ru") assert.doesNotMatch(text, /Метрологические характеристики|ГРАФИК ПОВЕРКИ|УТВЕРЖДАЮ|Управляющий|мес\./);
        assert.equal(JSON.stringify(config), before);
      } finally { await task.destroy(); }
    }
  }
});
