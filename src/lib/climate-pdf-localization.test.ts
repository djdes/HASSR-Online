import assert from "node:assert/strict";
import test from "node:test";

import { loadMessages } from "@/i18n/messages";
import { formatNumber, type Locale } from "@/i18n/locales";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import {
  CLIMATE_DOCUMENT_TEMPLATE_CODE,
  CLIMATE_DOCUMENT_TITLE,
  normalizeClimateDocumentConfig,
} from "@/lib/climate-document";
import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";

test("climate PDF localizes labels, date and measurements while preserving room and staff data", async () => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();

  for (const locale of ["ru", "en", "uz"] as const satisfies readonly Locale[]) {
    const sample = buildJournalSampleInput(CLIMATE_DOCUMENT_TEMPLATE_CODE);
    const config = normalizeClimateDocumentConfig({
      skipWeekends: false,
      controlTimes: ["09:30", "17:00"],
      rooms: [{
        id: "climate-test-room",
        name: "Cold store A",
        temperature: { enabled: true, min: 2, max: 6 },
        humidity: { enabled: true, min: 40, max: 60 },
      }],
    });
    const input = {
      ...sample,
      locale,
      document: {
        ...sample.document,
        title: CLIMATE_DOCUMENT_TITLE,
        dateFrom: new Date("2026-10-01T00:00:00.000Z"),
        dateTo: new Date("2026-10-03T00:00:00.000Z"),
        template: { ...sample.document.template, code: CLIMATE_DOCUMENT_TEMPLATE_CODE },
        config: config as unknown as typeof sample.document.config,
        entries: [{
          id: "climate-test-entry",
          documentId: sample.document.id,
          employeeId: sample.users[0]!.id,
          date: new Date("2026-10-02T00:00:00.000Z"),
          data: {
            responsibleTitle: null,
            measurements: {
              "climate-test-room": {
                "09:30": { temperature: 3.5, humidity: 51.5 },
                "17:00": { temperature: 4, humidity: 50 },
              },
            },
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
      assert.ok(text.includes(messages.journals.names.climate_control.toUpperCase()), locale + " localized default title");
      assert.ok(text.includes(messages.climate.print.norms), locale + " norms label");
      assert.ok(text.includes(messages.climate.print.controlPoints), locale + " control points label");
      assert.ok(text.includes(messages.climate.print.responsibleSurname), locale + " responsible label");
      assert.ok(text.includes("Cold store A"), locale + " room name is preserved");
      assert.ok(text.includes("O‘tkir"), locale + " employee name is preserved");
      assert.ok(text.includes(formatNumber(locale, 3.5)), locale + " localized temperature");
      assert.ok(text.includes(formatNumber(locale, 51.5)), locale + " localized humidity");
      if (locale !== "ru") {
        for (const russianLabel of ["Нормы условий", "Точки контроля", "Фамилия ответственного лица", "Частота контроля"]) {
          assert.ok(!text.includes(russianLabel), locale + " PDF must not contain " + russianLabel);
        }
      }
    } finally {
      await task.destroy();
    }
  }
});
