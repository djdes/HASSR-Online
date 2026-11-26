import assert from "node:assert/strict";
import test from "node:test";

import { mergeConfigPatch } from "./config-patch";

/**
 * Внешний API (`POST /api/external/entries`) для журналов, хранящих строки в
 * `config` документа: `data.rows` раньше заменял все строки документа —
 * строки, записанные с сайта, по QR или TasksFlow, пропадали (аудит перезаписи
 * 2026-11-26, группа D).
 */

test("rows: строка с известным id обновляется, остальные поля и строки остаются, новые дописываются", () => {
  const current = {
    title: "Бракераж",
    rows: [
      { id: "a", productName: "Суп", signatures: [{ userId: "chair" }] },
      { id: "b", productName: "Рагу" },
    ],
  };
  const next = mergeConfigPatch(current, {
    rows: [
      { id: "a", note: "пересолено" },
      { id: "c", productName: "Компот" },
    ],
  });
  assert.deepEqual(next, {
    title: "Бракераж",
    rows: [
      { id: "a", productName: "Суп", signatures: [{ userId: "chair" }], note: "пересолено" },
      { id: "b", productName: "Рагу" },
      { id: "c", productName: "Компот" },
    ],
  });
  // Исходный конфиг не меняется.
  assert.equal(current.rows.length, 2);
  assert.equal("note" in current.rows[0], false);
});

test("rows без id дописываются, повтор строки с тем же id не создаёт дубль", () => {
  const once = mergeConfigPatch({ rows: [{ id: "a", productName: "Суп" }] }, { rows: [{ productName: "Каша" }, { id: "n1", productName: "Чай" }] });
  const twice = mergeConfigPatch(once, { rows: [{ id: "n1", productName: "Чай" }] });
  assert.deepEqual(twice, {
    rows: [{ id: "a", productName: "Суп" }, { productName: "Каша" }, { id: "n1", productName: "Чай" }],
  });
});

test("записи дезсредств и отчёта аудита сливаются так же", () => {
  const next = mergeConfigPatch(
    { receipts: [{ id: "r1", quantity: 1 }], consumptions: [{ id: "c1" }], findings: [{ id: "f1", nonConformity: "x" }] },
    { receipts: [{ id: "r2", quantity: 2 }], consumptions: [{ id: "c1", balance: 3 }], findings: [{ id: "f2" }] }
  );
  assert.deepEqual(next, {
    receipts: [{ id: "r1", quantity: 1 }, { id: "r2", quantity: 2 }],
    consumptions: [{ id: "c1", balance: 3 }],
    findings: [{ id: "f1", nonConformity: "x" }, { id: "f2" }],
  });
});

test("остальные ключи и appendX — как раньше", () => {
  const next = mergeConfigPatch(
    { year: 2025, commissionMembers: [{ employeeName: "А" }], rows: [{ id: "a" }], notes: ["x"] },
    { year: 2026, commissionMembers: [{ employeeName: "Б" }], appendNotes: ["y"], appendRows: { id: "z" } }
  );
  assert.deepEqual(next, {
    year: 2026,
    commissionMembers: [{ employeeName: "Б" }],
    rows: [{ id: "a" }, { id: "z" }],
    notes: ["x", "y"],
  });
});

test("пустой или не-объектный конфиг: патч как есть", () => {
  assert.deepEqual(mergeConfigPatch(null, { rows: [{ id: "a" }] }), { rows: [{ id: "a" }] });
  assert.deepEqual(mergeConfigPatch({ rows: "мусор" }, { rows: [{ id: "a" }] }), { rows: [{ id: "a" }] });
  assert.equal(mergeConfigPatch({ rows: [] }, "x"), "x");
});
