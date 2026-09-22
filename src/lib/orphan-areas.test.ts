import assert from "node:assert/strict";
import test from "node:test";

import { guessRoomKind, normalizePlaceName, orphanAreas } from "./orphan-areas";

test("normalizePlaceName: регистр, ё→е, пробелы", () => {
  assert.equal(normalizePlaceName("  Основное   Производство "), "основное производство");
  assert.equal(normalizePlaceName("Съёмная"), "съемная");
});

test("orphanAreas: цеха без помещения с тем же названием", () => {
  const areas = [
    { id: "a1", name: "Основное производство" },
    { id: "a2", name: "Горячий цех" },
    { id: "a3", name: "Моечная  тёмная" },
  ];
  const rooms = ["горячий ЦЕХ", "Моечная темная"];
  assert.deepEqual(
    orphanAreas(areas, rooms).map((a) => a.id),
    ["a1"],
  );
});

test("orphanAreas: без помещений — все цеха", () => {
  const areas = [{ id: "a1", name: "Цех" }];
  assert.deepEqual(orphanAreas(areas, []), areas);
});

test("orphanAreas: пустое имя цеха пропускаем", () => {
  assert.deepEqual(orphanAreas([{ id: "a1", name: "   " }], []), []);
});

test("guessRoomKind", () => {
  assert.equal(guessRoomKind("Сухой склад"), "storage");
  assert.equal(guessRoomKind("Бар"), "bar");
  assert.equal(guessRoomKind("Мойка кухонной посуды"), "wash");
  assert.equal(guessRoomKind("Моечная"), "wash");
  assert.equal(guessRoomKind("Гостевой зал"), "guest");
  assert.equal(guessRoomKind("Горячий цех"), "kitchen");
  assert.equal(guessRoomKind("Кухня"), "kitchen");
  assert.equal(guessRoomKind("Основное производство"), "kitchen");
  assert.equal(guessRoomKind("Заготовочная"), "kitchen");
  assert.equal(guessRoomKind("Коридор"), "other");
});
