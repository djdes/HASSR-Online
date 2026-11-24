import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REVISION_TEXT_BLOCKS,
  nextRevisionNumber,
  normalizeRevisionText,
  parseRevisionDocKey,
  revisionCode,
  revisionDocKey,
  revisionLabel,
  revisionStatus,
} from "./revisions";
import { PPK_STRUCTURE_ITEMS } from "./structure";
import { ppkItemHeadingRu, ppkItemTitleRu, ppkSectionHeadingRu } from "./structure-titles";
import { PPK_STRUCTURE } from "./structure";

test("код редакции: «ППК 001», «ППК 042», «ППК 1000»", () => {
  assert.equal(revisionCode(1), "ППК 001");
  assert.equal(revisionCode(42), "ППК 042");
  assert.equal(revisionCode(999), "ППК 999");
  assert.equal(revisionCode(1000), "ППК 1000");
});

test("следующий номер — максимум организации + 1, пустой реестр — 1", () => {
  assert.equal(nextRevisionNumber(null), 1);
  assert.equal(nextRevisionNumber(undefined), 1);
  assert.equal(nextRevisionNumber(7), 8);
});

test("пробелы и переносы — не слова; слово или знак — изменение", () => {
  const base = normalizeRevisionText("Мыть руки\nперед работой.");
  assert.equal(normalizeRevisionText("  Мыть   руки \n\n перед\tработой.  "), base);
  assert.notEqual(normalizeRevisionText("Мыть руки перед началом работы."), base);
  assert.notEqual(normalizeRevisionText("Мыть руки перед работой!"), base);
  assert.notEqual(normalizeRevisionText("мыть руки перед работой."), base, "регистр — тоже изменение");
});

test("статус: нет редакции, утверждена, изменён после утверждения", () => {
  assert.equal(revisionStatus(null, "a"), "none");
  assert.equal(revisionStatus("a", "a"), "approved");
  assert.equal(revisionStatus("a", "b"), "changed");
});

test("ключи документов: тексты и политика с точкой, база знаний без точки", () => {
  assert.equal(revisionDocKey({ kind: "text", block: "text-terms" }, null), "text:text-terms");
  assert.equal(revisionDocKey({ kind: "text", block: "text-terms" }, "b1"), "text:text-terms@b1");
  assert.equal(revisionDocKey({ kind: "policy" }, "b1"), "policy@b1");
  assert.equal(revisionDocKey({ kind: "knowledge", id: "doc_1" }, "b1"), "knowledge:doc_1");
  for (const key of ["text:text-terms", "text:text-terms@b1", "policy", "policy@b1", "knowledge:doc_1"]) {
    const parsed = parseRevisionDocKey(key);
    assert.ok(parsed, key);
    assert.equal(revisionDocKey(parsed.ref, parsed.buildingId), key);
  }
});

test("битые и чужие ключи не разбираются", () => {
  for (const key of ["", "text:", "text:policy", "text:prp-medical", "knowledge:", "knowledge:a b", "policy@a@b", "policy@a b", "ppk", "x".repeat(300)]) {
    assert.equal(parseRevisionDocKey(key), null, key);
  }
});

test("тексты с редакциями — пункты структуры с текстом", () => {
  const textBlocks = PPK_STRUCTURE_ITEMS.flatMap((item) => (item.text ? [item.text.block] : []));
  assert.deepEqual([...REVISION_TEXT_BLOCKS].sort(), [...textBlocks].sort());
});

test("подпись редакции «ППК 003 от 24.11.2026» в поясе организации", () => {
  assert.equal(revisionLabel({ code: "ППК 003", approvedAt: "2026-11-24T10:00:00.000Z" }), "ППК 003 от 24.11.2026");
  // 23:30 UTC — уже следующий день в Москве.
  assert.equal(revisionLabel({ code: "ППК 004", approvedAt: "2026-11-24T23:30:00.000Z" }, "Europe/Moscow"), "ППК 004 от 25.11.2026");
  assert.equal(revisionLabel({ code: "ППК 005", approvedAt: "2026-11-24T10:00:00.000Z" }, "Bad/Zone"), "ППК 005 от 24.11.2026");
});

test("русские заголовки пунктов и разделов для печати", () => {
  for (const item of PPK_STRUCTURE_ITEMS) assert.notEqual(ppkItemTitleRu(item.id), item.id, item.id);
  assert.equal(ppkItemHeadingRu({ id: "1-1", number: "1.1", section: "primary" }), "1.1. Общая информация об организации");
  assert.equal(ppkItemHeadingRu({ id: "app-3", number: "3", section: "appendix" }), "Приложение №3 «График разделения потоков»");
  assert.equal(ppkSectionHeadingRu(PPK_STRUCTURE[1]), "2. План ХАССП");
  assert.equal(ppkSectionHeadingRu(PPK_STRUCTURE[3]), "Приложения");
});
