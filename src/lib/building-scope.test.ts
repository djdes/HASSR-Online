import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedBuildingsForUser,
  isOfficeBuilding,
  workBuildingsForUser,
  buildingWhere,
  decodeBuildingCookie,
  encodeBuildingCookie,
  resolveActiveBuilding,
  withBuildingLabel,
  withBuildingSuffix,
  buildingPrintName,
} from "./building-scope";

const A = { id: "b-a", name: "Точка 1", address: "ул. Ленина, 5" };
const B = { id: "b-b", name: "Точка 2", address: null };
const C = { id: "b-c", name: "Точка 3", address: null };

test("cookie: префикс организации обязателен, чужая организация игнорируется", () => {
  const raw = encodeBuildingCookie("org-1", "b-a");
  assert.equal(raw, "org-1:b-a");
  assert.equal(decodeBuildingCookie(raw, "org-1"), "b-a");
  assert.equal(decodeBuildingCookie(raw, "org-2"), null);
  assert.equal(decodeBuildingCookie("", "org-1"), null);
  assert.equal(decodeBuildingCookie(undefined, "org-1"), null);
  assert.equal(decodeBuildingCookie("org-1:", "org-1"), null);
  assert.equal(decodeBuildingCookie(":b-a", ""), null);
});

test("resolveActiveBuilding: выключенный флаг или одна точка — без области", () => {
  const off = resolveActiveBuilding({
    enabled: false,
    buildings: [A, B],
    userBuildingIds: [],
    cookieBuildingId: "b-b",
  });
  assert.equal(off.enabled, false);
  assert.equal(off.activeBuildingId, null);
  assert.equal(off.canSwitch, false);

  const single = resolveActiveBuilding({
    enabled: true,
    buildings: [A],
    userBuildingIds: [],
    cookieBuildingId: "b-a",
  });
  assert.equal(single.enabled, false);
  assert.equal(single.activeBuildingId, null);
});

test("resolveActiveBuilding: cookie выбирает точку, иначе первая", () => {
  const fromCookie = resolveActiveBuilding({
    enabled: true,
    buildings: [A, B, C],
    userBuildingIds: [],
    cookieBuildingId: "b-c",
  });
  assert.equal(fromCookie.activeBuildingId, "b-c");
  assert.equal(fromCookie.canSwitch, true);
  assert.deepEqual(fromCookie.buildings, [A, B, C]);

  const stale = resolveActiveBuilding({
    enabled: true,
    buildings: [A, B],
    userBuildingIds: [],
    cookieBuildingId: "deleted",
  });
  assert.equal(stale.activeBuildingId, "b-a");
});

test("resolveActiveBuilding: сотрудник видит только свои точки, пустой список = все", () => {
  const restricted = resolveActiveBuilding({
    enabled: true,
    buildings: [A, B, C],
    userBuildingIds: ["b-b"],
    cookieBuildingId: "b-a",
  });
  assert.deepEqual(restricted.buildings, [B]);
  assert.equal(restricted.activeBuildingId, "b-b");
  assert.equal(restricted.canSwitch, false);

  const two = resolveActiveBuilding({
    enabled: true,
    buildings: [A, B, C],
    userBuildingIds: ["b-c", "b-a"],
    cookieBuildingId: "b-c",
  });
  assert.deepEqual(two.buildings.map((b) => b.id), ["b-a", "b-c"]);
  assert.equal(two.activeBuildingId, "b-c");
  assert.equal(two.canSwitch, true);
});

test("allowedBuildingsForUser: только удалённые точки в списке — доступны все", () => {
  assert.deepEqual(allowedBuildingsForUser([A, B], ["gone"]), [A, B]);
  assert.deepEqual(allowedBuildingsForUser([A, B], []), [A, B]);
  assert.deepEqual(allowedBuildingsForUser([A, B], ["b-b", "gone"]), [B]);
});

test("buildingWhere: свои + общие документы, без точки — без фильтра", () => {
  assert.deepEqual(buildingWhere(null), {});
  assert.deepEqual(buildingWhere(undefined), {});
  assert.deepEqual(buildingWhere("b-a"), {
    OR: [{ buildingId: "b-a" }, { buildingId: null }],
  });
});

test("подписи: организация с точкой и адресом, заголовок задачи с точкой", () => {
  assert.equal(withBuildingLabel("Кафе «Ромашка»", null), "Кафе «Ромашка»");
  assert.equal(
    withBuildingLabel("Кафе «Ромашка»", A),
    "Кафе «Ромашка» · Точка 1, ул. Ленина, 5",
  );
  assert.equal(withBuildingLabel("Кафе", B), "Кафе · Точка 2");
  // Наименование для журналов заменяет короткое название и адрес точки в шапке.
  assert.equal(
    withBuildingLabel("ООО «Ромашка»", { ...A, journalName: "  Кафе «Ромашка»,  г. Казань, ул. Баумана, 12 " }),
    "ООО «Ромашка» · Кафе «Ромашка», г. Казань, ул. Баумана, 12",
  );
  assert.equal(withBuildingLabel("Кафе", { ...B, journalName: "   " }), "Кафе · Точка 2");
  assert.equal(buildingPrintName({ ...A, journalName: " Кафе «Ромашка»,  г. Казань " }), "Кафе «Ромашка», г. Казань");
  assert.equal(buildingPrintName(B), "Точка 2");
  assert.equal(buildingPrintName(null), "");
  assert.equal(withBuildingSuffix("Уборка · Кухня", "Точка 2"), "Уборка · Кухня · Точка 2");
  assert.equal(withBuildingSuffix("Уборка · Кухня", null), "Уборка · Кухня");
  assert.equal(withBuildingSuffix("Уборка", "  "), "Уборка");
});

test("офис: сотрудник офиса видит все точки, а работает только в офисе", () => {
  const OFFICE = { id: "b-office", name: "Офис", address: null, kind: "office" };
  const all = [OFFICE, A, B];
  assert.deepEqual(allowedBuildingsForUser(all, [OFFICE.id]), all);
  assert.deepEqual(workBuildingsForUser(all, [OFFICE.id]), [OFFICE]);
  // Сотрудник точки — только своя точка, и видит, и работает.
  assert.deepEqual(allowedBuildingsForUser(all, [A.id]), [A]);
  assert.deepEqual(workBuildingsForUser(all, [A.id]), [A]);
  // Без места — как раньше, везде.
  assert.deepEqual(allowedBuildingsForUser(all, []), all);
  assert.deepEqual(workBuildingsForUser(all, []), all);
  assert.equal(isOfficeBuilding(OFFICE), true);
  assert.equal(isOfficeBuilding(A), false);
});
