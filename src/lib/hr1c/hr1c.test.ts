import assert from "node:assert/strict";
import test from "node:test";

import { readHrEmployeesBody } from "./api-body";
import { createZupClient, mergeZupEmployees, zupDate, ZupError, zupServiceRoot, type FetchLike } from "./odata";
import { normalizeName, planHrSync, summarizePlan, type HrEmployee, type WsPosition, type WsUser } from "./plan";

const TODAY = "2026-10-31";
const positions: WsPosition[] = [
  { id: "pos-cook", name: "Повар" },
  { id: "pos-chef", name: "Шеф-повар" },
  { id: "pos-dish", name: "Мойщица посуды" },
];
const employee = (externalId: string, fullName: string, extra: Partial<HrEmployee> = {}): HrEmployee => ({
  externalId,
  fullName,
  position: "Повар",
  hiredAt: "2026-01-10",
  dismissedAt: null,
  archived: false,
  phone: null,
  ...extra,
});
const user = (id: string, name: string, extra: Partial<WsUser> = {}): WsUser => ({
  id,
  name,
  isActive: true,
  archived: false,
  jobPositionId: "pos-cook",
  ...extra,
});

test("names compare without case, spaces and ё", () => {
  assert.equal(normalizeName("  Ёлкина   Анна "), "елкина анна");
});

test("hire, link by a unique name, update, dismiss — and nothing twice", () => {
  const users = [
    user("u-ivanova", "Иванова Мария"),
    user("u-petrov", "Петров Пётр", { jobPositionId: "pos-dish" }),
    user("u-sidorov", "Сидоров Сидор"),
  ];
  const employees = [
    employee("1c-ivanova", "Иванова  Мария"),
    employee("1c-petrov", "Петров Петр", { position: "Шеф-повар" }),
    employee("1c-sidorov", "Сидоров Сидор", { dismissedAt: "2026-10-30" }),
    employee("1c-new", "Новикова Анна", { position: "Кондитер" }),
    employee("1c-future", "Будущев Борис", { dismissedAt: "2026-11-15" }),
  ];
  const plan = planHrSync({ employees, links: [], users, positions, defaultPositionId: "pos-cook", today: TODAY });
  assert.deepEqual(
    plan.actions.map((action) => `${action.kind}:${action.employee.externalId}${action.kind === "update" ? `:${action.positionName}` : ""}`),
    [
      "link:1c-ivanova",
      "link:1c-petrov",
      "update:1c-petrov:Шеф-повар",
      "link:1c-sidorov",
      "dismiss:1c-sidorov",
      "hire:1c-new",
      "hire:1c-future",
    ],
  );
  const hire = plan.actions.find((action) => action.kind === "hire" && action.employee.externalId === "1c-new");
  assert.ok(hire && hire.kind === "hire" && hire.positionId === "pos-cook", "нет «Кондитера» — должность по умолчанию");
  assert.deepEqual(summarizePlan(plan), { hire: 2, link: 3, update: 1, dismiss: 1, problems: 0, unchanged: 0 });

  // Второй прогон после применения: связи есть, данные те же — ничего не меняется.
  const links = [
    { externalId: "1c-ivanova", userId: "u-ivanova" },
    { externalId: "1c-petrov", userId: "u-petrov" },
    { externalId: "1c-sidorov", userId: "u-sidorov" },
    { externalId: "1c-new", userId: "u-new" },
    { externalId: "1c-future", userId: "u-future" },
  ];
  const after = [
    user("u-ivanova", "Иванова Мария"),
    user("u-petrov", "Петров Петр", { jobPositionId: "pos-chef" }),
    user("u-sidorov", "Сидоров Сидор", { isActive: false, archived: true }),
    user("u-new", "Новикова Анна"),
    user("u-future", "Будущев Борис"),
  ];
  const again = planHrSync({ employees, links, users: after, positions, defaultPositionId: "pos-cook", today: TODAY });
  assert.deepEqual(again.actions, []);
  assert.deepEqual(again.problems, []);
  assert.equal(again.unchanged, 5);
});

test("problems: namesakes, no position at all, dismissed in WeSetup but working in 1C", () => {
  const users = [
    user("u-a", "Смирнова Ольга"),
    user("u-b", "Смирнова Ольга"),
    user("u-gone", "Уволенная Вера", { isActive: false, archived: true }),
  ];
  const plan = planHrSync({
    employees: [
      employee("1c-smirnova", "Смирнова Ольга"),
      employee("1c-baker", "Пекарев Иван", { position: "Пекарь" }),
      employee("1c-gone", "Уволенная Вера"),
    ],
    links: [{ externalId: "1c-gone", userId: "u-gone" }],
    users,
    positions,
    defaultPositionId: null,
    today: TODAY,
  });
  assert.deepEqual(plan.actions, []);
  assert.deepEqual(
    plan.problems.map((problem) => `${problem.employee.externalId}:${problem.reason}`),
    ["1c-smirnova:ambiguous_name", "1c-baker:no_position", "1c-gone:dismissed_in_wesetup"],
  );
});

test("archived in 1C counts as dismissed; dismissed and unknown here — nothing to do", () => {
  const plan = planHrSync({
    employees: [employee("1c-old", "Старый Сотрудник", { archived: true }), employee("1c-left", "Ушедший Давно", { dismissedAt: "2025-01-01" })],
    links: [{ externalId: "1c-old", userId: "u-old" }],
    users: [user("u-old", "Старый Сотрудник")],
    positions,
    defaultPositionId: "pos-cook",
    today: TODAY,
  });
  assert.deepEqual(plan.actions.map((action) => action.kind), ["dismiss"]);
  assert.equal(plan.unchanged, 1);
});

