import assert from "node:assert/strict";
import test from "node:test";

import { loadMessages } from "@/i18n/messages";
import { formatNumber, type Locale } from "@/i18n/locales";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import {
  COLD_EQUIPMENT_REGULATION,
  normalizeColdEquipmentDocumentConfig,
  COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE,
} from "@/lib/cold-equipment-document";
import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";

test("cold-equipment PDF localizes labels, dates and numbers without changing data or regulation", async () => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();

  assert.equal(COLD_EQUIPMENT_REGULATION, "2.3/2.4.4282-26");
  for (const locale of ["ru", "en", "uz"] as const satisfies readonly Locale[]) {
    const sample = buildJournalSampleInput(COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE);
    const config = normalizeColdEquipmentDocumentConfig({
      skipWeekends: false,
      equipment: [
        { id: "unit-a", sourceEquipmentId: null, name: "Unit A", min: 2, max: 6, readingMode: "once" },
        { id: "unit-b", sourceEquipmentId: null, name: "Unit B", min: -24, max: -18, readingMode: "once" },
      ],
    });
    const input = {
      ...sample,
      locale,
      document: {
        ...sample.document,
        title: "",
        dateFrom: new Date("2026-10-01T00:00:00.000Z"),
        dateTo: new Date("2026-10-03T00:00:00.000Z"),
        template: { ...sample.document.template, code: COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE },
        config: config as unknown as typeof sample.document.config,
        entries: [{
          id: "cold-test-entry",
          documentId: sample.document.id,
          employeeId: sample.users[0]!.id,
          date: new Date("2026-10-02T00:00:00.000Z"),
          data: {
            responsibleTitle: null,
            temperatures: { "unit-a": 3.5 },
            statuses: { "unit-b": "repair" },
          } as never,
          verificationStatus: null,
          verificationRejectReason: null,
          verificationDecidedById: null,
          verificationDecidedAt: null,
          createdAt: new Date("2026-10-02T09:00:00.000Z"),
          updatedAt: new Date("2026-10-02T09:00:00.000Z"),
        }],
      } as typeof sample.document,
      users: sample.users.map((user, index) => index === 0 ? { ...user, name: "O‘tkir" } : user),
    };

    const rendered = renderJournalDocumentPdf(input);
    const task = pdfjs.getDocument({
      data: new Uint8Array(rendered.buffer),
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: false,
      standardFontDataUrl: standardFontsDir(),
    } as Parameters<typeof pdfjs.getDocument>[0]);
    try {
      const pdf = await task.promise;
      assert.equal(pdf.numPages, 1, locale + " page count");
      const page = await pdf.getPage(1);
      const content = await page.getTextContent();
      const text = content.items.flatMap((item) => "str" in item ? [item.str] : []).join(" ");
      const messages = await loadMessages(locale);
      const cold = messages.coldEquipment;
      assert.doesNotMatch(text, /coldEquipment\.|MISSING_MESSAGE|INVALID_MESSAGE/, locale + " no unresolved messages");
      assert.ok(text.includes(cold.print.temperature), locale + " temperature heading");
      assert.ok(text.includes(messages.journals.names.cold_equipment_control.toUpperCase()), locale + " journal title");
      assert.ok(text.includes(cold.print.equipmentName), locale + " equipment heading");
      assert.ok(text.includes(cold.print.responsible), locale + " responsible heading");
      assert.ok(text.includes(cold.print.legalBasis.replace("{regulation}", COLD_EQUIPMENT_REGULATION)), locale + " regulation");
      assert.ok(text.includes("Unit A") && text.includes("Unit B"), locale + " equipment names");
      assert.ok(text.includes("O‘tkir"), locale + " employee name");
      assert.ok(text.includes(formatNumber(locale, 3.5)), locale + " localized temperature");
      assert.ok(text.includes(cold.print.statusRepair), locale + " localized stored status");
      const month = new Intl.DateTimeFormat(
        locale === "ru" ? "ru-RU" : locale === "en" ? "en-GB" : "uz-Latn-UZ",
        { month: "long", year: "numeric", timeZone: "UTC" },
      ).format(new Date("2026-10-01T12:00:00.000Z"));
      assert.ok(text.includes(month), locale + " month and date formatting");
      if (locale !== "ru") {
        for (const russianLabel of [
          "СИСТЕМА ХАССП",
          "Начат",
          "Окончен",
          "Периодичность контроля",
          "Температура °C",
          "Наименование или номер ХК",
          "Ответственный за снятие показателей",
        ]) {
          assert.ok(!text.includes(russianLabel), locale + " PDF must not contain " + russianLabel);
        }
        assert.ok(text.includes(locale === "en" ? "PAGE" : "SAHIFADAN"), locale + " page label");
      }
    } finally {
      await task.destroy();
    }
  }
});
