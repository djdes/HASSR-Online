import assert from "node:assert/strict";
import test from "node:test";

import {
  parseRecentTransfers,
  parseTransferUndo,
  transferCreatedTotal,
  withTransferUndone,
} from "@/components/directory-exchange/exchange-api";

/* Разбор ответов «Последние переносы» (серия B, пункт 12) для карточки «Обмен справочниками». */

const RESULT = {
  undone: [
    { entity: "product", id: "p1", name: "Молоко", action: "deactivated" },
    { entity: "staff", id: "s1", name: "Петрова Анна", action: "archived" },
    { entity: "spaceship", id: "x", name: "?", action: "deleted" },
    { entity: "equipment", id: "e1", name: "Плита", action: "burnt" },
  ],
  kept: [
    { entity: "equipment", id: "e2", name: "Холодильник", reason: "used" },
    { entity: "building", id: "b1", name: "Кафе", reason: "not_empty" },
    { entity: "room", id: "", name: "Без id", reason: "linked" },
    { entity: "area", id: "a1", name: "Склад", reason: "bored" },
  ],
};

test("undo result: rows without a known entity, id, action or reason are dropped", () => {
  assert.deepEqual(parseTransferUndo(RESULT), {
    undone: [
      { entity: "product", id: "p1", name: "Молоко", action: "deactivated" },
      { entity: "staff", id: "s1", name: "Петрова Анна", action: "archived" },
    ],
    kept: [
      { entity: "equipment", id: "e2", name: "Холодильник", reason: "used" },
      { entity: "building", id: "b1", name: "Кафе", reason: "not_empty" },
    ],
  });
  assert.equal(parseTransferUndo(null), null);
  assert.equal(parseTransferUndo("x"), null);
  assert.deepEqual(parseTransferUndo({}), { undone: [], kept: [] });
});

test("recent transfers: tolerant parsing, an undone transfer is never undoable", () => {
  const transfers = parseRecentTransfers({
    transfers: [
      {
        id: "t1",
        createdAt: "2026-11-20T10:00:00.000Z",
        from: { name: "Кафе на Ленина", foreign: false },
        to: { id: "o2", name: "Кафе на Мира" },
        counts: { products: 3, staff: 2, objects: -1, equipment: "x" },
        undoUntil: "2026-11-27T10:00:00.000Z",
        undoable: true,
        undoneAt: null,
        undo: null,
      },
      {
        id: "t2",
        createdAt: "2026-11-19T10:00:00.000Z",
        from: { name: "", foreign: true },
        to: { id: "o2", name: "Кафе на Мира" },
        counts: { products: 1 },
        undoable: true,
        undoneAt: "2026-11-20T09:00:00.000Z",
        undo: RESULT,
      },
      {
        id: "t3",
        createdAt: "2026-11-19T11:00:00.000Z",
        from: { name: "Кафе на Ленина", foreign: false },
        to: { id: "o2", name: "Кафе на Мира" },
        counts: { checklists: 2 },
        fixedKinds: ["journals", "nope"],
        onlyFixed: false,
        undoable: true,
        undoneAt: null,
        undo: null,
      },
      {
        id: "t4",
        from: { name: "Кафе на Ленина", foreign: false },
        to: { id: "o2", name: "Кафе на Мира" },
        counts: {},
        fixedKinds: ["journals"],
        onlyFixed: true,
        undoable: false,
      },
      { createdAt: "2026-11-19T10:00:00.000Z" },
      "garbage",
    ],
  });
  assert.equal(transfers.length, 4);
  assert.deepEqual(transfers[0], {
    id: "t1",
    createdAt: "2026-11-20T10:00:00.000Z",
    from: { name: "Кафе на Ленина", foreign: false },
    to: { id: "o2", name: "Кафе на Мира" },
    counts: { products: 3, staff: 2, objects: 0, equipment: 0, journals: 0, checklists: 0 },
    fixedKinds: [],
    replacedKinds: [],
    onlyFixed: false,
    undoUntil: "2026-11-27T10:00:00.000Z",
    undoable: true,
    undoneAt: null,
    undo: null,
  });
  assert.equal(transferCreatedTotal(transfers[0]), 5);
  assert.equal(transfers[1].undoable, false);
  assert.deepEqual(transfers[1].from, { name: "", foreign: true });
  assert.equal(transfers[1].undo?.undone.length, 2);
  // Р8.1: замена настроек журналов — отдельной пометкой, без отмены.
  assert.deepEqual(transfers[2].fixedKinds, ["journals"]);
  assert.equal(transferCreatedTotal(transfers[2]), 2);
  assert.equal(transfers[2].undoable, true);
  assert.deepEqual([transfers[3].onlyFixed, transfers[3].undoable, transfers[3].fixedKinds], [true, false, ["journals"]]);
  const kept = parseTransferUndo({ undone: [], kept: [{ entity: "journal_settings", id: "o2", name: "", reason: "not_undoable" }] });
  assert.deepEqual(kept?.kept, [{ entity: "journal_settings", id: "o2", name: "", reason: "not_undoable" }]);
  assert.deepEqual(parseRecentTransfers(null), []);
  assert.deepEqual(parseRecentTransfers({ transfers: "x" }), []);
});

test("Р10: journal settings replaced with a snapshot are listed as replaced (undoable), the result can say «restored»", () => {
  const [transfer] = parseRecentTransfers({
    transfers: [
      {
        id: "t5",
        from: { name: "Кафе на Ленина", foreign: false },
        to: { id: "o2", name: "Кафе на Мира" },
        counts: {},
        fixedKinds: [],
        replacedKinds: ["journals", "nope"],
        onlyFixed: false,
        undoable: true,
      },
    ],
  });
  assert.deepEqual([transfer.replacedKinds, transfer.fixedKinds, transfer.onlyFixed, transfer.undoable], [["journals"], [], false, true]);
  assert.deepEqual(parseTransferUndo({ undone: [{ entity: "journal_settings", id: "o2", name: "", action: "restored" }], kept: [] })?.undone, [
    { entity: "journal_settings", id: "o2", name: "", action: "restored" },
  ]);
  // Ответ без поля (старый сервер) — пусто.
  assert.deepEqual(parseRecentTransfers({ transfers: [{ id: "t6", counts: {}, from: {}, to: {} }] })[0].replacedKinds, []);
});

test("after undo the transfer shows its result at once", () => {
  const [first, second] = parseRecentTransfers({
    transfers: [
      { id: "t1", undoable: true, counts: {}, from: {}, to: {} },
      { id: "t2", undoable: true, counts: {}, from: {}, to: {} },
    ],
  });
  const result = parseTransferUndo(RESULT)!;
  const next = withTransferUndone([first, second], "t1", result, "2026-11-20T12:00:00.000Z");
  assert.equal(next[0].undoable, false);
  assert.equal(next[0].undoneAt, "2026-11-20T12:00:00.000Z");
  assert.deepEqual(next[0].undo, result);
  assert.deepEqual(next[1], second);
});
