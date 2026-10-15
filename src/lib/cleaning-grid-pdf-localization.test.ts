import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { buildDocumentAutoTitle } from "@/lib/journal-document-title";
import {
  CLEANING_DOCUMENT_TEMPLATE_CODE,
  defaultCleaningDocumentConfig,
  getCleaningDocumentTitle,
} from "@/lib/cleaning-document";
import {
  createEmptySanitationRow,
  getSanitationDayDefaultConfig,
  SANITATION_DAY_DOCUMENT_TITLE,
  SANITATION_DAY_TEMPLATE_CODE,
} from "@/lib/sanitation-day-document";
import { loadMessages } from "@/i18n/messages";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";

test("cleaning and deep-cleaning PDFs localize generated labels and preserve custom titles and room data", async () => {
  const rawDir = join(process.cwd(), ".agent/tasks/english-version-1375e736/raw");
  mkdirSync(rawDir, { recursive: true });
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();

  const dateFrom = new Date("2026-10-01T00:00:00.000Z");
  const dateTo = new Date("2026-10-15T00:00:00.000Z");
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const cleaningSample = buildJournalSampleInput(CLEANING_DOCUMENT_TEMPLATE_CODE);
    const cleaningConfig = defaultCleaningDocumentConfig();
    const cleaningDefaultTitle = buildDocumentAutoTitle({
      templateCode: CLEANING_DOCUMENT_TEMPLATE_CODE,
      journalName: getCleaningDocumentTitle(),
      dateFrom: "2026-10-01",
      dateTo: "2026-10-15",
    });
    const cleaningDefault = renderJournalDocumentPdf({
      ...cleaningSample,
      document: {
        ...cleaningSample.document,
        title: cleaningDefaultTitle,
        dateFrom,
        dateTo,
        template: { ...cleaningSample.document.template, code: CLEANING_DOCUMENT_TEMPLATE_CODE },
        config: cleaningConfig as unknown as typeof cleaningSample.document.config,
      },
      locale,
    });
    writeFileSync(join(rawDir, `cleaning-grid-cleaning-${locale}.pdf`), cleaningDefault.buffer);

    const sanitationSample = buildJournalSampleInput(SANITATION_DAY_TEMPLATE_CODE);
    const sanitationConfig = {
      ...getSanitationDayDefaultConfig(new Date("2026-01-01T00:00:00.000Z")),
      year: 2026,
      rows: [createEmptySanitationRow("Kitchen A", "stable-room", null, "2026-01-05")],
    };
    const sanitationDefaultTitle = buildDocumentAutoTitle({
      templateCode: SANITATION_DAY_TEMPLATE_CODE,
      journalName: SANITATION_DAY_DOCUMENT_TITLE,
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
      year: 2026,
    });
    const sanitationDefault = renderJournalDocumentPdf({
      ...sanitationSample,
      document: {
        ...sanitationSample.document,
        title: sanitationDefaultTitle,
        dateFrom: new Date("2026-01-01T00:00:00.000Z"),
        dateTo: new Date("2026-12-31T00:00:00.000Z"),
        template: { ...sanitationSample.document.template, code: SANITATION_DAY_TEMPLATE_CODE },
        config: sanitationConfig as unknown as typeof sanitationSample.document.config,
      },
      locale,
    });
    writeFileSync(join(rawDir, `cleaning-grid-general-${locale}.pdf`), sanitationDefault.buffer);

    const cleaningCustomSample = buildJournalSampleInput(CLEANING_DOCUMENT_TEMPLATE_CODE);
    const cleaningCustom = renderJournalDocumentPdf({
      ...cleaningCustomSample,
      document: {
        ...cleaningCustomSample.document,
        title: "O‘tkir custom cleaning journal",
        dateFrom,
        dateTo,
        template: { ...cleaningCustomSample.document.template, code: CLEANING_DOCUMENT_TEMPLATE_CODE },
        config: cleaningConfig as unknown as typeof cleaningCustomSample.document.config,
      },
      locale,
    });
    writeFileSync(join(rawDir, `cleaning-grid-cleaning-custom-${locale}.pdf`), cleaningCustom.buffer);

    for (const [kind, rendered] of [["cleaning", cleaningDefault], ["general", sanitationDefault]] as const) {
      const task = pdfjs.getDocument({
        data: new Uint8Array(rendered.buffer),
        disableWorker: true,
        isEvalSupported: false,
        useSystemFonts: false,
        standardFontDataUrl: standardFontsDir(),
      } as Parameters<typeof pdfjs.getDocument>[0]);
      try {
        const pdf = await task.promise;
        assert.ok(pdf.numPages >= 1, `${locale} ${kind} PDF should render at least one page`);
        const text = (await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
          const page = await pdf.getPage(index + 1);
          const content = await page.getTextContent();
          return content.items.flatMap((item) => "str" in item ? [item.str] : []).join(" ");
        }))).join(" ");
        if (kind === "general") {
          assert.ok(text.includes(messages.cleaningGrid.cleaning.pdfTitle), `${locale} default deep-cleaning title`);
          assert.ok(text.includes(messages.cleaningGrid.cleaning.pdfRoomHeader), `${locale} room header`);
          assert.ok(text.includes("Kitchen A"), `${locale} custom room name remains unchanged`);
        } else {
          const expectedTitleName = messages.cleaningGrid.cleaning.pdfCleaningTitle.toUpperCase();
          assert.ok(text.toUpperCase().includes(expectedTitleName), `${locale} generated cleaning title name`);
          assert.ok(text.toUpperCase().includes(locale === "en" ? "OCTOBER 2026" : locale === "uz" ? "OKTABR, 2026" : "ОКТЯБРЯ 2026"), `${locale} generated title period uses the selected locale`);
        }
        if (locale !== "ru") {
          for (const russianHeader of ["СИСТЕМА ХАССП", "Начат", "Окончен", "Периодичность контроля"]) {
            assert.ok(!text.includes(russianHeader), `${locale} ${kind} PDF must not contain ${russianHeader}`);
          }
        }
      } finally {
        await task.destroy();
      }
    }

    const cleaningCustomTask = pdfjs.getDocument({
      data: new Uint8Array(cleaningCustom.buffer),
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: false,
      standardFontDataUrl: standardFontsDir(),
    } as Parameters<typeof pdfjs.getDocument>[0]);
    try {
      const pdf = await cleaningCustomTask.promise;
      const page = await pdf.getPage(1);
      const content = await page.getTextContent();
      const text = content.items.flatMap((item) => "str" in item ? [item.str] : []).join(" ");
      assert.ok(text.includes("O‘tkir custom cleaning journal".toUpperCase()), `${locale} custom cleaning title is preserved`);
    } finally {
      await cleaningCustomTask.destroy();
    }

    const customSample = buildJournalSampleInput(SANITATION_DAY_TEMPLATE_CODE);
    const custom = renderJournalDocumentPdf({
      ...customSample,
      document: {
        ...customSample.document,
        title: "O‘tkir custom journal title",
        dateFrom: new Date("2026-01-01T00:00:00.000Z"),
        dateTo: new Date("2026-12-31T00:00:00.000Z"),
        template: { ...customSample.document.template, code: SANITATION_DAY_TEMPLATE_CODE },
        config: sanitationConfig as unknown as typeof customSample.document.config,
      },
      locale,
    });
    writeFileSync(join(rawDir, `cleaning-grid-custom-${locale}.pdf`), custom.buffer);
    const customTask = pdfjs.getDocument({
      data: new Uint8Array(custom.buffer),
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: false,
      standardFontDataUrl: standardFontsDir(),
    } as Parameters<typeof pdfjs.getDocument>[0]);
    try {
      const pdf = await customTask.promise;
      const page = await pdf.getPage(1);
      const content = await page.getTextContent();
      const text = content.items.flatMap((item) => "str" in item ? [item.str] : []).join(" ");
      assert.ok(text.includes("O‘tkir custom journal title"), `${locale} custom title is preserved`);
    } finally {
      await customTask.destroy();
    }
  }
});
