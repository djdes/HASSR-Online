import assert from "node:assert/strict";
import test from "node:test";
import { knowledgeFileType, officeZipWithinLimits, knowledgeInline } from "./knowledge-documents";

test("knowledge file validation checks signature and extension together", () => {
  assert.equal(knowledgeFileType("scan.pdf", new TextEncoder().encode("%PDF-1.7")), "application/pdf");
  assert.equal(knowledgeFileType("scan.png", new Uint8Array([137,80,78,71,13,10,26,10])), "image/png");
  assert.equal(knowledgeFileType("scan.JPG", new Uint8Array([255,216,255])), "image/jpeg");
  assert.equal(knowledgeFileType("archive.7z", new Uint8Array([0x37,0x7a,0xbc,0xaf,0x27,0x1c])), "application/x-7z-compressed");
  assert.equal(knowledgeFileType("archive.rar", new Uint8Array([0x52,0x61,0x72,0x21,0x1a,0x07])), "application/vnd.rar");
  assert.equal(knowledgeFileType("document.docx", new Uint8Array([80,75,3,4])), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  for (const name of ["scan.pdf", "script.html", "scan.svg", "code.exe"]) assert.equal(knowledgeFileType(name, new TextEncoder().encode("<script>alert(1)</script>")), null);
  assert.equal(knowledgeFileType("fake.zip", new Uint8Array([255,216,255])), null);
});
test("only scanned formats are served inline", () => {
  assert.equal(knowledgeInline("application/pdf"), true);
  assert.equal(knowledgeInline("application/zip"), false);
  assert.equal(knowledgeInline("text/html"), false);
});
test("office preview rejects oversized decompression before opening ZIP", () => {
  const bytes = new Uint8Array(46); const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x02014b50, true); view.setUint32(24, 1000, true);
  assert.equal(officeZipWithinLimits(bytes), true);
  view.setUint32(24, 25 * 1024 * 1024, true);
  assert.equal(officeZipWithinLimits(bytes), false);
  assert.equal(officeZipWithinLimits(new Uint8Array()), false);
});
