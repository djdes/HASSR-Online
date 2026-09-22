import assert from "node:assert/strict";
import test from "node:test";

import { journalMatchesQuery, normalizeJournalSearch } from "@/lib/journal-search";

test("normalize: lower case, ё → е, collapsed spaces, trimmed", () => {
  assert.equal(normalizeJournalSearch("  Журнал   УЧЁТА  "), "журнал учета");
  assert.equal(normalizeJournalSearch("ЁЛКА"), "елка");
  assert.equal(normalizeJournalSearch("гигиена\t\n журнал"), "гигиена журнал");
  // Неразрывный пробел из копипаста — тоже пробел.
  assert.equal(normalizeJournalSearch("бракераж готовой"), "бракераж готовой");
  assert.equal(normalizeJournalSearch("   "), "");
});

test("normalize is idempotent", () => {
  const once = normalizeJournalSearch("  Учёт   ТЕМПЕРАТУРЫ ");
  assert.equal(normalizeJournalSearch(once), once);
});

test("empty query matches everything", () => {
  assert.equal(journalMatchesQuery(["Гигиенический журнал"], ""), true);
  assert.equal(journalMatchesQuery([], ""), true);
});

test("ё and е are the same letter in both directions", () => {
  assert.equal(journalMatchesQuery(["Журнал учёта температуры"], "учет"), true);
  assert.equal(journalMatchesQuery(["Журнал учета температуры"], "учёт"), true);
});

test("every query word must match, in any order", () => {
  const fields = ["Гигиенический журнал", null, "hygiene"];
  assert.equal(journalMatchesQuery(fields, "журнал гигиен"), true);
  assert.equal(journalMatchesQuery(fields, "гигиен бракераж"), false);
  // Слова могут прийти из разных полей: название + код.
  assert.equal(journalMatchesQuery(fields, "гигиен hygiene"), true);
});

test("query is re-normalized defensively (callers may pass raw input)", () => {
  assert.equal(journalMatchesQuery(["Журнал учёта"], "  УЧЁТ  "), true);
  assert.equal(journalMatchesQuery(["Журнал учёта"], "журнал    учет"), true);
});

test("null / undefined fields are ignored", () => {
  assert.equal(journalMatchesQuery([null, undefined, "Бракераж"], "бракераж"), true);
  assert.equal(journalMatchesQuery([null, undefined], "бракераж"), false);
});
