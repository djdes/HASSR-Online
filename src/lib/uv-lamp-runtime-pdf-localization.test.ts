import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { normalizeUvRuntimeDocumentConfig, UV_LAMP_RUNTIME_TEMPLATE_CODE } from "@/lib/uv-lamp-runtime-document";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";
import { loadMessages } from "@/i18n/messages";

test("UV runtime PDF localizes print labels and keeps entered names and data", async () => {
  const rawDir = join(process.cwd(), ".agent/tasks/english-version-1375e736/raw");
  mkdirSync(rawDir, { recursive: true });
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();

  const scenarios = (["ru", "en", "uz"] as const).flatMap(locale =>
    [true, false].map(explicit => ({ locale, explicit }))
  );
  for (const { locale, explicit } of scenarios) {
    const sample = buildJournalSampleInput(UV_LAMP_RUNTIME_TEMPLATE_CODE);
    const config = normalizeUvRuntimeDocumentConfig({
      lampNumber: "4",
      areaName: "Kitchen A",
      spec: {
        disinfectionAir: true,
        disinfectionSurface: false,
        microorganismType: "Test indicator",
        radiationMode: "continuous",
        disinfectionCondition: "with_people",
        lampLifetimeHours: 9000,
        commissioningDate: "2026-04-01",
        minIntervalBetweenSessions: "",
        controlFrequency: "1 раз(а) в смену",
        autoFillStartTime: "09:00",
        autoFillDurationMinutes: 30,
      },
    });
    const sourceConfig = { ...config, spec: { ...config.spec } };
    if (!explicit) {
      Reflect.deleteProperty(sourceConfig.spec, "microorganismType");
      Reflect.deleteProperty(sourceConfig.spec, "controlFrequency");
    }
    const rendered = renderJournalDocumentPdf({
      ...sample,
      document: {
        ...sample.document,
        title: "",
        template: { ...sample.document.template, code: UV_LAMP_RUNTIME_TEMPLATE_CODE },
        config: sourceConfig as unknown as typeof sample.document.config,
        entries: [{
          id: "uv-test-entry",
          documentId: sample.document.id,
          employeeId: sample.users[0].id,
          date: new Date("2026-04-02T00:00:00.000Z"),
          data: { startTime: "09:00", endTime: "09:30" } as never,
          verificationStatus: null,
          verificationRejectReason: null,
          verificationDecidedById: null,
          verificationDecidedAt: null,
          createdAt: new Date("2026-04-02T09:00:00.000Z"),
          updatedAt: new Date("2026-04-02T09:00:00.000Z"),
        }],
      } as typeof sample.document,
      users: sample.users.map((user, index) => index === 0 ? { ...user, name: "O‘tkir" } : user),
      locale,
    });
    writeFileSync(join(rawDir, `uv-lamp-runtime-${locale}-${explicit ? "explicit" : "absent"}.pdf`), rendered.buffer);
    const task = pdfjs.getDocument({
      data: new Uint8Array(rendered.buffer),
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: false,
      standardFontDataUrl: standardFontsDir(),
    } as Parameters<typeof pdfjs.getDocument>[0]);
    try {
      const pdf = await task.promise;
      assert.ok(pdf.numPages >= 1, `${locale} PDF should have at least one page`);
      const text = (await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
        const page = await pdf.getPage(index + 1);
        const content = await page.getTextContent();
        return content.items.flatMap((item) => "str" in item ? [item.str] : []).join(" ");
      }))).join(" ");
      const copy = (await loadMessages(locale)).trackedUvPdf;
      assert.ok(text.includes(copy.uv_title), `${locale} title`);
      assert.ok(text.includes("Kitchen A"), `${locale} entered area`);
      assert.ok(text.includes(explicit ? "Test indicator" : copy.defaultMicroorganism), `${locale} configured microorganism preserved or absent default localized`);
      assert.ok(text.includes(explicit ? "1 раз в смену" : copy.defaultFrequency), `${locale} explicit frequency preserved or absent default localized`);
      assert.ok(text.includes("O‘tkir"), `${locale} responsible name`);
      assert.ok(text.includes(copy.uv_on), `${locale} table header`);
      if (locale !== "ru") {
        for (const russianLabel of ["СИСТЕМА ХАССП", "Начат", "Окончен"]) {
          assert.ok(!text.includes(russianLabel), `${locale} PDF must not contain ${russianLabel}`);
        }
        assert.ok(!text.includes("Периодичность контроля"), `${locale} PDF must not contain the Russian periodicity label`);
        assert.ok(text.includes(locale === "en" ? "PAGE" : "SAHIFADAN"), `${locale} page label`);
      }
      console.log(`${locale}: pages=${pdf.numPages}`);
    } finally {
      await task.destroy();
    }
  }
});
