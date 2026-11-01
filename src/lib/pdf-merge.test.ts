import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";

import { TOC_ROWS_PER_PAGE, mergePdfParts, tocEntries } from "@/lib/pdf-merge";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

async function pdfWithPages(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < count; index += 1) doc.addPage([595, 842]);
  return doc.save();
}

describe("«Пришла проверка» одним PDF", () => {
  it("номера страниц в содержании учитывают обложку и само содержание", () => {
    assert.deepEqual(tocEntries(1, 1, [{ title: "A", pages: 3 }, { title: "B", pages: 2 }]), [
      { title: "A", startPage: 3, pages: 3 },
      { title: "B", startPage: 6, pages: 2 },
    ]);
    assert.equal(TOC_ROWS_PER_PAGE, 32);
  });

  it("склейка: обложка, содержание, части по порядку; битая часть пропускается с пометкой", async () => {
    const merged = await mergePdfParts({
      cover: { title: "Сводка", bytes: await pdfWithPages(1) },
      parts: [
        { title: "Гигиенический журнал · ноябрь", bytes: await pdfWithPages(3) },
        { title: "Битый файл", bytes: new Uint8Array([1, 2, 3]) },
        { title: "CAPA", bytes: await pdfWithPages(2) },
      ],
      tocTitle: "Содержание",
      notes: ["Только в архиве ZIP: файлов — 2."],
    });
    assert.deepEqual(merged.skipped, ["Битый файл"]);
    assert.deepEqual(merged.entries, [
      { title: "Гигиенический журнал · ноябрь", startPage: 3, pages: 3 },
      { title: "CAPA", startPage: 6, pages: 2 },
    ]);
    // 1 обложка + 1 содержание + 3 + 2.
    assert.equal(merged.totalPages, 7);
    const reloaded = await PDFDocument.load(merged.bytes);
    assert.equal(reloaded.getPageCount(), 7);
  });

  it("длинное содержание — на нескольких страницах, номера сдвигаются", async () => {
    const parts = await Promise.all(
      Array.from({ length: TOC_ROWS_PER_PAGE + 5 }, async (_, index) => ({ title: `Журнал ${index + 1}`, bytes: await pdfWithPages(1) })),
    );
    const merged = await mergePdfParts({ cover: null, parts, tocTitle: "Содержание" });
    assert.equal(merged.entries[0].startPage, 3);
    assert.equal(merged.totalPages, 2 + parts.length);
  });

  it("маршрут и кнопка: format=pdf отдаёт PDF того же состава, в журнал действий — формат", () => {
    const route = read("src/app/api/reports/compliance-bundle/route.ts");
    assert.match(route, /const format = url\.searchParams\.get\("format"\) === "pdf" \? "pdf" : "zip";/);
    assert.match(route, /"Content-Type": "application\/pdf"/);
    assert.match(route, /format: "pdf", pages: merged\.totalPages/);
    assert.match(route, /Только в архиве ZIP/);
    const card = read("src/components/reports/compliance-bundle-card.tsx");
    assert.match(card, /onClick=\{\(\) => void download\("pdf"\)\}/);
    assert.match(card, /&format=pdf/);
  });
});
