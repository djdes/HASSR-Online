import test from "node:test";
import assert from "node:assert/strict";

import { comparableName, headerPointChoosing, headerPointHidden, miniLocationLabel, resolveHeaderPoint, sameAsCompany, type HeaderPoint } from "./header-point";

const COMPANY = "Столовая «Берёзка»";
const OFF = { enabled: false, buildings: [], activeBuildingId: null, canSwitch: false };

function resolve(partial: Partial<Parameters<typeof resolveHeaderPoint>[0]>): HeaderPoint {
  return resolveHeaderPoint({
    companyName: COMPANY,
    organizationBuildings: [],
    context: OFF,
    canManage: true,
    ...partial,
  });
}

test("название сравнивается без регистра, кавычек, «ё» и формы собственности", () => {
  assert.equal(comparableName("ООО «Берёзка»"), "березка");
  assert.ok(sameAsCompany("берёзка", "ООО «Берёзка»"));
  assert.ok(sameAsCompany("  Столовая  \"Березка\" ", COMPANY));
  assert.ok(!sameAsCompany("Берёзка на Ленина", COMPANY));
  // Пустые названия совпадением не считаются.
  assert.ok(!sameAsCompany("", ""));
  assert.ok(!sameAsCompany("ООО", "ООО"));
});

test("точек нет: руководителю — «Добавить точку», остальным — ничего", () => {
  assert.deepEqual(resolve({ canManage: true }), { kind: "add" });
  assert.deepEqual(resolve({ canManage: false }), { kind: "none" });
});

test("одна точка со своим названием — название, адрес второй строкой", () => {
  const point = resolve({
    organizationBuildings: [{ id: "b1", name: "Кафе на Ленина", address: "ул. Ленина, 5" }],
  });
  assert.deepEqual(point, {
    kind: "single",
    point: { id: "b1", title: { source: "name", text: "Кафе на Ленина" }, address: "ул. Ленина, 5" },
  });
});

test("одна точка с тем же названием, что у компании, — адрес вместо названия", () => {
  const point = resolve({
    organizationBuildings: [{ id: "b1", name: "Столовая Берёзка", address: "ул. Ленина, 5" }],
  });
  assert.deepEqual(point, {
    kind: "single",
    point: { id: "b1", title: { source: "address", text: "ул. Ленина, 5" }, address: null },
  });
});

test("одна точка с тем же названием и без адреса — «Основная точка», не дубль", () => {
  const point = resolve({ organizationBuildings: [{ id: "b1", name: COMPANY, address: null }] });
  assert.deepEqual(point, { kind: "single", point: { id: "b1", title: { source: "main", text: null }, address: null } });
});

test("точка без названия — адрес, а без адреса — «Точка без названия»", () => {
  assert.deepEqual(resolve({ organizationBuildings: [{ id: "b1", name: "  ", address: "пр. Мира, 1" }] }), {
    kind: "single",
    point: { id: "b1", title: { source: "address", text: "пр. Мира, 1" }, address: null },
  });
  assert.deepEqual(resolve({ organizationBuildings: [{ id: "b1", name: "", address: "  " }] }), {
    kind: "single",
    point: { id: "b1", title: { source: "untitled", text: null }, address: null },
  });
});

test("несколько точек и журналы по точкам — переключатель с активной точкой", () => {
  const buildings = [
    { id: "b1", name: COMPANY, address: "ул. Ленина, 5" },
    { id: "b2", name: "Цех на Мира", address: null },
  ];
  const point = resolve({
    organizationBuildings: buildings,
    context: { enabled: true, buildings, activeBuildingId: "b2", canSwitch: true },
  });
  assert.equal(point.kind, "switch");
  if (point.kind !== "switch") return;
  assert.equal(point.activeId, "b2");
  // Точка с названием компании в списке — по адресу.
  assert.deepEqual(point.options[0].title, { source: "address", text: "ул. Ленина, 5" });
  assert.deepEqual(point.options[1], { id: "b2", title: { source: "name", text: "Цех на Мира" }, address: null });
  // Активная точка пропала из доступных — первая.
  const fallback = resolve({
    organizationBuildings: buildings,
    context: { enabled: true, buildings, activeBuildingId: "gone", canSwitch: true },
  });
  assert.equal(fallback.kind === "switch" && fallback.activeId, "b1");
});

test("журналы по точкам, человеку доступна одна — её название без переключателя", () => {
  const point = resolve({
    organizationBuildings: [
      { id: "b1", name: "Кафе", address: null },
      { id: "b2", name: "Цех", address: null },
    ],
    context: { enabled: true, buildings: [{ id: "b2", name: "Цех", address: null }], activeBuildingId: "b2", canSwitch: false },
  });
  assert.deepEqual(point, { kind: "single", point: { id: "b2", title: { source: "name", text: "Цех" }, address: null } });
});

