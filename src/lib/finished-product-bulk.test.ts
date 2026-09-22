import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPaste,
  emptyDishYieldRows,
  FINISHED_PRODUCT_BULK_MAX,
  isYieldValue,
  parseDishYieldPaste,
} from "@/lib/finished-product-bulk";

test("вид выхода: 150, 200/10, 150 г, 250/10/5", () => {
  for (const value of ["150", "200/10", "150 г", "150г", "250/10/5", "0,5", "1 шт.", "200 мл"]) {
    assert.equal(isYieldValue(value), true, value);
  }
  for (const value of ["Борщ", "", "Салат 2", "Выход"]) {
    assert.equal(isYieldValue(value), false, value);
  }
});

test("два столбца из Excel: наименование, выход", () => {
  const { rows, kind } = parseDishYieldPaste("Борщ\t250\nКотлета по-киевски\t150/50\n");
  assert.equal(kind, "pairs");
  assert.deepEqual(rows, [
    { name: "Борщ", yield: "250" },
    { name: "Котлета по-киевски", yield: "150/50" },
  ]);
});

test("два столбца в обратном порядке: выход, наименование", () => {
  const { rows, kind } = parseDishYieldPaste("250\tБорщ\r\n200/10\tСырники\r\n");
  assert.equal(kind, "pairs");
  assert.deepEqual(rows, [
    { name: "Борщ", yield: "250" },
    { name: "Сырники", yield: "200/10" },
  ]);
});

test("разделители ; и |", () => {
  assert.deepEqual(parseDishYieldPaste("Борщ;250\nКомпот;200 мл").rows, [
    { name: "Борщ", yield: "250" },
    { name: "Компот", yield: "200 мл" },
  ]);
  assert.deepEqual(parseDishYieldPaste("Борщ | 250").rows, [{ name: "Борщ", yield: "250" }]);
});

test("строка-заголовок пропускается", () => {
  const { rows } = parseDishYieldPaste("Наименование блюда\tВыход, г\nБорщ\t250");
  assert.deepEqual(rows, [{ name: "Борщ", yield: "250" }]);
  assert.deepEqual(parseDishYieldPaste("Вес\tИзделие\n150\tКотлета").rows, [{ name: "Котлета", yield: "150" }]);
});

test("нумерация и лишние пробелы снимаются", () => {
  const { rows, kind } = parseDishYieldPaste("1. Борщ\n2)  Котлета   по-киевски\n- Компот\n• Чай");
  assert.equal(kind, "names");
  assert.deepEqual(
    rows.map((row) => row.name),
    ["Борщ", "Котлета по-киевски", "Компот", "Чай"]
  );
});

test("отдельный столбец с номерами строк не считается выходом", () => {
  const { rows, kind } = parseDishYieldPaste("1\tБорщ\t250\n2\tКомпот\t200");
  assert.equal(kind, "pairs");
  assert.deepEqual(rows, [
    { name: "Борщ", yield: "250" },
    { name: "Компот", yield: "200" },
  ]);
});

test("один столбец наименований", () => {
  const { rows, kind } = parseDishYieldPaste("Борщ\nКотлета\nКомпот\n");
  assert.equal(kind, "names");
  assert.deepEqual(rows, [
    { name: "Борщ", yield: "" },
    { name: "Котлета", yield: "" },
    { name: "Компот", yield: "" },
  ]);
});

test("один столбец выходов", () => {
  const { rows, kind } = parseDishYieldPaste("250\n200/10\n150 г\n");
  assert.equal(kind, "yields");
  assert.deepEqual(
    rows.map((row) => row.yield),
    ["250", "200/10", "150 г"]
  );
  assert.ok(rows.every((row) => row.name === ""));
});

test("пустые ячейки в середине сохраняют выравнивание пар", () => {
  const { rows, kind } = parseDishYieldPaste("Борщ\t250\nСалат\t\n\t\nКомпот\t200\n\n");
  assert.equal(kind, "pairs");
  assert.deepEqual(rows, [
    { name: "Борщ", yield: "250" },
    { name: "Салат", yield: "" },
    { name: "", yield: "" },
    { name: "Компот", yield: "200" },
  ]);
});

test("дубликаты не удаляются: один суп в двух выходах", () => {
  const { rows } = parseDishYieldPaste("Борщ\t250\nБорщ\t500");
  assert.equal(rows.length, 2);
});

test("не больше 50 строк; длины обрезаются", () => {
  const text = Array.from({ length: 70 }, (_, i) => `Блюдо ${i + 1}\t${100 + i}`).join("\n");
  const { rows } = parseDishYieldPaste(text);
  assert.equal(rows.length, FINISHED_PRODUCT_BULK_MAX);
  assert.equal(rows[49].name, "Блюдо 50");

  const long = parseDishYieldPaste(`${"я".repeat(300)}\t${"1/".repeat(20)}1`).rows[0];
  assert.equal(long.name.length, 200);
  assert.ok(long.yield.length <= 20);
});

test("applyPaste: пары заполняют оба столбца с текущей строки, строки выше не трогаются", () => {
  const start = emptyDishYieldRows(3);
  start[0] = { name: "Вручную", yield: "100" };
  const next = applyPaste(start, 1, parseDishYieldPaste("Борщ\t250\nКомпот\t200\nЧай\t200"));
  assert.deepEqual(next, [
    { name: "Вручную", yield: "100" },
    { name: "Борщ", yield: "250" },
    { name: "Компот", yield: "200" },
    { name: "Чай", yield: "200" },
  ]);
  assert.deepEqual(start[1], { name: "", yield: "" }, "исходный массив не меняется");
});

test("applyPaste: столбец выходов ложится рядом с уже вписанными наименованиями", () => {
  const start = [
    { name: "Борщ", yield: "" },
    { name: "Компот", yield: "" },
  ];
  const next = applyPaste(start, 0, parseDishYieldPaste("250\n200\n150"));
  assert.deepEqual(next, [
    { name: "Борщ", yield: "250" },
    { name: "Компот", yield: "200" },
    { name: "", yield: "150" },
  ]);
});

test("applyPaste: столбец наименований не затирает выходы", () => {
  const start = [
    { name: "", yield: "250" },
    { name: "", yield: "200" },
  ];
  const next = applyPaste(start, 0, parseDishYieldPaste("Борщ\nКомпот"));
  assert.deepEqual(next, [
    { name: "Борщ", yield: "250" },
    { name: "Компот", yield: "200" },
  ]);
});

test("applyPaste: всего строк в таблице не больше 50", () => {
  const start = emptyDishYieldRows(45);
  const text = Array.from({ length: 20 }, (_, i) => `Блюдо ${i}`).join("\n");
  const next = applyPaste(start, 40, parseDishYieldPaste(text));
  assert.equal(next.length, FINISHED_PRODUCT_BULK_MAX);
  assert.equal(next[49].name, "Блюдо 9");
});

test("один столбец: «Блюдо дня» не принимается за заголовок", () => {
  assert.deepEqual(
    parseDishYieldPaste("Блюдо дня\nКомпот").rows.map((row) => row.name),
    ["Блюдо дня", "Компот"]
  );
  assert.deepEqual(parseDishYieldPaste("Наименование\nКомпот").rows, [{ name: "Компот", yield: "" }]);
});
