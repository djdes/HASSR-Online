import assert from "node:assert/strict";
import test from "node:test";

import { decodeXml, parseAmount, parseRuDate, parseUpd, UpdParseError } from "./upd";
import { toCp1251, UPD_501, UPD_503 } from "./upd-fixtures";


test("UPD 5.01 in windows-1251: number, date, seller, buyer, lines, units, expiry, totals, basis", () => {
  const upd = parseUpd(toCp1251(UPD_501));
  assert.equal(upd.kind, "upd");
  assert.equal(upd.function, "СЧФДОП");
  assert.equal(upd.formatVersion, "5.01");
  assert.equal(upd.number, "МД-1031");
  assert.equal(upd.date, "2026-10-31");
  assert.deepEqual(upd.seller, { name: "ООО «Молочный двор»", inn: "7701234567", kpp: "770101001" });
  assert.deepEqual(upd.buyer, { name: "МБОУ СОШ № 8", inn: "5001234567", kpp: "500101001" });
  assert.equal(upd.items.length, 2);
  assert.deepEqual(upd.items[0], {
    line: 1,
    name: "Молоко питьевое 3,2% 1 л",
    unit: "л",
    quantity: 40,
    price: 78.5,
    amount: 3454,
    code: "M-32-1",
    expiryDate: "2026-11-05",
  });
  assert.equal(upd.items[1].unit, "кг");
  assert.equal(upd.items[1].quantity, 5.5);
  assert.equal(upd.items[1].expiryDate, null);
  assert.equal(upd.total, 5329.5);
  assert.equal(upd.basis, "Договор поставки № 12/26 от 10.01.2026");
  assert.equal(upd.shippedDate, "2026-10-31");
});

test("UPD 5.03 in UTF-8 from a sole trader: renamed attributes and ISO expiry", () => {
  const upd = parseUpd(new TextEncoder().encode(UPD_503));
  assert.equal(upd.function, "ДОП");
  assert.equal(upd.number, "17");
  assert.equal(upd.date, "2026-10-30");
  assert.deepEqual(upd.seller, { name: "ИП Петров Пётр Петрович", inn: "500100732259", kpp: null });
  assert.equal(upd.buyer, null);
  assert.equal(upd.items[0].unit, "кг");
  assert.equal(upd.items[0].quantity, 12.4);
  assert.equal(upd.items[0].expiryDate, "2026-11-02");
  assert.equal(upd.basis, null, "«без документа-основания» — не основание");
});

test("not a UPD or broken UPD gives a reason a person understands", () => {
  const expect = (input: string, fragment: RegExp) =>
    assert.throws(() => parseUpd(input), (error: unknown) => error instanceof UpdParseError && fragment.test(error.message));
  expect("<html><body>login</body></html>", /не УПД/);
  expect("это не xml", /не УПД|не похож на XML/);
  expect(UPD_503.replace('НомерДок="17" ', ""), /номера или даты/);
  expect(UPD_503.replace(/<СвПрод>[\s\S]*?<\/СвПрод>/, ""), /нет продавца/);
  expect(UPD_503.replace(/<СведТов[\s\S]*?<\/СведТов>/, ""), /нет строк/);
});

test("helpers: encodings, dates and amounts", () => {
  assert.equal(decodeXml(toCp1251('<?xml version="1.0" encoding="windows-1251"?><a>Ёлка №1</a>')).endsWith("<a>Ёлка №1</a>"), true);
  assert.equal(decodeXml(new TextEncoder().encode("﻿<a>Да</a>")), "<a>Да</a>");
  assert.equal(parseRuDate("01.02.2026"), "2026-02-01");
  assert.equal(parseRuDate("2026-02-01T00:00:00"), "2026-02-01");
  assert.equal(parseRuDate("вчера"), null);
  assert.equal(parseAmount("1 234,50"), 1234.5);
  assert.equal(parseAmount("—"), null);
});
