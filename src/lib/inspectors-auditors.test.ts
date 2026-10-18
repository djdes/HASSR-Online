import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { buildInternalInspectors, externalInspectorEntry } from "@/lib/inspectors-auditors";

const users = [
  { id: "u-tech", name: "Лебедева Марина", position: "Технолог" },
  { id: "u-chef", name: "Морозов Илья", position: "Шеф-повар" },
  { id: "u-cook", name: "Волкова Анна", position: "Повар" },
];
const journalNames = new Map([
  ["hygiene", "Гигиенический журнал"],
  ["audit_plan", "План-программа внутренних аудитов"],
  ["audit_report", "Отчет о внутреннем аудите"],
  ["traceability_test", "Журнал прослеживаемости продукции"],
  ["cleaning", "Журнал уборки"],
]);

test("внутренние: проверяющие журналов, документов, помещений и аудиторы", () => {
  const result = buildInternalInspectors({
    users,
    responsibleSlots: {
      hygiene: { main: "u-cook", _verifier: "u-chef" },
      audit_plan: { main: "u-tech", _verifier: "u-chef" },
      audit_report: { main: "u-tech" },
      traceability_test: { main: "u-tech" },
      // Уволенный / чужой id и мусор — отбрасываются.
      cleaning: { main: "u-cook", _verifier: "u-gone" },
      broken: "x",
    },
    documents: [
      { id: "d1", title: "Гигиена · октябрь", templateCode: "hygiene", verifierUserId: "u-chef" },
      { id: "d2", title: "", templateCode: "cleaning", verifierUserId: "u-tech" },
      { id: "d3", title: "Чужой", templateCode: "hygiene", verifierUserId: "u-gone" },
    ],
    rooms: [
      { id: "r1", name: "Холодный цех", verifierUserIds: ["u-chef", "u-chef"] },
      { id: "r2", name: "Склад", verifierUserIds: ["u-gone"] },
    ],
    journalNames,
  });

  assert.deepEqual(
    result.map((person) => person.name),
    ["Лебедева Марина", "Морозов Илья"],
    "повар без ролей проверки в список не попадает"
  );
  const tech = result[0];
  assert.deepEqual(
    tech.roles.map((role) => [role.kind, role.items.map((item) => item.id)]),
    [
      ["document_verifier", ["d2"]],
      ["audit_auditor", ["audit_report", "audit_plan"]],
      ["traceability_auditor", ["traceability_test"]],
    ]
  );
  assert.equal(tech.roles[0].items[0].name, "Журнал уборки", "документ без названия — по журналу");
  assert.equal(tech.position, "Технолог");

  const chef = result[1];
  assert.deepEqual(
    chef.roles.map((role) => [role.kind, role.label, role.items.map((item) => item.id)]),
    [
      ["journal_verifier", "Проверяющий журналов", ["hygiene", "audit_plan"]],
      ["document_verifier", "Проверяющий документов", ["d1"]],
      ["room_verifier", "Проверяющий помещений", ["r1"]],
    ]
  );
});

test("внутренние: отключённые журналы организации не дают ролей", () => {
  const result = buildInternalInspectors({
    users,
    responsibleSlots: { hygiene: { _verifier: "u-chef" }, traceability_test: { main: "u-tech" } },
    documents: [{ id: "d1", title: "Гигиена", templateCode: "hygiene", verifierUserId: "u-chef" }],
    rooms: [],
    journalNames,
    disabledCodes: new Set(["hygiene"]),
  });
  assert.deepEqual(result.map((person) => person.userId), ["u-tech"]);
});

test("внешние: вид, статус, кто выпустил, визиты — без хэша токена", () => {
  const now = new Date("2026-10-17T12:00:00.000Z");
  const base = {
    label: "СЭС, плановая",
    periodFrom: new Date("2026-10-01T00:00:00.000Z"),
    periodTo: new Date("2026-10-15T00:00:00.000Z"),
    expiresAt: new Date("2026-10-20T00:00:00.000Z"),
    lastAccessedAt: new Date("2026-10-16T09:00:00.000Z"),
    accessCount: 3,
    revokedAt: null,
    createdAt: new Date("2026-10-14T00:00:00.000Z"),
    createdById: "u-chef",
    visits: [
      { id: "v1", signedAt: new Date("2026-10-15T10:00:00.000Z"), inspectorName: "Сидоров", templatesViewed: ["hygiene", "cleaning"] },
      { id: "v2", signedAt: new Date("2026-10-16T10:00:00.000Z"), inspectorName: null, templatesViewed: null },
    ],
  };
  const issuers = new Map([["u-chef", "Морозов Илья"]]);
  const link = externalInspectorEntry({ id: "t1", ...base }, issuers, now);
  assert.equal(link.kind, "link");
  assert.equal(link.status, "active");
  assert.equal(link.active, true);
  assert.deepEqual(link.issuedBy, { id: "u-chef", name: "Морозов Илья" });
  assert.equal(link.periodFrom, "2026-10-01T00:00:00.000Z");
  assert.deepEqual(link.visits.map((visit) => [visit.id, visit.journalsViewed]), [["v2", 0], ["v1", 2]]);
  assert.equal("tokenHash" in link, false);

  const qr = externalInspectorEntry(
    { id: "t2", ...base, periodTo: new Date("2099-12-31T00:00:00.000Z"), createdById: null, visits: [] },
    issuers,
    now
  );
  assert.equal(qr.kind, "qr");
  assert.equal(qr.periodFrom, null);
  assert.equal(qr.issuedBy, null);

  assert.equal(externalInspectorEntry({ id: "t3", ...base, expiresAt: new Date("2026-10-17T11:00:00.000Z") }, issuers, now).status, "expired");
  assert.equal(externalInspectorEntry({ id: "t4", ...base, revokedAt: new Date("2026-10-16T00:00:00.000Z") }, issuers, now).status, "revoked");
});

test("маршрут списка: только руководителю и без хэшей токенов", () => {
  const route = readFileSync(new URL("../app/api/staff/inspectors-auditors/route.ts", import.meta.url), "utf8");
  assert.match(route, /hasFullWorkspaceAccess\(/);
  assert.doesNotMatch(route, /tokenHash: true/);
});
