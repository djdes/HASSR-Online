import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

import {
  diffSharedNames,
  normalizeSharedItems,
  parseSharedItemsFromSheet,
  parseSharedItemsFromText,
  type SharedItem,
} from "@/lib/master-directory";

const item = (name: string, supplier: string | null = null, manufacturer: string | null = null): SharedItem => ({
  name,
  supplier,
  manufacturer,
});

function sheetBuffer(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Лист1");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

test("normalizeSharedItems: trims, collapses spaces, drops empty names", () => {
  const result = normalizeSharedItems([
    item("  Борщ   украинский "),
    item("   "),
    item("Котлета", "  ", " ООО  Мясо "),
  ]);
  assert.deepEqual(result, [item("Борщ украинский"), item("Котлета", null, "ООО Мясо")]);
});

test("normalizeSharedItems: case-insensitive dedupe keeps the first occurrence", () => {
  const result = normalizeSharedItems([item("Салат Цезарь", "А"), item("салат цезарь", "Б"), item("САЛАТ  ЦЕЗАРЬ")]);
  assert.deepEqual(result, [item("Салат Цезарь", "А")]);
});

test("normalizeSharedItems: caps the list at 5000 items", () => {
  const many = Array.from({ length: 6000 }, (_, index) => item(`Блюдо ${index}`));
  const result = normalizeSharedItems(many);
  assert.equal(result.length, 5000);
  assert.equal(result[4999].name, "Блюдо 4999");
});

test("parseSharedItemsFromText: lines and semicolons are separate items", () => {
  const result = parseSharedItemsFromText("Борщ\nПлов; Компот\r\n\n  Сырники  ");
  assert.deepEqual(
    result.map((row) => row.name),
    ["Борщ", "Плов", "Компот", "Сырники"]
  );
});

test("parseSharedItemsFromText: «Название | Поставщик | Изготовитель» is optional", () => {
  const result = parseSharedItemsFromText("Молоко 3,2% | ИП Иванов | ООО Молокозавод\nСметана | ИП Петров\nТворог");
  assert.deepEqual(result, [
    item("Молоко 3,2%", "ИП Иванов", "ООО Молокозавод"),
    item("Сметана", "ИП Петров"),
    item("Творог"),
  ]);
});

test("parseSharedItemsFromSheet: header «Наименование» with supplier/manufacturer columns", () => {
  const buf = sheetBuffer([
    ["№", "Наименование", "Поставщик", "Изготовитель"],
    [1, "Молоко", "ИП Иванов", "Молокозавод"],
    [2, "Кефир", "", ""],
    [3, "", "ИП Пустой", ""],
  ]);
  const result = parseSharedItemsFromSheet(buf, "сырьё.xlsx");
  assert.deepEqual(result, [item("Молоко", "ИП Иванов", "Молокозавод"), item("Кефир")]);
});

test("parseSharedItemsFromSheet: supplier header wins over the generic «наименование» word", () => {
  const buf = sheetBuffer([
    ["Продукт", "Наименование поставщика", "Производитель"],
    ["Масло", "ООО Опт", "Вологда"],
  ]);
  assert.deepEqual(parseSharedItemsFromSheet(buf, "list.xlsx"), [item("Масло", "ООО Опт", "Вологда")]);
});

test("parseSharedItemsFromSheet: no header — first column, first row included", () => {
  const buf = sheetBuffer([["Борщ", "250 г"], ["Плов"], ["Компот"]]);
  assert.deepEqual(
    parseSharedItemsFromSheet(buf, "menu.xlsx").map((row) => row.name),
    ["Борщ", "Плов", "Компот"]
  );
});

test("parseSharedItemsFromSheet: UTF-8 CSV with Cyrillic and semicolons", () => {
  const csv = "Наименование;Поставщик\nПельмени;ИП Бубнов\nВареники;\n";
  const result = parseSharedItemsFromSheet(Buffer.from(csv, "utf8"), "menu.csv");
  assert.deepEqual(result, [item("Пельмени", "ИП Бубнов"), item("Вареники")]);
});

test("diffSharedNames: ignores case and surrounding spaces", () => {
  const diff = diffSharedNames(["Борщ", "Плов ", "Компот"], ["борщ", "Компот", "Сырники"]);
  assert.deepEqual(diff, { added: ["Сырники"], removed: ["Плов"], unchanged: 2 });
});

test("diffSharedNames: empty current — everything is added", () => {
  assert.deepEqual(diffSharedNames([], ["А", "Б"]), { added: ["А", "Б"], removed: [], unchanged: 0 });
});

test("parseSharedItemsFromSheet: Windows-1251 CSV (Excel export) is decoded", () => {
  // «Наименование\nБорщ\n» в Windows-1251.
  const bytes = Buffer.from([
    0xcd, 0xe0, 0xe8, 0xec, 0xe5, 0xed, 0xee, 0xe2, 0xe0, 0xed, 0xe8, 0xe5, 0x0a, 0xc1, 0xee, 0xf0, 0xf9, 0x0a,
  ]);
  assert.deepEqual(parseSharedItemsFromSheet(bytes, "menu.csv").map((row) => row.name), ["Борщ"]);
});
