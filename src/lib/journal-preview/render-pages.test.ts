import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { jsPDF } from "jspdf";
import { countPdfPages, renderPdfPageToPng } from "./render-pages";

function threePagePdf(): Uint8Array {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.text("Page one", 20, 20);
  doc.addPage();
  doc.text("Page two", 20, 20);
  doc.addPage();
  doc.rect(15, 30, 200, 40);
  return new Uint8Array(doc.output("arraybuffer"));
}

describe("renderPdfPageToPng", () => {
  it("counts every page of the PDF", async () => {
    assert.equal(await countPdfPages(threePagePdf()), 3);
  });

  it("renders any page as a full-sheet PNG of the requested width", async () => {
    const pdf = threePagePdf();
    const page = await renderPdfPageToPng(pdf, 3, { width: 800 });
    assert.equal(page.png.subarray(1, 4).toString("latin1"), "PNG");
    assert.equal(page.contentType, "image/png");
    assert.equal(page.width, 800);
    // A4 альбом: 297×210 → высота ≈ 800 × 210 / 297.
    assert.ok(Math.abs(page.height - Math.round((800 * 210) / 297)) <= 1, `height ${page.height}`);
    // Исходный буфер не отдаётся pdfjs насовсем — можно рендерить повторно.
    const again = await renderPdfPageToPng(pdf, 1, { width: 400 });
    assert.equal(again.width, 400);
  });

  it("rejects a page outside the document", async () => {
    await assert.rejects(() => renderPdfPageToPng(threePagePdf(), 4));
  });
});
