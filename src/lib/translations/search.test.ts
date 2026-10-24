import assert from "node:assert/strict";
import { test } from "node:test";
import { highlightSegments, normalizeSearchText, pageWindow, searchRank, searchTokens } from "./search";

const rank = (needle: string, key: string, texts: string[]) =>
  searchRank(normalizeSearchText(needle).trim(), normalizeSearchText(key), texts.map(normalizeSearchText));

test("search text ignores case, ё/е and the shape of Uzbek apostrophes", () => {
  assert.equal(normalizeSearchText("Ёлка СОХРАНИТЬ"), "елка сохранить");
  assert.equal(normalizeSearchText("Oʻzbek o‘rnatish gʼ o’"), "o'zbek o'rnatish g' o'");
  // Length is kept: highlight positions map onto the original text.
  for (const sample of ["Ёлка", "Oʻzbek", "Saqlash"]) assert.equal(normalizeSearchText(sample).length, sample.length);
  assert.deepEqual(searchTokens("  Журнал   гигиены "), ["журнал", "гигиены"]);
  assert.deepEqual(searchTokens("   "), []);
});

test("search rank puts exact matches first and finds every language and the key", () => {
  assert.equal(rank("сохранить", "common.save", ["Сохранить", "Save", "Saqlash"]), 0);
  assert.equal(rank("common.save", "common.save", ["Сохранить", "Save", "Saqlash"]), 0);
  assert.equal(rank("save", "common.save", ["Сохранить", "Save", "Saqlash"]), 0);
  assert.equal(rank("saql", "a.b", ["Сохранить", "Save", "Saqlash"]), 1);
  assert.equal(rank("журнал", "a.b", ["Гигиенический журнал", "Hygiene log", "Gigiyena jurnali"]), 2);
  assert.equal(rank("hygiene.col", "hygiene.columns.employee", ["Сотрудник", "Employee", "Xodim"]), 3);
  assert.equal(rank("урнал", "a.b", ["Гигиенический журнал", "Hygiene log", "Gigiyena jurnali"]), 4);
  assert.equal(rank("журнал гигиен", "a.b", ["Гигиенический журнал", "Hygiene log", "Gigiyena jurnali"]), 5);
  // Uzbek typed with a plain apostrophe finds the catalog's oʻ / o‘.
  assert.equal(rank("o'zbek", "a.b", ["Узбекский", "Uzbek", "O‘zbek tili"]), 1);
  assert.equal(rank("елка", "a.b", ["Ёлка", "Tree", "Archa"]), 0);
  assert.equal(rank("нет такого", "a.b", ["Ёлка", "Tree", "Archa"]), null);
  assert.equal(rank("  ", "a.b", ["Ёлка"]), null);
});

test("highlight marks every query word without changing the text", () => {
  assert.deepEqual(highlightSegments("Гигиенический журнал", ["журнал"]), [
    { text: "Гигиенический ", match: false },
    { text: "журнал", match: true },
  ]);
  assert.deepEqual(highlightSegments("O‘zbek", ["o'z"]), [
    { text: "O‘z", match: true },
    { text: "bek", match: false },
  ]);
  // Overlapping words merge into one mark.
  assert.deepEqual(highlightSegments("abcdef", ["abc", "bcd"]), [
    { text: "abcd", match: true },
    { text: "ef", match: false },
  ]);
  assert.deepEqual(highlightSegments("Save", []), [{ text: "Save", match: false }]);
  assert.deepEqual(highlightSegments("Save", ["xyz"]), [{ text: "Save", match: false }]);
  for (const segments of [highlightSegments("Журнал журнал", ["журнал"]), highlightSegments("a.b.c", ["."])]) {
    assert.ok(segments.length > 0);
  }
  assert.equal(highlightSegments("Журнал журнал", ["журнал"]).map((segment) => segment.text).join(""), "Журнал журнал");
});

test("page window keeps seven slots with the first, last and neighbours of the current page", () => {
  assert.deepEqual(pageWindow(1, 1), [1]);
  assert.deepEqual(pageWindow(3, 7), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(pageWindow(1, 20), [1, 2, 3, 4, 5, "gap", 20]);
  assert.deepEqual(pageWindow(4, 20), [1, 2, 3, 4, 5, "gap", 20]);
  assert.deepEqual(pageWindow(5, 20), [1, "gap", 4, 5, 6, "gap", 20]);
  assert.deepEqual(pageWindow(17, 20), [1, "gap", 16, 17, 18, 19, 20]);
  assert.deepEqual(pageWindow(20, 20), [1, "gap", 16, 17, 18, 19, 20]);
  for (let total = 1; total <= 30; total++) {
    for (let current = 1; current <= total; current++) {
      const window = pageWindow(current, total);
      assert.ok(window.includes(current), `${current}/${total}`);
      assert.ok(window.length <= 7);
      assert.equal(window[0], 1);
      assert.equal(window[window.length - 1], total);
    }
  }
});
