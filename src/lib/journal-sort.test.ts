import assert from "node:assert/strict";
import test from "node:test";

import { compareJournalNames, sortJournalsByName } from "./journal-sort";

const names = (list: string[]) => sortJournalsByName(list, (name) => name);

test("по алфавиту без учёта регистра", () => {
  assert.deepEqual(names(["журнал уборки", "Бракераж", "Гигиенический журнал", "Журнал здоровья"]), [
    "Бракераж",
    "Гигиенический журнал",
    "Журнал здоровья",
    "журнал уборки",
  ]);
});

test("номера по порядку: №2 раньше №10", () => {
  assert.deepEqual(names(["Холодильник №10", "Холодильник №2", "Холодильник №1"]), [
    "Холодильник №1",
    "Холодильник №2",
    "Холодильник №10",
  ]);
});

test("«ё» стоит как «е», кавычки в начале не мешают", () => {
  assert.equal(compareJournalNames("Журнал учёта", "Журнал учета"), 0);
  assert.ok(compareJournalNames("Ёмкости", "Журнал") < 0);
  assert.deepEqual(names(["Журнал", "«Бракераж» сырья"]), ["«Бракераж» сырья", "Журнал"]);
});

test("исходный список не меняется, равные остаются в своём порядке", () => {
  const list = [
    { id: "a", name: "Журнал" },
    { id: "b", name: "Бланк" },
    { id: "c", name: "журнал" },
  ];
  const sorted = sortJournalsByName(list, (item) => item.name);
  assert.deepEqual(
    sorted.map((item) => item.id),
    ["b", "a", "c"],
  );
  assert.deepEqual(
    list.map((item) => item.id),
    ["a", "b", "c"],
  );
});
