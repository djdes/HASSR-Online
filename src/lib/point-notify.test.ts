import assert from "node:assert/strict";
import { test } from "node:test";

import { groupByPoint, liveEventPoint, pointHeading } from "./point-notify";

test("точка события: только точка организации при включённых точках", () => {
  assert.equal(liveEventPoint("b-a", ["b-a", "b-b"]), "b-a");
  // Удалённая точка или точки выключены — общее событие.
  assert.equal(liveEventPoint("b-gone", ["b-a", "b-b"]), null);
  assert.equal(liveEventPoint("b-a", [null]), null);
  assert.equal(liveEventPoint(null, ["b-a", "b-b"]), null);
});

test("сводка крона раскладывается по точкам в порядке появления", () => {
  const items = [
    { name: "молоко", point: "b-a" },
    { name: "сыр", point: "b-b" },
    { name: "масло", point: null },
    { name: "кефир", point: "b-a" },
  ];
  const groups = groupByPoint(items, (item) => item.point);
  assert.deepEqual([...groups.keys()], ["b-a", "b-b", null]);
  assert.deepEqual(groups.get("b-a")?.map((item) => item.name), ["молоко", "кефир"]);
  assert.deepEqual(groups.get(null)?.map((item) => item.name), ["масло"]);
});

test("строка точки в сообщении", () => {
  assert.equal(pointHeading("Точка 1"), "Точка: Точка 1\n");
  assert.equal(pointHeading(null), "");
});
