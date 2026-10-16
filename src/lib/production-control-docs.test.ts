import test from "node:test";
import assert from "node:assert/strict";

import {
  PRODUCTION_DOC_KINDS,
  isProductionDocKind,
  productionDocFileType,
  productionDocServiceKey,
} from "./production-control-docs";

const PDF = new TextEncoder().encode("%PDF-1.7\n");
const ZIP = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);

test("два вида документов: программа и ХАССП-план", () => {
  assert.deepEqual([...PRODUCTION_DOC_KINDS], ["ppk", "haccp_plan"]);
  assert.ok(isProductionDocKind("ppk"));
  assert.ok(!isProductionDocKind("other"));
  assert.ok(!isProductionDocKind(null));
});

test("кнопка «Заказать разработку» ведёт к своей услуге", () => {
  assert.equal(productionDocServiceKey("ppk"), "ppk-development");
  assert.equal(productionDocServiceKey("haccp_plan"), "haccp-package");
});

test("принимаем документ (PDF, Word, скан), но не архив", () => {
  assert.equal(productionDocFileType("ППК.pdf", PDF), "application/pdf");
  assert.equal(productionDocFileType("ппк.docx", ZIP), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(productionDocFileType("ппк.zip", ZIP), null);
  assert.equal(productionDocFileType("ппк.pdf", ZIP), null);
});