test("несколько точек, журналы общие — «все точки», переключать нечего", () => {
  const point = resolve({
    organizationBuildings: [
      { id: "b1", name: COMPANY, address: "ул. Ленина, 5" },
      { id: "b2", name: "Цех", address: null },
      { id: "b3", name: " Склад ", address: null },
    ],
  });
  assert.equal(point.kind, "all");
  if (point.kind !== "all") return;
  assert.equal(point.count, 3);
  // В подсказке — те же подписи, что в переключателе: точка с названием компании — по адресу.
  assert.deepEqual(
    point.options.map((option) => option.title.text),
    ["ул. Ленина, 5", "Цех", "Склад"],
  );
});

test("подпись в центре шапки никогда не равна названию компании", () => {
  const cases: Parameters<typeof resolveHeaderPoint>[0]["organizationBuildings"][] = [
    [{ id: "b1", name: COMPANY, address: null }],
    [{ id: "b1", name: "ООО «Столовая Берёзка»", address: "ул. Ленина, 5" }],
    [{ id: "b1", name: "столовая берёзка", address: "" }],
  ];
  for (const buildings of cases) {
    const point = resolve({ organizationBuildings: buildings });
    assert.equal(point.kind, "single");
    if (point.kind !== "single") continue;
    assert.ok(!point.point.title.text || !sameAsCompany(point.point.title.text, COMPANY));
  }
});

test("подпись «все объекты» скрыта на страницах про всю компанию и на главной", () => {
  for (const path of [
    "/home",
    "/settings/organization",
    "/settings/organization/documents",
    "/settings/master-cabinet",
    "/settings/organization/office",
    "/settings/access",
    "/settings/subscription",
    "/settings/appearance",
    "/settings/buildings",
    "/settings/buildings/",
  ]) {
    assert.ok(headerPointHidden(path, "all"), path);
  }
});

test("один объект и «нет объектов» видны везде, кроме главной: в разделах компании — «Выберите объект»", () => {
  for (const path of ["/settings/organization", "/settings/organization/office", "/settings/subscription", "/settings/buildings", "/dashboard"]) {
    assert.ok(!headerPointHidden(path, "single"), path);
    assert.ok(!headerPointHidden(path, "add"), path);
  }
  assert.ok(headerPointHidden("/home", "single"));
  assert.ok(headerPointHidden("/home", "add"));
});

test("на страницах точки переключатель остаётся", () => {
  for (const path of ["/journals", "/journals/hygiene", "/dashboard", "/settings/qr-posters", "/settings/buildings/b1", "/monitoring"]) {
    assert.ok(!headerPointHidden(path, "all"), path);
  }
});

test("на вкладках с фильтром по местам точка в шапке видна — фильтр с ней согласован", () => {
  for (const path of ["/settings/users", "/settings/areas", "/settings/equipment/", "/journals/points"]) {
    assert.ok(!headerPointHidden(path, "all"), path);
    assert.ok(!headerPointHidden(path, "switch"), path);
  }
});

test("уровень организации — «Выберите объект»: ни офиса, ни «Вся организация» в списке", () => {
  const buildings = [
    { id: "b1", name: "Кафе", address: null },
    { id: "b2", name: "Цех", address: null },
  ];
  const organization = resolve({
    organizationBuildings: buildings,
    context: { enabled: true, buildings, activeBuildingId: "b1", canSwitch: true, organizationView: true, canViewOrganization: true },
  });
  assert.equal(organization.kind, "switch");
  if (organization.kind !== "switch") return;
  assert.deepEqual(organization.options.map((option) => option.id), ["b1", "b2"]);
  assert.equal(organization.activeId, null);
  assert.equal(organization.organizationLevel, true);
  // Выбран объект — активен он.
  const point = resolve({
    organizationBuildings: buildings,
    context: { enabled: true, buildings, activeBuildingId: "b2", canSwitch: true, organizationView: false, canViewOrganization: true },
  });
  assert.equal(point.kind === "switch" && point.activeId, "b2");
  // Офис — не объект: в списке его нет, выбран офис — «Выберите объект».
  const withOffice = [{ id: "o", name: "Офис", address: null, kind: "office" }, ...buildings];
  const office = resolve({
    organizationBuildings: withOffice,
    context: { enabled: true, buildings: withOffice, activeBuildingId: "o", canSwitch: true, organizationView: true, canViewOrganization: true },
  });
  assert.equal(office.kind, "switch");
  if (office.kind !== "switch") return;
  assert.deepEqual(office.options.map((option) => option.id), ["b1", "b2"]);
  assert.equal(office.activeId, null);
  // Офис и один объект — переключатель с одним объектом.
  const officeAndOne = [{ id: "o", name: "Офис", address: null, kind: "office" }, buildings[0]];
  const one = resolve({
    organizationBuildings: officeAndOne,
    context: { enabled: true, buildings: officeAndOne, activeBuildingId: "o", canSwitch: true, organizationView: true, canViewOrganization: true },
  });
  assert.equal(one.kind === "switch" && one.options.length, 1);
  // Не руководство — объекты свои, уровня организации нет.
  const staff = resolve({
    organizationBuildings: buildings,
    context: { enabled: true, buildings, activeBuildingId: "b1", canSwitch: true, organizationView: false, canViewOrganization: false },
  });
  assert.equal(staff.kind === "switch" && staff.options.length, 2);
  assert.equal(staff.kind === "switch" && staff.organizationLevel, false);
  assert.equal(staff.kind === "switch" && staff.activeId, "b1");
});

