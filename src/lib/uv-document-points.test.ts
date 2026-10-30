import assert from "node:assert/strict";
import test from "node:test";

import { uvDocumentPointFixes } from "./uv-document-points";

// Владелец, 2026-10-30: «УФ установки из 4 гимназии теперь у всех ТТ».
const targets = ["gym4", "odin"];
const lamps = [
  { id: "l1", name: "Рециркулятор \"Гелиос\" №1", pointId: "gym4" },
  { id: "l2", name: "Рециркулятор \"Гелиос\" №2", pointId: "gym4" },
  { id: "shared", name: "Лампа в общем цехе", pointId: null },
];
const doc = (id: string, buildingId: string | null, config: Record<string, unknown>, status = "active") => ({
  id,
  status,
  buildingId,
  config,
});

test("документ лампы без точки уходит на точку цеха лампы", () => {
  assert.deepEqual(uvDocumentPointFixes([doc("d1", null, { equipmentId: "l1" })], lamps, targets), [
    { id: "d1", buildingId: "gym4" },
  ]);
});

test("закрытый документ без точки или на удалённой точке — тоже", () => {
  assert.deepEqual(
    uvDocumentPointFixes(
      [doc("d1", null, { equipmentId: "l1" }, "closed"), doc("d2", "deleted", { equipmentId: "l2" }, "closed")],
      lamps,
      targets,
    ),
    [
      { id: "d1", buildingId: "gym4" },
      { id: "d2", buildingId: "gym4" },
    ],
  );
});

test("активный документ лампы на чужой точке переезжает, закрытый на живой точке — история, не трогаем", () => {
  assert.deepEqual(
    uvDocumentPointFixes(
      [doc("a", "odin", { equipmentId: "l1" }), doc("c", "odin", { equipmentId: "l1" }, "closed")],
      lamps,
      targets,
    ),
    [{ id: "a", buildingId: "gym4" }],
  );
});

test("старый документ без связи — по номеру, равному названию одной лампы", () => {
  assert.deepEqual(
    uvDocumentPointFixes([doc("d1", null, { lampNumber: "  рециркулятор \"гелиос\"   №2 " })], lamps, targets),
    [{ id: "d1", buildingId: "gym4" }],
  );
});

test("не трогаем: уже на своей точке, лампа в общем цехе, удалённая лампа, номер без лампы, две лампы с одним названием", () => {
  const twins = [...lamps, { id: "l1b", name: "Рециркулятор \"Гелиос\" №1", pointId: "odin" }];
  assert.deepEqual(
    uvDocumentPointFixes(
      [
        doc("own", "gym4", { equipmentId: "l1" }),
        doc("shared", null, { equipmentId: "shared" }),
        doc("gone", null, { equipmentId: "deleted-lamp" }),
        doc("manual", null, { lampNumber: "1" }),
        doc("twin", null, { lampNumber: "Рециркулятор \"Гелиос\" №1" }),
      ],
      twins,
      targets,
    ),
    [],
  );
});

test("точки выключены — ничего не переносим", () => {
  assert.deepEqual(uvDocumentPointFixes([doc("d1", null, { equipmentId: "l1" })], lamps, [null]), []);
});
