import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { FRYER_OIL_TEMPLATE_CODE, getFryerOilDocumentTitle, normalizeFryerOilDocumentConfig } from "@/lib/fryer-oil-document";
import { loadMessages } from "@/i18n/messages";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";

test("fryer oil PDF localizes captions while preserving stored defaults and user values", async () => {
  const rawDir = join(process.cwd(), ".agent/tasks/english-version-1375e736/raw");
  mkdirSync(rawDir, { recursive: true });
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();

  const expectedTitles = {
    ru: getFryerOilDocumentTitle(),
    en: "Fryer oil usage log",
    uz: "Qovurish yog‘idan foydalanish jurnali",
  } as const;
  for (const locale of ["ru", "en", "uz"] as const) {
    const sample = buildJournalSampleInput(FRYER_OIL_TEMPLATE_CODE);
    const config = normalizeFryerOilDocumentConfig({
      lists: {
        fatTypes: ["Подсолнечное масло"],
        equipmentTypes: ["Фритюрница №1"],
        productTypes: ["Картофель фри"],
      },
      shift: { startTime: "07:00", endTime: "16:00" },
    });
    const rendered = renderJournalDocumentPdf({
      ...sample,
      document: {
        ...sample.document,
        title: getFryerOilDocumentTitle(),
        dateFrom: new Date("2026-04-01T00:00:00.000Z"),
        dateTo: new Date("2026-04-30T00:00:00.000Z"),
        template: { ...sample.document.template, code: FRYER_OIL_TEMPLATE_CODE },
        config: config as unknown as typeof sample.document.config,
        entries: [{
          id: "fryer-test-entry",
          documentId: sample.document.id,
          employeeId: sample.users[0].id,
          date: new Date("2026-04-02T00:00:00.000Z"),
          data: {
            startDate: "2026-04-02", startHour: 9, startMinute: 15,
            endHour: 15, endMinute: 30, fatType: "Подсолнечное масло",
            equipmentType: "Фритюрница №1", productType: "Картофель фри",
            qualityStart: 5, qualityStartNote: "Доброкачественное, без постороннего запаха",
            qualityEnd: 4, qualityEndNote: "Цвет светлый, свойственный данному виду",
            carryoverKg: 1.25, disposedKg: 0.5, controllerName: "O‘tkir",
          },
          verificationStatus: null,
          verificationRejectReason: null,
          verificationDecidedById: null,
          verificationDecidedAt: null,
          createdAt: new Date("2026-04-02T15:30:00.000Z"),
          updatedAt: new Date("2026-04-02T15:30:00.000Z"),
        }],
      } as typeof sample.document,
      users: sample.users.map((user, index) => index === 0 ? { ...user, name: "O‘tkir" } : user),
      locale,
    });
    writeFileSync(join(rawDir, `fryer-oil-${locale}.pdf`), rendered.buffer);
    const task = pdfjs.getDocument({
      data: new Uint8Array(rendered.buffer), disableWorker: true,
      isEvalSupported: false, useSystemFonts: false,
      standardFontDataUrl: standardFontsDir(),
    } as Parameters<typeof pdfjs.getDocument>[0]);
    try {
      const pdf = await task.promise;
      const pages = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
        const page = await pdf.getPage(index + 1);
        const content = await page.getTextContent();
        return content.items.flatMap((item) => "str" in item ? [item.str] : []).join(" ");
      }));
      const text = pages.join(" ");
      const messages = await loadMessages(locale);
      assert.ok(text.includes(expectedTitles[locale]), `${locale} official title`);
      assert.ok(text.includes("O‘tkir"), `${locale} responsible name`);
      assert.ok(text.includes(locale === "ru" ? "Подсолнечное масло" : locale === "en" ? "Sunflower oil" : "Kungaboqar yog‘i"), `${locale} built-in oil label`);
      assert.ok(text.includes(locale === "ru" ? "Картофель фри" : locale === "en" ? "French fries" : "Kartoshka fri"), `${locale} built-in product label`);
      assert.ok(text.includes(locale === "ru" ? "Переходящий остаток, кг" : locale === "en" ? "Carried over, kg" : "Keyingi foydalanish uchun qoldiq, kg"), `${locale} table caption`);
      if (locale !== "ru") {
        for (const russianLabel of ["СИСТЕМА ХАССП", "Начат", "Окончен", "Приложение. Методика определения качества фритюрного жира."]) {
          assert.ok(!text.includes(russianLabel), `${locale} PDF must not contain ${russianLabel}`);
        }
        assert.ok(text.includes(locale === "en" ? "PAGE" : "SAHIFADAN"), `${locale} localized page label`);
      }
      assert.ok(text.includes(messages.fryerOil.pdfQualityStart), `${locale} quality heading`);
      assert.ok(text.includes(messages.fryerOil.scorePoor), `${locale} low-score range`);
      if (locale !== "ru") assert.ok(!text.includes("2 или 1"));
      writeFileSync(join(rawDir, `fryer-oil-${locale}.text.txt`), `pages=${pdf.numPages}\n${text}\n`);
      console.log(`${locale}: pages=${pdf.numPages}`);
    } finally {
      await task.destroy();
    }
  }
});
