import assert from "node:assert/strict";
import test from "node:test";

import { documentReferencedUserIds } from "./document-point-rows";
import { configRoomIds, scopeDirectoryBuildings, type DirectoryBuilding } from "./room-directory";

// Владелец, 2026-10-31: «проверь похожие проблемы в других местах» — списки
// выбора в журналах точки предлагали людей и помещения всех точек.

test("документ ссылается на людей: employeeId записей, id и ФИО в конфиге и данных", () => {
  const users = [
    { id: "u-anna", name: "Анна Иванова" },
    { id: "u-boris", name: "Борис Петров" },
    { id: "u-vera", name: "Вера Смирнова" },
    { id: "u-gleb", name: "Глеб Орлов" },
    { id: "u-dina", name: "Дина Ким" },
  ];
  const referenced = documentReferencedUserIds(
    users,
    [
      { responsibleUserId: "u-boris", commission: [{ name: " Вера Смирнова " }] },
      null,
      { rows: [{ employeeName: "нет такого" }] },
    ],
    ["u-gleb", null],
  );
  assert.deepEqual([...referenced].sort(), ["u-boris", "u-gleb", "u-vera"]);
});

function building(id: string, roomIds: string[]): DirectoryBuilding {
  return {
    id,
    name: id,
    rooms: roomIds.map((roomId) => ({
      id: roomId,
      name: roomId,
      kind: "other",
      detergent: "",
      currentScope: [],
      generalScope: [],
      currentDays: 0,
      generalDays: 0,
      currentScheduleType: "weekly" as const,
      generalScheduleType: "weekly" as const,
      currentMonthDays: [],
      generalMonthDays: [],
      requirePhoto: false,
      cleanerUserIds: [],
      verifierUserIds: [],
      climateNorms: null,
    })),
  };
}

test("справочник помещений документа точки: её точка первой, у других — только уже связанные помещения", () => {
  const buildings = [building("B", ["b-1", "b-2"]), building("A", ["a-1"]), building("C", ["c-1"])];
  const scoped = scopeDirectoryBuildings(buildings, "A", new Set(["b-2"]));
  assert.deepEqual(
    scoped.map((item) => [item.id, item.rooms.map((room) => room.id)]),
    [
      ["A", ["a-1"]],
      ["B", ["b-2"]],
    ],
  );
  // Без точки — как есть.
  assert.equal(scopeDirectoryBuildings(buildings, null, new Set()).length, 3);
});

test("помещения строк конфига", () => {
  assert.deepEqual([...configRoomIds({ rows: [{ roomId: "r1" }, { roomName: "ручная" }, { roomId: "" }, null] }, "rows")], ["r1"]);
  assert.equal(configRoomIds(null, "rooms").size, 0);
});
