import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { QrPrintFormat } from "@/lib/qr-fill-types";
import { composeQrPrintPages, sheetsLabel } from "@/lib/qr-print-layout";

const entries = (format: QrPrintFormat, count: number, prefix = format) =>
  Array.from({ length: count }, (_, index) => ({ key: `${prefix}-${index + 1}`, format }));

describe("composeQrPrintPages — раскладка смешанной печати", () => {
  it("1 A4 + 3 A5 + 13 наклеек = 5 листов (1 + 2 + 2)", () => {
    const pages = composeQrPrintPages([...entries("a4", 1), ...entries("a5", 3), ...entries("sticker", 13)]);
    assert.equal(pages.length, 5);
    assert.deepEqual(
      pages.map((page) => [page.format, page.keys.length]),
      [
        ["a4", 1],
        ["a5", 2],
        ["a5", 1],
        ["sticker", 12],
        ["sticker", 1],
      ]
    );
  });

  it("вперемешку — листы по первому появлению формата, внутри формата порядок экрана", () => {
    const pages = composeQrPrintPages([
      { key: "s1", format: "sticker" },
      { key: "p1", format: "a4" },
      { key: "s2", format: "sticker" },
      { key: "h1", format: "a5" },
      { key: "p2", format: "a4" },
    ]);
    assert.deepEqual(pages, [
      { format: "sticker", keys: ["s1", "s2"] },
      { format: "a4", keys: ["p1"] },
      { format: "a4", keys: ["p2"] },
      { format: "a5", keys: ["h1"] },
    ]);
  });

  it("ровно 12 наклеек — один лист, без пустого последнего", () => {
    assert.equal(composeQrPrintPages(entries("sticker", 12)).length, 1);
    assert.equal(composeQrPrintPages(entries("sticker", 24)).length, 2);
    assert.equal(composeQrPrintPages(entries("a5", 4)).length, 2);
  });

  it("пусто — нет листов; повтор ключа печатается один раз", () => {
    assert.deepEqual(composeQrPrintPages([]), []);
    assert.equal(composeQrPrintPages([{ key: "x", format: "a4" }, { key: "x", format: "a4" }]).length, 1);
  });
});

describe("sheetsLabel", () => {
  it("склонение", () => {
    assert.equal(sheetsLabel(1), "1 лист");
    assert.equal(sheetsLabel(3), "3 листа");
    assert.equal(sheetsLabel(5), "5 листов");
    assert.equal(sheetsLabel(11), "11 листов");
    assert.equal(sheetsLabel(12), "12 листов");
    assert.equal(sheetsLabel(21), "21 лист");
    assert.equal(sheetsLabel(22), "22 листа");
  });
});
