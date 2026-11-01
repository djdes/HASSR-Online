import assert from "node:assert/strict";
import test from "node:test";

import { autoEnableOnMapping, planEnterpriseList, vsdPointFollowsEnterprise } from "./enterprise-mapping";

test("точка ВСД следует за площадкой, пока ВСД не погашен", () => {
  for (const status of ["new", "acknowledged", "process_failed", "irrelevant"]) {
    assert.equal(vsdPointFollowsEnterprise(status), true, status);
  }
  // Погашенный и гасящийся уже лёг строкой в журнал приёмки своей точки.
  assert.equal(vsdPointFollowsEnterprise("processed"), false);
  assert.equal(vsdPointFollowsEnterprise("processing"), false);
});

test("список площадок из Меркурия: новые создаются, знакомые обновляют название и адрес", () => {
  const existing = [
    { id: "e1", enterpriseGuid: "AAA-111", activityLocationGuid: null, name: "Склад", address: "ул. Ленина, 1" },
    { id: "e2", enterpriseGuid: "BBB-222", activityLocationGuid: "loc-1", name: "Кухня", address: null },
  ];
  const plan = planEnterpriseList(existing, [
    { enterpriseGuid: "aaa-111", activityLocationGuid: null, name: "Склад", address: "ул. Ленина, 1" },
    { enterpriseGuid: "BBB-222", activityLocationGuid: "loc-1", name: "Кухня №2", address: "пр. Мира, 5" },
    { enterpriseGuid: "BBB-222", activityLocationGuid: "loc-2", name: "Кондитерская", address: null },
    { enterpriseGuid: "BBB-222", activityLocationGuid: "loc-2", name: "Дубль", address: null },
  ]);
  assert.deepEqual(plan.update, [{ id: "e2", name: "Кухня №2", address: "пр. Мира, 5" }]);
  assert.deepEqual(
    plan.create.map((item) => `${item.enterpriseGuid}|${item.activityLocationGuid}`),
    ["BBB-222|loc-2"],
    "регистр GUID не важен, дубли в ответе не плодят площадки",
  );
});

test("выбрали точку площадке без точки — опрос включается сам", () => {
  assert.equal(autoEnableOnMapping({ currentBuildingId: null, currentEnabled: false, nextBuildingId: "p1", requestedEnabled: undefined }), true);
  // Явный выбор «опрашивать» важнее.
  assert.equal(autoEnableOnMapping({ currentBuildingId: null, currentEnabled: false, nextBuildingId: "p1", requestedEnabled: false }), false);
  // Перенос на другую точку или снятие точки «опрашивать» не трогает.
  assert.equal(autoEnableOnMapping({ currentBuildingId: "p1", currentEnabled: false, nextBuildingId: "p2", requestedEnabled: undefined }), undefined);
  assert.equal(autoEnableOnMapping({ currentBuildingId: "p1", currentEnabled: true, nextBuildingId: null, requestedEnabled: undefined }), undefined);
  assert.equal(autoEnableOnMapping({ currentBuildingId: null, currentEnabled: true, nextBuildingId: "p1", requestedEnabled: undefined }), undefined);
});
