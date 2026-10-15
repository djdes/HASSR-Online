import assert from "node:assert/strict";
import test from "node:test";

import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { getDefaultGlassListConfig, GLASS_LIST_DOCUMENT_TITLE, GLASS_LIST_TEMPLATE_CODE } from "@/lib/glass-list-document";
import { loadMessages } from "@/i18n/messages";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";
import { buildDocumentAutoTitle } from "@/lib/journal-document-title";
import { GLASS_LIST_PAGE_TITLE } from "@/lib/glass-list-document";

test("glass list PDF uses localized headings while preserving row and responsible names", async () => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();

  for (const locale of ["ru", "en", "uz"] as const) {
    const sample = buildJournalSampleInput(GLASS_LIST_TEMPLATE_CODE);
    const config = {
      ...getDefaultGlassListConfig(new Date("2026-10-01T00:00:00Z")),
      documentDate: "2026-10-01",
      responsibleTitle: "Управляющий",
      rows: [{ id: "stable-row", location: "Участок A", itemName: "Glass item", quantity: "2" }],
    };
    const input = {
      ...sample,
      document: {
        ...sample.document,
        title: buildDocumentAutoTitle({ templateCode: GLASS_LIST_TEMPLATE_CODE, journalName: GLASS_LIST_PAGE_TITLE, dateFrom: "2026-10-01", dateTo: "2026-10-31" }),
        dateFrom: new Date("2026-10-01T00:00:00Z"),
        dateTo: new Date("2026-10-31T00:00:00Z"),
        template: { ...sample.document.template, code: GLASS_LIST_TEMPLATE_CODE },
        config: config as unknown as typeof sample.document.config,
      },
      users: sample.users.map((user, index) => index === 0 ? { ...user, name: "O‘tkir" } : user),
      locale,
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
      assert.equal(pdf.numPages, 1, `${locale} PDF page count`);
      const page = await pdf.getPage(1);
      const content = await page.getTextContent();
      const text = content.items.flatMap((item) => "str" in item ? [item.str] : []).join(" ");
      const messages = await loadMessages(locale);
      assert.ok(text.includes(messages.glassInventory.documentHeading), `${locale} heading`);
      assert.ok(text.includes(messages.journals.names.glass_items_list), `${locale} generated default title is localized`);
      assert.ok(text.includes(messages.glassInventory.tableLocationHeader), `${locale} location heading`);
      assert.ok(text.includes("O‘tkir"), `${locale} responsible name`);
      assert.ok(text.includes("Glass item"), `${locale} row data`);
      assert.ok(text.includes(messages.glassInventory.defaultResponsibleTitle), `${locale} default title display`);
      assert.ok(text.includes(messages.journalWidgets.periodicity.glass_items_list), `${locale} default periodicity`);
      if (locale !== "ru") {
        for (const russianLabel of ["СИСТЕМА ХАССП", "Начат", "Окончен", GLASS_LIST_DOCUMENT_TITLE, "Периодичность контроля", "не реже раза в год"]) {
          assert.ok(!text.includes(russianLabel), `${locale} header must not contain ${russianLabel}`);
        }
        assert.ok(text.includes(locale === "en" ? "PAGE" : "SAHIFADAN"), `${locale} localized page label`);
      }
    } finally {
      await task.destroy();
    }
  }
});
