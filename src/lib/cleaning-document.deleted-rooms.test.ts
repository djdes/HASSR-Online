import assert from "node:assert/strict";
import test from "node:test";

import {
  listDeletedCleaningRoomsWithMarks,
  normalizeCleaningDocumentConfig,
} from "./cleaning-document";

/**
 * Удаление помещения из справочника оставляет отметки уборки в
 * `config.matrix[roomId]`. Отметки — данные ХАССП: молча стирать их
 * нельзя, но и строка не должна исчезать с экрана и из печати.
 */
function config(patch: Record<string, unknown>) {
  return normalizeCleaningDocumentConfig(
    {
      cleaningMode: "rooms",
      rooms: [],
      selectedRoomIds: ["room-alive", "room-gone", "room-gone-empty"],
      ...patch,
    },
    { users: [] }
  );
}

test("удалённое помещение с отметками остаётся строкой с пометкой", () => {
  const cfg = config({
    matrix: {
      "room-alive": { "2026-09-18": "T" },
      "room-gone": { "2026-09-17": "G" },
    },
  });
  const deleted = listDeletedCleaningRoomsWithMarks(cfg, ["room-alive"]);
  assert.deepEqual(
    deleted.map((item) => item.id),
    ["room-gone"]
  );
  assert.match(deleted[0].name, /помещение удалено/);
  // Отметки нормализация не трогает.
  assert.equal(cfg.matrix["room-gone"]["2026-09-17"], "G");
});

test("имя берём из снимка в конфиге, если он есть", () => {
  const cfg = config({
    rooms: [{ id: "room-gone", name: "Холодный цех" }],
    matrix: { "room-gone": { "2026-09-17": "T" } },
  });
  const deleted = listDeletedCleaningRoomsWithMarks(cfg, []);
  assert.equal(deleted[0].name, "Холодный цех (помещение удалено)");
});

test("удалённое помещение без отметок в списке не появляется", () => {
  const cfg = config({
    matrix: {
      "room-alive": { "2026-09-18": "T" },
      "room-gone-empty": { "2026-09-18": "" },
    },
  });
  assert.deepEqual(listDeletedCleaningRoomsWithMarks(cfg, ["room-alive"]), []);
});

test("живое помещение в список удалённых не попадает", () => {
  const cfg = config({ matrix: { "room-alive": { "2026-09-18": "T" } } });
  assert.deepEqual(
    listDeletedCleaningRoomsWithMarks(cfg, [
      "room-alive",
      "room-gone",
      "room-gone-empty",
    ]),
    []
  );
});