const ODATA = {
  employees: [
    { Ref_Key: "e-1", Description: "Иванова Мария Петровна", DeletionMark: false, ВАрхиве: false },
    { Ref_Key: "e-2", Description: "Сидоров  Сидор", DeletionMark: false, ВАрхиве: false },
    { Ref_Key: "e-3", Description: "Удалённый", DeletionMark: true, ВАрхиве: false },
  ],
  hr: [
    { Сотрудник_Key: "e-1", ДатаПриема: "2025-03-01T00:00:00", ДатаУвольнения: "0001-01-01T00:00:00", ТекущаяДолжность_Key: "p-1" },
    { Сотрудник_Key: "e-2", ДатаПриема: "2024-05-01T00:00:00", ДатаУвольнения: "2026-10-30T00:00:00", ТекущаяДолжность_Key: "p-2" },
  ],
  positions: [{ Ref_Key: "p-1", Description: "Повар" }, { Ref_Key: "p-2", Description: "Мойщица посуды" }],
};

test("OData: Basic auth, Cyrillic entities, pages; 1C empty dates; deletion marks dropped", async () => {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push(decodeURIComponent(url.replace("https://zup.example.ru/zup/odata/standard.odata/", "")));
    assert.equal((init.headers as Record<string, string>).Authorization, `Basic ${Buffer.from("odata:secret").toString("base64")}`);
    if (url.includes(encodeURIComponent("Catalog_Сотрудники"))) return Response.json({ value: ODATA.employees });
    if (url.includes(encodeURIComponent("InformationRegister_ТекущиеКадровыеДанныеСотрудников"))) return Response.json({ value: ODATA.hr });
    if (url.includes(encodeURIComponent("Catalog_Должности"))) return Response.json({ value: ODATA.positions });
    return new Response("", { status: 404 });
  };
  const client = createZupClient({ baseUrl: "https://zup.example.ru/zup/", login: "odata", password: "secret" }, { fetch: fetchImpl });
  const employees = await client.employees();
  assert.deepEqual(employees, [
    // Подразделения в публикации нет (справочник отвечает 404) — синхронизация не ломается.
    { externalId: "e-1", fullName: "Иванова Мария Петровна", position: "Повар", hiredAt: "2025-03-01", dismissedAt: null, archived: false, phone: null, departmentId: null, departmentName: null },
    { externalId: "e-2", fullName: "Сидоров Сидор", position: "Мойщица посуды", hiredAt: "2024-05-01", dismissedAt: "2026-10-30", archived: false, phone: null, departmentId: null, departmentName: null },
  ]);
  assert.ok(calls[0].startsWith("Catalog_Сотрудники?$format=json&$select=Ref_Key,Description,DeletionMark,ВАрхиве&$top=1000&$skip=0"));
  assert.equal(zupDate("0001-01-01T00:00:00"), null);
  // Адрес публикации или вставленный целиком адрес OData — один и тот же сервис.
  for (const pasted of ["https://zup.example.ru/zup", "https://zup.example.ru/zup/", "https://zup.example.ru/zup/odata/standard.odata", "https://zup.example.ru/zup/OData/standard.odata/$metadata"]) {
    assert.equal(zupServiceRoot(pasted), "https://zup.example.ru/zup/odata/standard.odata");
  }
  assert.deepEqual(mergeZupEmployees([{ Ref_Key: "00000000-0000-0000-0000-000000000000", Description: "Пусто" }], [], []), []);
});

test("OData errors: wrong password, not published, broken body — clear and without the password", async () => {
  const respond = (response: Response): FetchLike => async () => response;
  const creds = { baseUrl: "https://zup.example.ru/zup", login: "odata", password: "very-secret" };
  await assert.rejects(createZupClient(creds, { fetch: respond(new Response("", { status: 401 })) }).positions(), (error: unknown) => {
    assert.ok(error instanceof ZupError);
    assert.equal(error.code, "auth_failed");
    assert.equal(error.message.includes("very-secret"), false);
    return true;
  });
  await assert.rejects(createZupClient(creds, { fetch: respond(new Response("", { status: 404 })) }).positions(), /стандартный интерфейс OData/);
  await assert.rejects(createZupClient(creds, { fetch: respond(new Response("<html/>")) }).positions(), (error: unknown) => error instanceof ZupError && error.code === "bad_response");
});

test("API body from a 1C data processor is validated and mapped", () => {
  const body = readHrEmployeesBody({
    apply: true,
    employees: [
      { id: "000123", fullName: "Иванова  Мария", position: "Повар", hiredAt: "2025-03-01T00:00:00", dismissedAt: null },
      { id: "000124", fullName: "Сидоров Сидор", dismissedAt: "2026-10-30", phone: "+79851234567" },
    ],
  });
  assert.ok(body);
  assert.equal(body.apply, true);
  assert.deepEqual(body.employees[0], {
    externalId: "000123", fullName: "Иванова Мария", position: "Повар", hiredAt: "2025-03-01", dismissedAt: null, archived: false, phone: null,
    departmentId: null, departmentName: null,
  });
  assert.equal(body.employees[1].dismissedAt, "2026-10-30");
  assert.equal(readHrEmployeesBody({ employees: [{ id: "", fullName: "X" }] }), null);
  assert.equal(readHrEmployeesBody({ employees: "nope" }), null);
  assert.equal(readHrEmployeesBody({ employees: [] })?.apply, null);
});
