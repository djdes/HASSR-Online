import assert from "node:assert/strict";
import test from "node:test";

import { journalPointsOf, orgObjectsInPool, poolCodeOfObject, wholeOrgPoints } from "@/lib/master-pool-points";

const buildings = [
  { id: "school5", name: "Школа № 5", kind: "point", linkedServiceCode: null },
  { id: "office", name: "Офис", kind: "office", linkedServiceCode: null },
  { id: "school7", name: "Школа № 7", kind: "point", linkedServiceCode: "GARDN-00000" },
  { id: "school9", name: "Школа № 9", kind: "point", linkedServiceCode: "SCHOL-00000" },
];

test("точки со своими журналами: только торговые точки и только при журналах по точкам", () => {
  assert.deepEqual(journalPointsOf({ perLocationJournals: true }, buildings).map((b) => b.id), ["school5", "school7", "school9"]);
  assert.deepEqual(journalPointsOf({ perLocationJournals: false }, buildings), []);
});

test("организация целиком в кабинете — её точки, кроме подключённых к другому кабинету", () => {
  assert.deepEqual(
    wholeOrgPoints({ perLocationJournals: true }, buildings, "SCHOL-00000").map((b) => b.id),
    ["school5", "school9"]
  );
  assert.deepEqual(wholeOrgPoints({ perLocationJournals: false }, buildings, "SCHOL-00000"), []);
});

const ids = (objects: Array<{ building: { id: string } | null }>) => objects.map((object) => object.building?.id ?? "org");

test("объекты организации в кабинете: точки своим кодом", () => {
  const org = { perLocationJournals: true, serviceCode: "OWNCD-00000", linkedServiceCode: null };
  assert.deepEqual(ids(orgObjectsInPool(org, buildings, "GARDN-00000")), ["school7"]);
  assert.deepEqual(orgObjectsInPool(org, buildings, "GARDN-00000")[0], { building: buildings[2], whole: false, canDisconnect: true });
  assert.deepEqual(orgObjectsInPool(org, buildings, "OTHER-00000"), []);
  assert.deepEqual(orgObjectsInPool(org, buildings, null), []);
});

test("организация целиком: её точки (кроме чужих), отключить — если код кабинета не её собственный", () => {
  const linked = { perLocationJournals: true, serviceCode: "OWNCD-00000", linkedServiceCode: "SCHOL-00000" };
  assert.deepEqual(ids(orgObjectsInPool(linked, buildings, "SCHOL-00000")), ["school5", "school9"]);
  assert.ok(orgObjectsInPool(linked, buildings, "SCHOL-00000").every((object) => object.whole && object.canDisconnect));
  // Кабинет создан из организации (её свой код) — отключить отсюда нельзя.
  const root = { perLocationJournals: true, serviceCode: "SCHOL-00000", linkedServiceCode: null };
  assert.ok(orgObjectsInPool(root, buildings, "SCHOL-00000").every((object) => object.whole && !object.canDisconnect));
  // Без журналов по точкам — организация сама.
  const flat = { perLocationJournals: false, serviceCode: "OWNCD-00000", linkedServiceCode: "SCHOL-00000" };
  assert.deepEqual(orgObjectsInPool(flat, buildings, "SCHOL-00000"), [{ building: null, whole: true, canDisconnect: true }]);
});

test("где сейчас объект: своя привязка точки, иначе кабинет организации", () => {
  const codes = new Set(["GARDN-00000", "SCHOL-00000"]);
  const org = { perLocationJournals: true, serviceCode: "OWNCD-00000", linkedServiceCode: "SCHOL-00000" };
  assert.equal(poolCodeOfObject(org, buildings[0], codes), "SCHOL-00000");
  assert.equal(poolCodeOfObject(org, buildings[2], codes), "GARDN-00000");
  assert.equal(poolCodeOfObject(org, null, codes), "SCHOL-00000");
  // Свой код организации без кабинета — не подключение.
  const alone = { perLocationJournals: true, serviceCode: "OWNCD-00000", linkedServiceCode: null };
  assert.equal(poolCodeOfObject(alone, buildings[0], codes), null);
  assert.equal(poolCodeOfObject(alone, buildings[2], codes), "GARDN-00000");
});
