import assert from "node:assert/strict";
import test from "node:test";

import {
  filterQrPosterItems,
  orderQrPosterItems,
  qrSelectAllLabel,
  type QrListEntry,
} from "./qr-posters-list";

function entry(key: string, group: QrListEntry["group"], label: string, extra: Partial<QrListEntry> = {}): QrListEntry {
  return { key, group, label, search: [label, key, extra.location ?? null], ...extra };
}

const keys = (items: QrListEntry[]) => items.map((item) => item.key);

test("универсальные остаются первыми и в своём порядке", () => {
  const items = [
    entry("hygiene@verify", "main", "Допуск сотрудников к смене"),
    entry("brakerage", "extra", "Бракераж"),
    entry("__hub__", "main", "Все журналы"),
  ];
  assert.deepEqual(keys(orderQrPosterItems(items)), ["hygiene@verify", "__hub__", "brakerage"]);
});

test("журналы по алфавиту по видимому названию: ё как е, номера по смыслу", () => {
  const items = [
    entry("zz", "extra", "Учёт дезсредств"),
    entry("aa", "extra", "Журнал №10"),
    entry("bb", "extra", "Журнал №2"),
    entry("cc", "extra", "«Бракераж»"),
    entry("dd", "extra", "Уборка"),
  ];
  assert.deepEqual(keys(orderQrPosterItems(items)), ["cc", "bb", "aa", "dd", "zz"]);
});

test("дополнительные: документ, из которого пришли, — первым; пара гигиены не разрывается", () => {
  const items = [
    entry("h:2", "extra", "Сентябрь", { sortName: "Сентябрь" }),
    entry("h@verify:2", "extra", "Допуск · Сентябрь", { sortName: "Сентябрь" }),
    entry("h:1", "extra", "Август", { sortName: "Август" }),
    entry("h@verify:1", "extra", "Допуск · Август", { sortName: "Август" }),
    entry("h:3", "extra", "Октябрь", { sortName: "Октябрь", highlighted: true }),
    entry("h@verify:3", "extra", "Допуск · Октябрь", { sortName: "Октябрь", highlighted: true }),
  ];
  assert.deepEqual(keys(orderQrPosterItems(items)), ["h:3", "h@verify:3", "h:1", "h@verify:1", "h:2", "h@verify:2"]);
});

test("наклейки объектов по названию, одинаковые — по месту", () => {
  const items = [
    entry("f3", "object", "Холодильник", { location: "Холодный цех" }),
    entry("f1", "object", "Морозильник 10", { location: "Склад" }),
    entry("f2", "object", "Морозильник 2", { location: "Склад" }),
    entry("f4", "object", "Холодильник", { location: "Горячий цех" }),
  ];
  assert.deepEqual(keys(orderQrPosterItems(items)), ["f2", "f1", "f4", "f3"]);
});

test("исходный список не меняется", () => {
  const items = [entry("b", "extra", "Бракераж"), entry("a", "extra", "Аудит")];
  orderQrPosterItems(items);
  assert.deepEqual(keys(items), ["b", "a"]);
});

test("поиск: все слова в любом порядке, ё = е, по коду и месту", () => {
  const items = [
    entry("hygiene", "extra", "Гигиенический журнал (сотрудники)"),
    entry("f1", "object", "Холодильник", { location: "Холодный цех" }),
    entry("disinfectant", "extra", "Учёт дезсредств"),
  ];
  assert.deepEqual(keys(filterQrPosterItems(items, "журнал гигиен")), ["hygiene"]);
  assert.deepEqual(keys(filterQrPosterItems(items, "учет")), ["disinfectant"]);
  assert.deepEqual(keys(filterQrPosterItems(items, "ХОЛОДНЫЙ  цех")), ["f1"]);
  assert.deepEqual(keys(filterQrPosterItems(items, "disinf")), ["disinfectant"]);
  assert.deepEqual(keys(filterQrPosterItems(items, "  ")), ["hygiene", "f1", "disinfectant"]);
  assert.deepEqual(keys(filterQrPosterItems(items, "нет такого")), []);
});

test("подпись «Отметить все» при поиске говорит, что действует на найденные", () => {
  assert.equal(qrSelectAllLabel({ allSelected: false, searching: false }), "Отметить все");
  assert.equal(qrSelectAllLabel({ allSelected: true, searching: false }), "Снять все");
  assert.equal(qrSelectAllLabel({ allSelected: false, searching: true }), "Отметить найденные");
  assert.equal(qrSelectAllLabel({ allSelected: true, searching: true }), "Снять найденные");
});
