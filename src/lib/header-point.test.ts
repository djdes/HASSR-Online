import test from "node:test";
import assert from "node:assert/strict";

import { comparableName, headerPointHidden, miniLocationLabel, resolveHeaderPoint, sameAsCompany, type HeaderPoint } from "./header-point";

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

test("переключатель точки скрыт на страницах про всю компанию", () => {
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
    assert.ok(headerPointHidden(path), path);
  }
});

test("на страницах точки переключатель остаётся", () => {
  for (const path of [
    "/journals",
    "/journals/hygiene",
    "/dashboard",
    "/settings/areas",
    "/settings/equipment",
    "/settings/qr-posters",
    "/settings/users",
    "/settings/buildings/b1",
    "/monitoring",
  ]) {
    assert.ok(!headerPointHidden(path), path);
  }
});

test("«Вся организация»: первым пунктом у руководства без офиса, офис сам её заменяет", () => {
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
  assert.equal(organization.options[0].id, "organization");
  assert.deepEqual(organization.options[0].title, { source: "organization", text: null });
  assert.equal(organization.activeId, "organization");
  // Выбрана точка — активна она, пункт «Вся организация» остаётся в списке.
  const point = resolve({
    organizationBuildings: buildings,
    context: { enabled: true, buildings, activeBuildingId: "b2", canSwitch: true, organizationView: false, canViewOrganization: true },
  });
  assert.equal(point.kind === "switch" && point.activeId, "b2");
  // Есть офис — отдельного пункта нет.
  const withOffice = [{ id: "o", name: "Офис", address: null, kind: "office" }, ...buildings];
  const office = resolve({
    organizationBuildings: withOffice,
    context: { enabled: true, buildings: withOffice, activeBuildingId: "o", canSwitch: true, organizationView: true, canViewOrganization: true },
  });
  assert.equal(office.kind === "switch" && office.options.some((option) => option.id === "organization"), false);
  // Не руководство — пункта нет.
  const staff = resolve({
    organizationBuildings: buildings,
    context: { enabled: true, buildings, activeBuildingId: "b1", canSwitch: true, organizationView: false, canViewOrganization: false },
  });
  assert.equal(staff.kind === "switch" && staff.options.length, 2);
});

test("Mini App: в верхней панели «Вся организация», а не первая точка списка", () => {
  const pointA = { id: "a", name: "Точка А", address: null };
  const office = { id: "o", name: "Офис", address: null, kind: "office" };
  // «Вся организация» без офиса: активной считается первая точка, но подпись — организация.
  assert.equal(miniLocationLabel({ enabled: true, organizationView: true, activeBuilding: pointA }, "Вся организация"), "Вся организация");
  // Выбрана точка — её название.
  assert.equal(miniLocationLabel({ enabled: true, organizationView: false, activeBuilding: pointA }, "Вся организация"), "Точка А");
  // Офис играет роль всей организации — пишем офис, как в шапке сайта.
  assert.equal(miniLocationLabel({ enabled: true, organizationView: true, activeBuilding: office }, "Вся организация"), "Офис");
  // Точки выключены или контекста нет — подписи нет.
  assert.equal(miniLocationLabel({ enabled: false, organizationView: true, activeBuilding: null }, "Вся организация"), null);
  assert.equal(miniLocationLabel(null, "Вся организация"), null);
});
