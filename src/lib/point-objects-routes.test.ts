import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Объекты точки (аудит точек, 2026-11-01): каждое API, которое меняет цех,
 * помещение, оборудование, людей точки или планшет, проверяет точку объекта
 * для руководителя точки. Тест держит проверки на месте по тексту маршрутов.
 */
const read = (path: string) => readFileSync(path, "utf8");

const GUARDED: Array<[string, RegExp, number]> = [
  ["src/app/api/equipment/route.ts", /objectPointError\(session\.user/, 1],
  ["src/app/api/equipment/[id]/route.ts", /objectPointResponse\(session\.user, equipment\.area\.buildingId\)/, 2],
  ["src/app/api/equipment/[id]/route.ts", /objectPointError\(session\.user/, 1],
  ["src/app/api/areas/route.ts", /objectPointResponse\(session\.user, buildingId\)/, 1],
  ["src/app/api/areas/[id]/route.ts", /objectPointResponse\(session\.user, area\.buildingId\)/, 2],
  ["src/app/api/areas/[id]/route.ts", /objectPointResponse\(session\.user, buildingInput\.buildingId\)/, 1],
  ["src/app/api/settings/rooms/route.ts", /objectPointResponse\(auth\.session\.user, building\.id\)/, 1],
  ["src/app/api/settings/rooms/[id]/route.ts", /objectPointResponse\(auth\.session\.user, (previous|room)\.buildingId\)/g, 2],
  ["src/app/api/settings/buildings/[id]/staff/route.ts", /buildingInScope\(actor, building\.id\)/, 1],
  ["src/app/api/settings/buildings/[id]/staff/route.ts", /staffInScope\(actor, user\.buildingIds\)/, 1],
  ["src/app/api/settings/buildings/[id]/copy-rooms/route.ts", /buildingInScope\(auth\.session\.user, source\.id\)/, 1],
  ["src/app/api/kiosk/enroll/route.ts", /objectPointResponse\(auth\.session\.user, buildingId\)/, 1],
  ["src/app/api/kiosk/pins-bulk/route.ts", /staffScopeWhere\(auth\.session\.user\)/, 1],
  ["src/app/api/kiosk/unlock/route.ts", /employeeWorksAtQrPoint\(pointScope, body\.userId\)/, 1],
  ["src/app/api/webauthn/authenticate/verify/route.ts", /worksAtQrPoint\(pointScope, user\.buildingIds\)/, 1],
  ["src/app/api/setup-helper/devices/[id]/revoke/route.ts", /staffInScope\(session\.user/, 1],
  ["src/app/api/charts/temperature/route.ts", /objectVisibleToSession\(session, equipment\.area\.buildingId\)/, 1],
];

test("API объектов точки проверяют точку объекта", () => {
  for (const [path, pattern, count] of GUARDED) {
    const found = read(path).match(new RegExp(pattern.source, "g"))?.length ?? 0;
    assert.ok(found >= count, `${path}: ожидалось ${count}× ${pattern}, найдено ${found}`);
  }
});

test("списки цехов и оборудования без документа — по точкам человека", () => {
  assert.match(read("src/app/api/areas/route.ts"), /visibleObjectBuildingIds\(session\)/);
  assert.match(read("src/app/api/equipment/route.ts"), /visibleObjectBuildingIds\(session\)/);
});

test("окно «Добавить помещение» берёт цеха точки, куда встанет помещение", () => {
  assert.match(read("src/components/cleaning/room-directory-picker-dialog.tsx"), /orphan-areas\$\{query\}/);
  assert.match(read("src/app/api/settings/rooms/orphan-areas/route.ts"), /loadOrphanAreas\(orgId, pointId\)/);
});
