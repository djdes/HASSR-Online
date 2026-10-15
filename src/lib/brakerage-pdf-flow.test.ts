import assert from "node:assert/strict";
import test from "node:test";
import { buildJournalSampleInput } from "@/lib/journal-sample-fixtures";
import { renderJournalDocumentPdf } from "@/lib/document-pdf";
import { normalizeFinishedProductDocumentConfig } from "@/lib/finished-product-document";
import { standardFontsDir, workerFileUrl } from "@/lib/journal-preview/render";

test("printed brakerage keeps completed dishes, DD-MM-YYYY, time-only rejection and explicit responsible fallback", async () => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerFileUrl();
  const sample = buildJournalSampleInput("finished_product");
  const owner = sample.users[0];
  assert.ok(owner);
  for (const declined of [false, true]) {
    const config = normalizeFinishedProductDocumentConfig({ rows: [{ id: "dish", productName: "Блюдо сохранено", productionDateTime: "2026-10-15 12:25", rejectionTime: "2026-10-15 12:30", organoleptic: "Отлично" }], commissionMembers: [], columns: { hidden: ["responsible", "inspector"] } });
    const before = JSON.stringify(config);
    const input = { ...sample, locale: "ru" as const, brakerageCommissionDeclined: declined, document: { ...sample.document, responsibleUserId: owner.id, config: config as unknown as typeof sample.document.config } };
    const rendered = renderJournalDocumentPdf(input);
    const task = pdfjs.getDocument({ data: new Uint8Array(rendered.buffer), disableWorker: true, isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: standardFontsDir() } as Parameters<typeof pdfjs.getDocument>[0]);
    try {
      const pdf = await task.promise, parts: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const content = await (await pdf.getPage(i)).getTextContent();
        for (const item of content.items) if ("str" in item) parts.push(item.str);
      }
      const text = parts.join(" ").replace(/\s+/g, " ");
      assert.match(text, /Блюдо сохранено/);
      assert.match(text, /15-10-2026 12:25/);
      assert.match(text, /12:30/);
      assert.doesNotMatch(text, /2026-10-15 12:30|15-10-2026 12:30/);
      assert.equal(text.includes(owner.name), declined);
      assert.equal(JSON.stringify(config), before);
    } finally { await task.destroy(); }
  }
});
