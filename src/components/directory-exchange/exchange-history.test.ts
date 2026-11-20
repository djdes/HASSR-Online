import assert from "node:assert/strict";
import test from "node:test";

import { parseExchangeHistory, parseHistoryUndo, withChangeUndone } from "@/components/directory-exchange/exchange-api";

/* Разбор ответов «Истории обмена» (серия D, Р5) для карточки «Обмен справочниками». */

test("history: tolerant parsing, rows without id, entity, list or op are dropped, undone rows are never undoable", () => {
  const items = parseExchangeHistory({
    changes: [
      {
        id: "c1",
        createdAt: "2026-11-20T10:00:00.000Z",
        entity: "product",
        kind: "products",
        op: "update",
        name: "Молоко",
        from: { name: "Кафе на Ленина", cabinet: false, foreign: false },
        undoneAt: null,
        undoable: true,
      },
      {
        id: "c2",
        createdAt: "2026-11-19T10:00:00.000Z",
        entity: "journal_settings",
        kind: "journals",
        op: "update",
        name: "",
        from: { name: "Мастер-кабинет", cabinet: true, foreign: true },
        undoneAt: "2026-11-20T09:00:00.000Z",
        undoable: true,
      },
      { id: "c3", entity: "spaceship", kind: "products", op: "create" },
      { id: "c4", entity: "product", kind: "products", op: "delete" },
      { id: "c5", entity: "product", kind: "nope", op: "create" },
      { entity: "product", kind: "products", op: "create" },
      { id: "c6", entity: "staff", kind: "staff", op: "create", from: "x" },
      "garbage",
    ],
  });
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], {
    id: "c1",
    createdAt: "2026-11-20T10:00:00.000Z",
    entity: "product",
    kind: "products",
    op: "update",
    name: "Молоко",
    from: { name: "Кафе на Ленина", cabinet: false, foreign: false },
    undoneAt: null,
    undoable: true,
  });
  assert.deepEqual([items[1].undoable, items[1].from], [false, { name: "Мастер-кабинет", cabinet: true, foreign: true }]);
  assert.deepEqual([items[2].id, items[2].createdAt, items[2].undoable, items[2].from], ["c6", null, false, { name: "", cabinet: false, foreign: false }]);
  assert.deepEqual(parseExchangeHistory(null), []);
  assert.deepEqual(parseExchangeHistory({ changes: "x" }), []);
});

test("undo answer: done with an action, kept with a reason, anything else is an error", () => {
  assert.deepEqual(parseHistoryUndo({ ok: true, json: { ok: true, result: { op: "update", action: "restored" } } }), {
    kind: "done",
    op: "update",
    action: "restored",
  });
  assert.deepEqual(parseHistoryUndo({ ok: true, json: { result: { op: "create", action: "none" } } }), { kind: "done", op: "create", action: "none" });
  assert.deepEqual(parseHistoryUndo({ ok: false, json: { error: "…", code: "change_kept", reason: "used" } }), { kind: "kept", reason: "used" });
  assert.equal(parseHistoryUndo({ ok: false, json: { error: "…", code: "change_kept", reason: "bored" } }), null);
  assert.equal(parseHistoryUndo({ ok: false, json: { error: "Это изменение уже отменено", code: "change_undone" } }), null);
  assert.equal(parseHistoryUndo({ ok: true, json: { result: { op: "create", action: "burnt" } } }), null);
  assert.equal(parseHistoryUndo({ ok: true, json: null }), null);
});

test("after undo the row shows «undone» at once", () => {
  const items = parseExchangeHistory({
    changes: [
      { id: "c1", entity: "product", kind: "products", op: "create", undoable: true },
      { id: "c2", entity: "room", kind: "objects", op: "update", undoable: true },
    ],
  });
  const next = withChangeUndone(items, "c1", "2026-11-20T12:00:00.000Z");
  assert.deepEqual([next[0].undoable, next[0].undoneAt], [false, "2026-11-20T12:00:00.000Z"]);
  assert.deepEqual(next[1], items[1]);
});
