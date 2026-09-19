import assert from "node:assert/strict";
import test from "node:test";

import {
  canCreateLossFromWriteoffRow,
  createProductWriteoffRow,
  normalizeProductWriteoffConfig,
  parseWriteoffQuantity,
  writeoffRowToLossDraft,
} from "@/lib/product-writeoff-document";

test("строка акта забраковки → черновик потери: продукт, количество, причина, дата", () => {
  const row = createProductWriteoffRow({
    productName: "Сыр «Российский»",
    batchNumber: "B-20260910-001",
    quantity: "3,5 кг",
    discrepancyDescription: "Плесень на корке",
    action: "Утиль",
  });
  const draft = writeoffRowToLossDraft(row, {
    documentDate: "2026-09-12",
    actNumber: "7",
  });
  assert.equal(draft.category, "writeoff");
  assert.equal(draft.productName, "Сыр «Российский»");
  assert.equal(draft.quantity, 3.5);
  assert.equal(draft.unit, "kg");
  assert.equal(draft.date, "2026-09-12");
  assert.match(draft.cause ?? "", /Плесень на корке/);
  assert.match(draft.cause ?? "", /действие: Утиль/);
  assert.match(draft.cause ?? "", /партия B-20260910-001/);
});

test("черновик потери не падает на пустых полях строки", () => {
  const draft = writeoffRowToLossDraft(
    createProductWriteoffRow({ productName: "Хлеб" }),
    { documentDate: "12.09.2026", actNumber: "1" }
  );
  assert.equal(draft.quantity, 0);
  assert.equal(draft.unit, "kg");
  assert.equal(draft.cause, null);
  // Дата не в формате ISO — в API не отправляем, там подставится сегодня.
  assert.equal(draft.date, null);

  assert.deepEqual(parseWriteoffQuantity("12 шт"), { quantity: 12, unit: "pcs" });
  assert.deepEqual(parseWriteoffQuantity("0,4 л"), { quantity: 0.4, unit: "l" });
  assert.deepEqual(parseWriteoffQuantity(undefined), { quantity: 0, unit: "kg" });
});

test("потерю по строке заводим один раз, и только если есть наименование", () => {
  const row = createProductWriteoffRow({ productName: "Хлеб" });
  assert.equal(canCreateLossFromWriteoffRow(row), true);
  assert.equal(canCreateLossFromWriteoffRow({ ...row, lossRecordId: "loss-1" }), false);
  assert.equal(canCreateLossFromWriteoffRow({ ...row, productName: "" }), false);
});

test("ссылка на потерю переживает нормализацию конфига, старые строки не меняются", () => {
  const config = normalizeProductWriteoffConfig({
    rows: [
      { id: "r1", productName: "Хлеб", lossRecordId: "loss-1" },
      { id: "r2", productName: "Соль" },
    ],
  });
  assert.equal(config.rows[0].lossRecordId, "loss-1");
  // У старой строки поля нет вовсе — по нему и отличаем «ещё не записано».
  assert.equal("lossRecordId" in config.rows[1], false);
});
