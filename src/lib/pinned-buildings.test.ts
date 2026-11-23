import assert from "node:assert/strict";
import test from "node:test";

import { nextPinned, parsePinRequest, sortPinnedFirst } from "@/lib/pinned-buildings";

const list = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

test("закреплённые объекты — первыми, в порядке закрепления; остальные — как были", () => {
  assert.deepEqual(sortPinnedFirst(list, ["c"]).map((item) => item.id), ["c", "a", "b", "d"]);
  assert.deepEqual(sortPinnedFirst(list, ["d", "b"]).map((item) => item.id), ["d", "b", "a", "c"]);
  // Ничего не закреплено или закреплён чужой/удалённый объект — порядок не меняется.
  assert.deepEqual(sortPinnedFirst(list, []).map((item) => item.id), ["a", "b", "c", "d"]);
  assert.deepEqual(sortPinnedFirst(list, ["gone"]).map((item) => item.id), ["a", "b", "c", "d"]);
  // Исходный список не меняется.
  assert.deepEqual(list.map((item) => item.id), ["a", "b", "c", "d"]);
});

test("закрепить и открепить — без дублей, закреплённый встаёт в конец закреплённых", () => {
  assert.deepEqual(nextPinned([], "a", true), ["a"]);
  assert.deepEqual(nextPinned(["a"], "b", true), ["a", "b"]);
  assert.deepEqual(nextPinned(["a", "b"], "a", true), ["a", "b"]);
  assert.deepEqual(nextPinned(["a", "b"], "a", false), ["b"]);
  assert.deepEqual(nextPinned(["a"], "zzz", false), ["a"]);
  // Не больше 50 закреплённых: старые уходят первыми.
  const many = Array.from({ length: 50 }, (_, index) => `p${index}`);
  const next = nextPinned(many, "new", true);
  assert.equal(next.length, 50);
  assert.equal(next[49], "new");
  assert.equal(next[0], "p1");
});

test("запрос закрепления: id объекта и признак, остальное — ошибка", () => {
  assert.deepEqual(parsePinRequest({ buildingId: "b1", pinned: true }), { buildingId: "b1", pinned: true });
  assert.deepEqual(parsePinRequest({ buildingId: "b1", pinned: false }), { buildingId: "b1", pinned: false });
  assert.equal(parsePinRequest({ buildingId: "", pinned: true }), null);
  assert.equal(parsePinRequest({ buildingId: "b1" }), null);
  assert.equal(parsePinRequest({ buildingId: 5, pinned: true }), null);
  assert.equal(parsePinRequest(null), null);
  assert.equal(parsePinRequest({ buildingId: "x".repeat(200), pinned: true }), null);
});
