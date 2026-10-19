import assert from "node:assert/strict";
import test from "node:test";

import { NAV_SECTIONS } from "@/lib/app-nav";
import {
  ACCESS_SECTIONS,
  personPreset,
  personSections,
  presetHolders,
  presetSections,
  typicalPresetGroup,
  type AccessPerson,
} from "@/lib/staff-access-overview";

const visibleKeys = (map: Record<string, string>, state = "visible") =>
  Object.entries(map)
    .filter(([, value]) => value === state)
    .map(([key]) => key);

test("разделы — те же девять, что в меню, в его порядке", () => {
  assert.deepEqual(
    ACCESS_SECTIONS.map((section) => section.key),
    NAV_SECTIONS.map((section) => section.key)
  );
});

test("набор у руководства: администратор видит всё, заведующая — всё, кроме «Моей компании»", () => {
  const admin = presetSections("admin", "management", null);
  assert.deepEqual(visibleKeys(admin), NAV_SECTIONS.map((section) => section.key));
  assert.deepEqual(visibleKeys(admin, "depends"), []);
  const headChef = presetSections("head_chef", "management", null);
  assert.equal(headChef.company, "hidden");
  assert.deepEqual(visibleKeys(headChef), [
    "staff",
    "points",
    "journals",
    "checklists",
    "productionControl",
    "billing",
    "more",
    "inspection",
  ]);
});

test("набор у сотрудника: повару — только чек-листы и то по личному доступу", () => {
  const cook = presetSections("cook", "staff", null);
  assert.deepEqual(visibleKeys(cook), []);
  assert.deepEqual(visibleKeys(cook, "depends"), ["checklists"]);
});

test("контроль-группа у сотрудника: команда, журналы, чек-листы и «Пришла проверка»", () => {
  const control = presetSections("control_group", "staff", null);
  assert.deepEqual(visibleKeys(control), ["staff", "journals", "checklists", "inspection"]);
  assert.deepEqual(visibleKeys(control, "depends"), []);
});

test("настройки организации для набора меняют и разделы", () => {
  // Повару организация дала «Проверку выполненных задач» — откроются журналы и проверка.
  const cook = presetSections("cook", "staff", { cook: ["mini.tasks", "tasks.verify"] });
  assert.ok(visibleKeys(cook).includes("journals"));
  assert.ok(visibleKeys(cook).includes("inspection"));
});

test("обычная группа набора: администратор и заведующий — руководство, остальные — сотрудники", () => {
  assert.equal(typicalPresetGroup("admin"), "management");
  assert.equal(typicalPresetGroup("head_chef"), "management");
  for (const preset of ["control_group", "cook", "waiter", "seller", "cashier", "cleaner"] as const) {
    assert.equal(typicalPresetGroup(preset), "staff", preset);
  }
});

function person(over: Partial<AccessPerson>): AccessPerson {
  return {
    id: "p",
    role: "cook",
    permissionPreset: null,
    checklistAcl: { migrated: true, row: undefined },
    permissionActor: { fallbackCategoryKey: "staff" },
    ...over,
  };
}

test("разделы человека: чек-листы — по его доступу к журналу, руководство — всё", () => {
  assert.deepEqual(personSections(person({}), null), []);
  assert.deepEqual(
    personSections(
      person({
        checklistAcl: {
          migrated: true,
          row: { templateCode: "custom_checklists", canRead: true, canWrite: true, canFinalize: false },
        },
      }),
      null
    ),
    ["checklists"]
  );
  // Не перешёл на ACL — видит все журналы, в том числе чек-листы.
  assert.deepEqual(personSections(person({ checklistAcl: { migrated: false, row: undefined } }), null), ["checklists"]);
  assert.deepEqual(
    personSections(person({ role: "manager", permissionActor: { positionCategoryKey: "management" } }), null),
    NAV_SECTIONS.map((section) => section.key)
  );
  // Управляющая с набором «Повар» — по роли всё равно руководство, но без «Моей компании».
  const managerCook = personSections(person({ role: "manager", permissionPreset: "cook" }), null);
  assert.ok(!managerCook.includes("company"));
  assert.ok(managerCook.includes("points"));
});

test("набор человека: по должности или вручную", () => {
  assert.deepEqual(personPreset({ role: "manager", permissionPreset: null }), {
    effective: "admin",
    byPosition: "admin",
    manual: false,
  });
  assert.deepEqual(personPreset({ role: "cook", permissionPreset: "control_group" }), {
    effective: "control_group",
    byPosition: "cook",
    manual: true,
  });
  // Мусор в базе — как «по должности».
  assert.equal(personPreset({ role: "cook", permissionPreset: "boss" }).manual, false);
});

test("кто получает набор: должности по роли и число людей вручную", () => {
  const holders = presetHolders([
    { role: "manager", permissionPreset: null, positionName: "Управляющий" },
    { role: "technologist", permissionPreset: null, positionName: "Шеф-повар" },
    { role: "cook", permissionPreset: null, positionName: "Повар" },
    { role: "cook", permissionPreset: null, positionName: "Повар" },
    { role: "cook", permissionPreset: "control_group", positionName: "Су-шеф" },
    { role: "cook", permissionPreset: null, positionName: null },
  ]);
  assert.deepEqual(holders.admin, { positions: ["Управляющий"], total: 1, manual: 0 });
  assert.deepEqual(holders.head_chef, { positions: ["Шеф-повар"], total: 1, manual: 0 });
  assert.deepEqual(holders.cook, { positions: ["Повар"], total: 3, manual: 0 });
  assert.deepEqual(holders.control_group, { positions: [], total: 1, manual: 1 });
  assert.deepEqual(holders.cashier, { positions: [], total: 0, manual: 0 });
});
