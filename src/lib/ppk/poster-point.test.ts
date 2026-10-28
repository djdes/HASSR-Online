import test from "node:test";
import assert from "node:assert/strict";

import { buildingLabel } from "@/lib/building-scope";
import { posterPointLine, posterPointParam, posterPoints, resolvePosterPoint } from "./poster-point";

test("строка точки — как подпись точки в шапке журналов", () => {
  const cases = [
    { name: "Пищеблок СОШ № 5", address: "г. Казань, ул. Ленина, 5", journalName: null },
    { name: "Кафе на Мира", address: null, journalName: "" },
    { name: "Гимназия", address: "пр. Победы, 100", journalName: "МАУ «КП «ДК», пищеблок гимназии № 112" },
  ];
  for (const point of cases) {
    const line = posterPointLine(point);
    assert.ok(line);
    assert.equal([line.title, line.detail].filter(Boolean).join(", "), buildingLabel(point));
  }
});

test("наименование для журналов — одной строкой, без адреса", () => {
  assert.deepEqual(
    posterPointLine({ name: "Гимназия", address: "пр. Победы, 100", journalName: "  МАУ «КП «ДК»,   пищеблок  " }),
    { title: "МАУ «КП «ДК», пищеблок", detail: null },
  );
});

test("название и адрес раздельно; без названия — адрес; пусто — null", () => {
  assert.deepEqual(posterPointLine({ name: "Пищеблок СОШ № 5", address: "ул. Ленина, 5" }), {
    title: "Пищеблок СОШ № 5",
    detail: "ул. Ленина, 5",
  });
  assert.deepEqual(posterPointLine({ name: "Кафе на Мира", address: "  " }), { title: "Кафе на Мира", detail: null });
  assert.deepEqual(posterPointLine({ name: " ", address: "ул. Садовая, 7" }), { title: "ул. Садовая, 7", detail: null });
  assert.equal(posterPointLine({ name: "", address: null }), null);
  assert.equal(posterPointLine(null), null);
});

test("офис — не торговая точка", () => {
  const points = posterPoints([
    { id: "office", kind: "office" },
    { id: "a", kind: "point" },
    { id: "b" },
  ]);
  assert.deepEqual(
    points.map((point) => point.id),
    ["a", "b"],
  );
});

test("точка печати: запрошенная → из шапки → первая", () => {
  const points = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(resolvePosterPoint(points, "c", "b")?.id, "c");
  assert.equal(resolvePosterPoint(points, "чужая", "b")?.id, "b");
  assert.equal(resolvePosterPoint(points, null, "офис")?.id, "a");
  assert.equal(resolvePosterPoint(points, undefined, undefined)?.id, "a");
  assert.equal(resolvePosterPoint([], "a", "a"), null);
});

test("параметр ?point=", () => {
  assert.equal(posterPointParam(" b-1 "), "b-1");
  assert.equal(posterPointParam(["b-2", "b-3"]), "b-2");
  assert.equal(posterPointParam(""), null);
  assert.equal(posterPointParam(undefined), null);
});
