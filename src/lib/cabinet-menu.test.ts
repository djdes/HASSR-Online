import assert from "node:assert/strict";
import test from "node:test";

import { MASTER_CABINET_HREF, splitCabinetMenu } from "@/lib/cabinet-menu";

const cafe = { id: "cafe", name: "Кафе «Выход»", kind: "regular" };
const school = { id: "school", name: "Школа № 5", kind: "regular" };
const master = { id: "master", name: "Мастер-кабинет Школы", kind: "directory" };
const master2 = { id: "master-2", name: "Мастер-кабинет Лицея", kind: "directory" };

test("мастер-кабинеты — в «Кабинет», остальные — в «Организации», порядок сохраняется", () => {
  const split = splitCabinetMenu([cafe, master, school, master2]);
  assert.deepEqual(split.organizations.map((o) => o.id), ["cafe", "school"]);
  assert.deepEqual(split.masterCabinets.map((o) => o.id), ["master", "master-2"]);
});

test("без мастер-кабинетов всё остаётся в «Организациях»", () => {
  const split = splitCabinetMenu([cafe, school]);
  assert.deepEqual(split.organizations, [cafe, school]);
  assert.deepEqual(split.masterCabinets, []);
});

test("вид не указан (старый ответ API) — обычная организация", () => {
  const legacy = { id: "old", name: "Без вида" };
  const split = splitCabinetMenu([legacy, { id: "n", name: "null", kind: null }]);
  assert.equal(split.organizations.length, 2);
  assert.equal(split.masterCabinets.length, 0);
});

test("строка мастер-кабинета открывает его оболочку", () => {
  assert.equal(MASTER_CABINET_HREF, "/master");
});
