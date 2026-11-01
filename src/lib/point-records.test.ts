import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { newRecordPoint, pointRecordVisible, pointRecordsWhere, recordsAtPointWhere } from "./point-records";

const A = { id: "b-a", name: "Точка А", address: null };
const B = { id: "b-b", name: "Точка Б", address: null };

function context(over: Partial<Parameters<typeof pointRecordsWhere>[0]> = {}) {
  return {
    enabled: true,
    buildings: [A, B],
    organizationView: true,
    activeBuildingId: A.id,
    canViewOrganization: true,
    ...over,
  };
}

test("точки выключены — без фильтра, новая запись общая", () => {
  const off = context({ enabled: false });
  assert.deepEqual(pointRecordsWhere(off), {});
  assert.deepEqual(newRecordPoint(off, "b-a"), { ok: true, buildingId: null });
  assert.equal(pointRecordVisible(off, "b-x"), true);
});

test("«Вся организация» у руководства — все доступные точки и общие", () => {
  assert.deepEqual(pointRecordsWhere(context()), {
    AND: [{}, { OR: [{ buildingId: null }, { buildingId: { in: [A.id, B.id] } }] }],
  });
});

test("смотрит точку А — записи точки А и общие", () => {
  const where = pointRecordsWhere(context({ organizationView: false, activeBuildingId: A.id }));
  assert.deepEqual(where.AND?.[0], { OR: [{ buildingId: A.id }, { buildingId: null }] });
});

test("человек точки А не видит запись точки Б, общую — видит", () => {
  const pointA = context({ buildings: [A], organizationView: false, canViewOrganization: false });
  assert.equal(pointRecordVisible(pointA, B.id), false);
  assert.equal(pointRecordVisible(pointA, A.id), true);
  assert.equal(pointRecordVisible(pointA, null), true);
});

test("точка новой записи: из шапки, явная — только доступная, «вся организация» — только руководству", () => {
  const viewingA = context({ organizationView: false, activeBuildingId: A.id });
  assert.deepEqual(newRecordPoint(viewingA, undefined), { ok: true, buildingId: A.id });
  assert.deepEqual(newRecordPoint(context(), undefined), { ok: true, buildingId: null });
  assert.deepEqual(newRecordPoint(context(), B.id), { ok: true, buildingId: B.id });
  assert.deepEqual(newRecordPoint(context(), null), { ok: true, buildingId: null });

  const pointA = context({ buildings: [A], organizationView: false, canViewOrganization: false });
  assert.equal(newRecordPoint(pointA, B.id).ok, false);
  // Руководитель точки не создаёт «общую» запись — она уходит на его точку.
  assert.deepEqual(newRecordPoint(pointA, null), { ok: true, buildingId: A.id });
});

test("отчёт по точке — её записи и общие; без точки — без ограничения", () => {
  assert.deepEqual(recordsAtPointWhere(A.id), { AND: [{ OR: [{ buildingId: A.id }, { buildingId: null }] }] });
  assert.deepEqual(recordsAtPointWhere(null), {});
});

test("маршруты партий и CAPA проверяют точку записи", () => {
  const guarded = [
    "src/app/api/batches/route.ts",
    "src/app/api/batches/[id]/route.ts",
    "src/app/api/capa/route.ts",
    "src/app/api/capa/[id]/route.ts",
    "src/app/api/capa/[id]/suggest/route.ts",
    "src/app/api/capa/bulk-close/route.ts",
    "src/app/(dashboard)/batches/page.tsx",
    "src/app/(dashboard)/batches/[id]/page.tsx",
    "src/app/(dashboard)/capa/page.tsx",
    "src/app/(dashboard)/capa/[id]/page.tsx",
  ];
  for (const file of guarded) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /pointRecordVisible|pointRecordsWhere|recordsAtPointWhere/, file);
  }
  for (const file of [
    "src/lib/capa-auto-detect.ts",
    "src/lib/iot-violation-capa.ts",
    "src/app/api/journals/route.ts",
    "src/app/api/journal-task-claims/[id]/route.ts",
    "src/lib/mercury/process-incoming.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    const creates = source.split(/capaTicket\.create\(|\.batch\s*\.create\(|db\.batch\.create\(/).slice(1);
    assert.ok(creates.length > 0, `${file}: нет создания записи`);
    for (const chunk of creates) assert.match(chunk.slice(0, 400), /buildingId/, `${file}: создание без точки`);
  }
});
