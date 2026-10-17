import test from "node:test";
import assert from "node:assert/strict";

import { POSTERS, type PosterKey } from "./posters";

test("шесть плакатов с известными ключами", () => {
  assert.deepEqual(
    POSTERS.map((poster) => poster.key),
    ["hand-washing", "hygiene", "board-marking", "storage", "eggs", "dishes"] satisfies PosterKey[],
  );
});

test("у каждого плаката заголовок и не меньше четырёх пунктов (строки таблицы тоже пункты)", () => {
  for (const poster of POSTERS) {
    assert.ok(poster.title.trim().length > 0, poster.key);
    const points = poster.items.length + (poster.table?.rows.length ?? 0);
    assert.ok(points >= 4, `${poster.key}: ${points}`);
    for (const item of poster.items) assert.ok(item.trim().length > 0, poster.key);
  }
});

test("мытьё рук и обработка яиц нумерованы, гигиена и хранение — нет", () => {
  const byKey = Object.fromEntries(POSTERS.map((poster) => [poster.key, poster]));
  assert.equal(byKey["hand-washing"].numbered, true);
  assert.equal(byKey["hand-washing"].items.length, 8);
  assert.equal(byKey.eggs.numbered, true);
  assert.equal(byKey.dishes.numbered, true);
  assert.equal(byKey.hygiene.numbered, false);
  assert.equal(byKey.storage.numbered, false);
});

test("маркировка разделочного инвентаря: таблица из десяти строк по три колонки", () => {
  const board = POSTERS.find((poster) => poster.key === "board-marking");
  assert.ok(board?.table);
  assert.deepEqual(board.table.head, ["Маркировка", "Для чего", "Цвет (если цветная)"]);
  assert.equal(board.table.rows.length, 10);
  assert.deepEqual(board.table.rows[0], ["СМ", "Сырое мясо", "красный"]);
  for (const row of board.table.rows) assert.equal(row.length, 3);
});
