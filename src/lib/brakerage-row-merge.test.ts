import assert from "node:assert/strict";
import test from "node:test";

import { mergeBrakerageConfig, mergeBrakerageRows, parseKnownRowIds } from "./brakerage-row-merge";

const sig = [{ userId: "u1", name: "Иванова", signedAt: "2026-09-21T09:00:00Z" }];

test("строка, добавленная по QR после загрузки страницы, не теряется", () => {
  const rows = mergeBrakerageRows({
    incoming: [{ id: "a", productName: "Суп (правка)" }],
    current: [{ id: "a", productName: "Суп" }, { id: "qr1", productName: "Каша" }],
    knownRowIds: new Set(["a"]),
  });
  assert.deepEqual(rows.map((row) => row.id), ["a", "qr1"]);
  assert.equal(rows[0].productName, "Суп (правка)");
});

test("строка, которую клиент видел и не прислал, удалена", () => {
  const rows = mergeBrakerageRows({
    incoming: [{ id: "a" }],
    current: [{ id: "a" }, { id: "b" }],
    knownRowIds: new Set(["a", "b"]),
  });
  assert.deepEqual(rows.map((row) => row.id), ["a"]);
});

test("подписи берутся из базы: клиент их не стирает и не подделывает", () => {
  const rows = mergeBrakerageRows({
    incoming: [
      { id: "a", signatures: [] },
      { id: "b", signatures: [{ userId: "fake" }] },
    ],
    current: [{ id: "a", signatures: sig }, { id: "b" }],
    knownRowIds: new Set(["a", "b"]),
  });
  assert.deepEqual(rows[0].signatures, sig);
  assert.equal(rows[1].signatures, undefined);
});

test("без knownRowIds строки клиента заменяют базу, но серверные поля защищены", () => {
  const rows = mergeBrakerageRows({
    incoming: [{ id: "a" }],
    current: [{ id: "a", signatures: sig, sourceRowKey: "employee-1#qr-1" }, { id: "b" }],
    knownRowIds: null,
  });
  assert.deepEqual(rows.map((row) => row.id), ["a"]);
  assert.deepEqual(rows[0].signatures, sig);
  assert.equal(rows[0].sourceRowKey, "employee-1#qr-1");
});

test("конфиг без rows не трогаем; мусор в knownRowIds отбрасываем", () => {
  assert.deepEqual(mergeBrakerageConfig({ incoming: { columns: {} }, current: { rows: [{ id: "a" }] }, knownRowIds: null }), { columns: {} });
  assert.deepEqual([...(parseKnownRowIds(["a", 1, "", null]) ?? [])], ["a"]);
  assert.equal(parseKnownRowIds("a"), null);
});

/**
 * Состав комиссии — серверный ключ: его пишет только окно «Комиссия»
 * (прямо в базу). Вкладка сайта, открытая до смены состава, при
 * автосохранении возвращала старый список — и члена комиссии по QR
 * переставали узнавать.
 */
const members = [{ id: "commission-u1", role: "Председатель", employeeId: "u1", employeeName: "Иванова" }];

test("состав комиссии берётся из базы, а не из устаревшей вкладки (со строками)", () => {
  const merged = mergeBrakerageConfig({
    incoming: { rows: [{ id: "a" }], commissionMembers: [] },
    current: { rows: [{ id: "a" }], commissionMembers: members },
    knownRowIds: new Set(["a"]),
  });
  assert.deepEqual(merged.commissionMembers, members);
});

test("состав комиссии берётся из базы и в конфиге без rows", () => {
  const merged = mergeBrakerageConfig({
    incoming: { columns: {}, commissionMembers: [] },
    current: { commissionMembers: members },
    knownRowIds: null,
  });
  assert.deepEqual(merged.commissionMembers, members);
  assert.deepEqual(merged.columns, {});
});

test("клиент не может дописать состав комиссии, которого нет в базе", () => {
  const merged = mergeBrakerageConfig({
    incoming: { rows: [], commissionMembers: members },
    current: { rows: [] },
    knownRowIds: null,
  });
  assert.equal("commissionMembers" in merged, false);
});
