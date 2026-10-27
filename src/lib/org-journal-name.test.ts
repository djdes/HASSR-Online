import assert from "node:assert/strict";
import test from "node:test";

import {
  ORG_HEADER_NAME_CONFIG_KEY,
  ORG_JOURNAL_NAME_MAX,
  readHeaderOrgNameOverride,
  resolveOrgJournalName,
  sidebarLegalName,
  sanitizeOrgJournalName,
  suggestOrgJournalName,
} from "@/lib/org-journal-name";

const org = {
  name: "Общество с ограниченной ответственностью «Кафе у дома»",
  journalShortName: "Кафе у дома",
  legalProfileJson: { inn: "7700000000", nameShort: "ООО «КАФЕ У ДОМА»" },
};

test("цепочка: override документа → короткое → ЕГРЮЛ → полное → «Организация»", () => {
  assert.equal(resolveOrgJournalName(org, { [ORG_HEADER_NAME_CONFIG_KEY]: "Кафе, цех 2" }), "Кафе, цех 2");
  assert.equal(resolveOrgJournalName(org, {}), "Кафе у дома");
  assert.equal(resolveOrgJournalName({ ...org, journalShortName: null }), "ООО «КАФЕ У ДОМА»");
  assert.equal(
    resolveOrgJournalName({ ...org, journalShortName: "", legalProfileJson: null }),
    org.name
  );
  assert.equal(resolveOrgJournalName({ name: "" }), "Организация");
  assert.equal(resolveOrgJournalName(null), "Организация");
});

test("пустой или пробельный override игнорируется", () => {
  assert.equal(resolveOrgJournalName(org, { [ORG_HEADER_NAME_CONFIG_KEY]: "   " }), "Кафе у дома");
  assert.equal(readHeaderOrgNameOverride({ [ORG_HEADER_NAME_CONFIG_KEY]: "" }), null);
  assert.equal(readHeaderOrgNameOverride(null), null);
  assert.equal(readHeaderOrgNameOverride([]), null);
});

test("почтовая заглушка из мгновенной регистрации не печатается", () => {
  assert.equal(resolveOrgJournalName({ name: "Организация ivan@mail.ru" }), "Организация");
});

test("никогда не «Тест»", () => {
  for (const source of [null, {}, { name: "" }, { name: "   " }]) {
    assert.doesNotMatch(resolveOrgJournalName(source), /Тест/);
  }
});

test("sanitize: пробелы схлопываются, длина ограничена", () => {
  assert.equal(sanitizeOrgJournalName("  Кафе   у\nдома "), "Кафе у дома");
  assert.equal(sanitizeOrgJournalName(42), "");
  assert.equal(sanitizeOrgJournalName("а".repeat(500)).length, ORG_JOURNAL_NAME_MAX);
});

test("подсказка из ЕГРЮЛ", () => {
  assert.equal(suggestOrgJournalName(org.legalProfileJson), "ООО «КАФЕ У ДОМА»");
  assert.equal(suggestOrgJournalName({ inn: "1" }), null);
  assert.equal(suggestOrgJournalName(null), null);
});

test("sidebarLegalName: ЕГРЮЛ → название для журналов → название при логотипе; без повтора", () => {
  const profile = { nameShort: "ООО «Кафе у дома»" };
  assert.equal(sidebarLegalName({ legalProfileJson: profile }, { companyName: "Кафе", hasLogo: false }), "ООО «Кафе у дома»");
  assert.equal(sidebarLegalName({ journalShortName: "ИП Петров" }, { companyName: "Кафе", hasLogo: false }), "ИП Петров");
  assert.equal(sidebarLegalName({}, { companyName: "Кафе", hasLogo: true }), "Кафе");
  assert.equal(sidebarLegalName({}, { companyName: "Кафе", hasLogo: false }), null);
  assert.equal(sidebarLegalName({ journalShortName: "кафе" }, { companyName: "Кафе", hasLogo: false }), null);
});
