import assert from "node:assert/strict";
import test from "node:test";

import { droppedSlotIds, parseSlotMaps, resolvePointSlots, withoutUser } from "./journal-responsibles-points";

// Владелец, 2026-10-31: «ответственные по точкам». Выбор ответственного за
// уборку на всю организацию раньше ставил одного человека во все точки.
const worksAtA = (userId: string) => ["anna", "vera"].includes(userId);

test("журнал без своих ответственных точки — организации, но только люди этой точки", () => {
  const { slots, ownCodes } = resolvePointSlots({
    orgSlots: { cleaning: { supervisor: "anna", controller: "boris" }, hygiene: { main: "vera" } },
    pointSlots: null,
    worksAtPoint: worksAtA,
  });
  assert.deepEqual(slots.cleaning, { supervisor: "anna", controller: null });
  assert.deepEqual(slots.hygiene, { main: "vera" });
  assert.equal(ownCodes.size, 0);
});

test("свои ответственные точки по журналу важнее организации; остальные журналы — как у организации", () => {
  const { slots, ownCodes } = resolvePointSlots({
    orgSlots: { cleaning: { supervisor: "boris" }, hygiene: { main: "vera" } },
    pointSlots: { cleaning: { supervisor: "anna", controller: null } },
    worksAtPoint: worksAtA,
  });
  assert.deepEqual(slots.cleaning, { supervisor: "anna", controller: null });
  assert.deepEqual(slots.hygiene, { main: "vera" });
  assert.deepEqual([...ownCodes], ["cleaning"]);
});

test("человек из своих ответственных точки ушёл на другую точку — слот пустой", () => {
  const { slots } = resolvePointSlots({
    orgSlots: {},
    pointSlots: { hygiene: { main: "boris" } },
    worksAtPoint: worksAtA,
  });
  assert.deepEqual(slots.hygiene, { main: null });
});

test("опустевшие для точки слоты — те, что были заданы", () => {
  assert.deepEqual(droppedSlotIds({ main: "boris", _verifier: "anna", extra: null }, { main: null, _verifier: "anna", extra: null }), ["main"]);
  assert.deepEqual(droppedSlotIds(undefined, { main: "anna" }), []);
});

test("разбор карты из JSON: мусор отбрасывается, пустые строки — null", () => {
  assert.deepEqual(parseSlotMaps({ hygiene: { main: "u1", _verifier: "" }, bad: "x", list: [1], cold: { main: 5 } }), {
    hygiene: { main: "u1", _verifier: null },
    cold: { main: null },
  });
  assert.deepEqual(parseSlotMaps(null), {});
  assert.deepEqual(parseSlotMaps([]), {});
});

test("архив сотрудника снимает его со всех слотов карты", () => {
  const { maps, changed } = withoutUser({ hygiene: { main: "u1" }, cleaning: { supervisor: "u2", controller: "u1" } }, "u1");
  assert.equal(changed, true);
  assert.deepEqual(maps, { hygiene: { main: null }, cleaning: { supervisor: "u2", controller: null } });
  assert.equal(withoutUser({ hygiene: { main: "u2" } }, "u1").changed, false);
});
