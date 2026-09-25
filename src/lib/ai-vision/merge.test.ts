import assert from "node:assert/strict";
import test from "node:test";

import { mergeMenuItemsIntoRows } from "@/lib/ai-vision/merge";

type Row = { name: string; yield: string; time: string; yieldAuto?: boolean };
const make = (values: { name: string; yield: string; time: string }): Row => ({ ...values, yieldAuto: false });
const blank = (): Row => ({ name: "", yield: "", time: "" });

test("пустые строки заполняются первыми, остальное — в конец", () => {
  const rows: Row[] = [{ name: "Чай", yield: "200", time: "" }, blank(), blank()];
  const result = mergeMenuItemsIntoRows(
    rows,
    [
      { name: "Борщ", yield: "250", time: "8:30" },
      { name: "Плов", yield: "200/10", time: "" },
      { name: "Компот", yield: "", time: "07:30" },
    ],
    { maxRows: 10, withYield: true, withTime: true, make }
  );
  assert.deepEqual(
    result.rows.map((row) => [row.name, row.yield, row.time]),
    [
      ["Чай", "200", ""],
      ["Борщ", "250", "08:30"],
      ["Плов", "200/10", ""],
      ["Компот", "", "07:30"],
    ]
  );
  assert.equal(result.added, 3);
  assert.equal(result.skipped, 0);
});

test("повторное распознавание того же фото не задваивает", () => {
  const rows: Row[] = [{ name: "Борщ", yield: "250", time: "08:30" }];
  const result = mergeMenuItemsIntoRows(
    rows,
    [
      { name: "борщ ", yield: "250", time: "08:30" },
      { name: "Борщ", yield: "250", time: "12:00" },
    ],
    { maxRows: 10, withYield: true, withTime: true, make }
  );
  assert.equal(result.skipped, 1);
  assert.equal(result.added, 1);
  assert.deepEqual(result.rows.map((row) => row.time), ["08:30", "12:00"]);
});

test("без колонки времени и выхода — только наименования, дубли по имени", () => {
  const result = mergeMenuItemsIntoRows(
    [blank()],
    [
      { name: "Борщ", yield: "250", time: "08:30" },
      { name: "Борщ", yield: "300", time: "12:00" },
    ],
    { maxRows: 10, withYield: false, withTime: false, make }
  );
  assert.deepEqual(result.rows, [{ name: "Борщ", yield: "", time: "", yieldAuto: false }]);
  assert.equal(result.skipped, 1);
});

test("предел таблицы: лишнее не влезает и считается", () => {
  const result = mergeMenuItemsIntoRows(
    [{ name: "А", yield: "", time: "" }],
    [
      { name: "Б", yield: "", time: "" },
      { name: "В", yield: "", time: "" },
      { name: "Г", yield: "", time: "" },
    ],
    { maxRows: 2, withYield: true, withTime: false, make }
  );
  assert.equal(result.rows.length, 2);
  assert.equal(result.added, 1);
  assert.equal(result.overflow, 2);
});

test("строка без наименования, но с временем — не пустая, её не затираем", () => {
  const rows: Row[] = [{ name: "", yield: "", time: "09:00" }];
  const result = mergeMenuItemsIntoRows(rows, [{ name: "Суп", yield: "", time: "" }], {
    maxRows: 5,
    withYield: true,
    withTime: true,
    make,
  });
  assert.deepEqual(result.rows.map((row) => row.name), ["", "Суп"]);
});