test("без журналов по объектам офис тоже не объект", () => {
  const office = { id: "o", name: "Офис", address: null, kind: "office" };
  assert.deepEqual(resolve({ organizationBuildings: [office] }), { kind: "add" });
  assert.deepEqual(resolve({ organizationBuildings: [office], canManage: false }), { kind: "none" });
  const single = resolve({ organizationBuildings: [office, { id: "b1", name: "Кафе", address: null }] });
  assert.deepEqual(single, { kind: "single", point: { id: "b1", title: { source: "name", text: "Кафе" }, address: null } });
  const all = resolve({
    organizationBuildings: [office, { id: "b1", name: "Кафе", address: null }, { id: "b2", name: "Цех", address: null }],
  });
  assert.equal(all.kind === "all" && all.count, 2);
});

test("«Выберите объект»: нет объектов, уровень организации, один объект в разделах компании", () => {
  const add: HeaderPoint = { kind: "add" };
  const single: HeaderPoint = { kind: "single", point: { id: "b1", title: { source: "name", text: "Кафе" }, address: null } };
  const options = [
    { id: "b1", title: { source: "name" as const, text: "Кафе" }, address: null },
    { id: "b2", title: { source: "name" as const, text: "Цех" }, address: null },
  ];
  const organization: HeaderPoint = { kind: "switch", activeId: null, options, organizationLevel: true };
  const point: HeaderPoint = { kind: "switch", activeId: "b1", options, organizationLevel: true };
  const pointManager: HeaderPoint = { kind: "switch", activeId: "b1", options, organizationLevel: false };
  assert.ok(headerPointChoosing("/dashboard", add));
  assert.ok(headerPointChoosing("/dashboard", organization));
  assert.ok(headerPointChoosing("/settings/organization/office", organization));
  // Раздел всей компании — «Выберите объект» сразу, не дожидаясь автосмены.
  assert.ok(headerPointChoosing("/settings/organization/office", point));
  assert.ok(headerPointChoosing("/journals/points", point));
  assert.ok(!headerPointChoosing("/dashboard", point));
  assert.ok(!headerPointChoosing("/journals/hygiene", point));
  assert.ok(!headerPointChoosing("/settings/buildings/b1", point));
  // Руководитель точки на уровень организации не уходит.
  assert.ok(!headerPointChoosing("/settings/buildings", pointManager));
  // Один объект: в разделах компании и в списке объектов — выбрать, в журналах — он сам.
  assert.ok(headerPointChoosing("/settings/organization/office", single));
  assert.ok(headerPointChoosing("/settings/buildings", single));
  assert.ok(!headerPointChoosing("/journals", single));
  assert.ok(!headerPointChoosing("/dashboard", single));
});

test("Mini App: на уровне организации — «Выберите объект», офис не подписываем объектом", () => {
  const pointA = { id: "a", name: "Точка А", address: null };
  const office = { id: "o", name: "Офис", address: null, kind: "office" };
  // «Вся организация» без офиса: активной считается первая точка, но объект не выбран.
  assert.equal(miniLocationLabel({ enabled: true, organizationView: true, activeBuilding: pointA }, "Выберите объект"), "Выберите объект");
  // Выбран объект — его название.
  assert.equal(miniLocationLabel({ enabled: true, organizationView: false, activeBuilding: pointA }, "Выберите объект"), "Точка А");
  // Офис — не объект (2026-11-23): тоже «Выберите объект», а не «Офис».
  assert.equal(miniLocationLabel({ enabled: true, organizationView: true, activeBuilding: office }, "Выберите объект"), "Выберите объект");
  // Объекты выключены или контекста нет — подписи нет.
  assert.equal(miniLocationLabel({ enabled: false, organizationView: true, activeBuilding: null }, "Выберите объект"), null);
  assert.equal(miniLocationLabel(null, "Выберите объект"), null);
});

test("переключатель (kind: switch) виден и в разделах всей компании, и на главной", () => {
  for (const path of ["/home", "/settings/organization", "/settings/organization/office", "/settings/subscription", "/settings/appearance", "/settings/buildings", "/dashboard"]) {
    assert.ok(!headerPointHidden(path, "switch"), path);
  }
  // Вкладки со своим фильтром по местам — переключатель тоже на виду (2026-11-11).
  for (const path of ["/settings/users", "/settings/areas", "/settings/equipment", "/journals/points"]) {
    assert.ok(!headerPointHidden(path, "switch"), path);
  }
  // Подпись «все объекты» в разделах компании по-прежнему прячется, один объект — на главной.
  assert.ok(headerPointHidden("/home", "single"));
  assert.ok(headerPointHidden("/settings/subscription", "all"));
});
