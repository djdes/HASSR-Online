import assert from "node:assert/strict";
import test from "node:test";

import { isOrgDirectoryKind, mergeIntoList, missingFromList } from "@/lib/org-directory";

test("вид справочника распознаётся, мусор — нет", () => {
  assert.equal(isOrgDirectoryKind("product"), true);
  assert.equal(isOrgDirectoryKind("dish"), true);
  assert.equal(isOrgDirectoryKind("нет такого"), false);
  assert.equal(isOrgDirectoryKind(null), false);
});

test("предлагаем только то, чего в журнале ещё нет (без учёта регистра)", () => {
  const directory = ["Молоко 3.2%", "Сметана", "Творог"];
  assert.deepEqual(missingFromList(directory, ["  молоко 3.2%  ", "Творог"]), ["Сметана"]);
});

test("слияние не плодит повторы и сохраняет порядок", () => {
  assert.deepEqual(mergeIntoList(["Молоко"], ["Сметана", "молоко", "Творог"]), ["Молоко", "Сметана", "Творог"]);
});

test("пустые значения в слияние не попадают", () => {
  assert.deepEqual(mergeIntoList(["Молоко"], ["   ", ""]), ["Молоко"]);
});
