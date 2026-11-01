import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Люди точки (аудит точек, 2026-11-01): руководитель точки трогает только
 * людей своих точек — не людей всей компании (офис, без точки, все точки),
 * списки руководства идут по точке в шапке. Тест держит проверки на месте по
 * тексту маршрутов и страниц.
 */
const read = (path: string) => readFileSync(path, "utf8");
const count = (source: string, pattern: RegExp) => source.match(new RegExp(pattern.source, "g"))?.length ?? 0;

const GUARDED: Array<[string, RegExp, number]> = [
  // B1: люди всей компании руководителю точки — чужие.
  ["src/lib/point-scope.server.ts", /loadStaffScopeCheck\(session\)/, 1],
  ["src/app/api/users/[id]/route.ts", /loadStaffScopeCheck\(session\)/, 2],
  ["src/app/api/users/[id]/route.ts", /if \(!inScope\(user\.buildingIds\)\)/, 2],
  ["src/app/api/settings/buildings/[id]/staff/route.ts", /loadStaffScopeCheck\(auth\.session\)/, 1],
  ["src/app/api/settings/buildings/[id]/staff/route.ts", /!inScope\(user\.buildingIds\)/, 1],
  ["src/app/api/staff/schedules/work-off/bulk/route.ts", /loadStaffScopeCheck\(session\)/, 1],
  // B2: отчёт и сертификат по человеку другой точки — «не найдено».
  ["src/app/(dashboard)/reports/by-user/[id]/page.tsx", /if \(!inScope\(user\.buildingIds\)\) notFound\(\)/, 1],
  ["src/app/api/certificate/staff/route.ts", /loadStaffScopeCheck\(auth\.session\)/, 1],
  // B3: задачу человека другой точки не проверить.
  ["src/app/api/verifications/[id]/route.ts", /staffOutOfScopeResponse\(session, claim\.userId\)/, 1],
  // B4: списки людей — по точке в шапке.
  ["src/app/(dashboard)/bonuses/page.tsx", /visibleStaffWhere\(session\)/, 1],
  ["src/app/(dashboard)/bonuses/page.tsx", /user: staffWhere/, 1],
  ["src/app/(dashboard)/competencies/page.tsx", /visibleStaffWhere\(session\)/, 1],
  ["src/app/(dashboard)/settings/schedule/page.tsx", /visibleStaffWhere\(session\)/, 1],
  ["src/app/(dashboard)/settings/schedule/page.tsx", /userId: \{ in: users\.map\(/, 1],
  ["src/app/api/team/route.ts", /visibleStaffWhere\(session\)/, 1],
  ["src/app/api/competencies/route.ts", /visibleStaffWhere\(session\)/, 1],
  ["src/app/(dashboard)/team/page.tsx", /getViewedPointId\(session\)/, 1],
  // B5: «Проверяющие и аудиторы» — область человека.
  ["src/lib/inspectors-auditors.server.ts", /inspectorTokensWhere\(parsePointScope\(session\.user\.pointScope\)\)/, 1],
  ["src/lib/inspectors-auditors.server.ts", /documentVisibleWhere\(context\)/, 1],
  ["src/lib/inspectors-auditors.server.ts", /visibleStaffWhere\(session\)/, 1],
  ["src/lib/inspectors-auditors.server.ts", /visibleObjectBuildingIds\(session\)/, 1],
  ["src/lib/inspectors-auditors.server.ts", /\.\.\.scope\.(tokenWhere|userWhere|documentWhere)/, 3],
  ["src/app/(dashboard)/settings/inspectors/page.tsx", /loadInspectorsAuditorsScope\(session\)/, 1],
  ["src/app/api/staff/inspectors-auditors/route.ts", /loadInspectorsAuditorsScope\(session\)/, 1],
  // B6: преемник уволенного — с его точек.
  ["src/lib/offboarding.ts", /loadWorkerPointScope\(organizationId, userId\)/, 1],
  ["src/lib/offboarding.ts", /personInWorkerScope\(pointScope, c\.buildingIds\)/, 1],
  // B7: уборщик помещения — с его точки.
  ["src/app/api/settings/rooms/[id]/route.ts", /worksAtBuilding\(orgBuildingIds, cleaner\.buildingIds, buildingId\)/, 1],
  ["src/app/api/settings/rooms/[id]/route.ts", /cleanersWorkAtBuilding\(orgId, nextCleanerIds, previous\.buildingId\)/, 1],
];

test("люди точки: проверки на месте", () => {
  for (const [path, pattern, expected] of GUARDED) {
    const found = count(read(path), pattern);
    assert.ok(found >= expected, `${path}: ожидалось ${expected}× ${pattern}, найдено ${found}`);
  }
});

test("руководитель точки: прямой staffInScope не решает за людей всей компании", () => {
  // Только списки (`staffScopeWhere`) остаются по старому правилу; изменения — через loadStaffScopeCheck.
  assert.equal(count(read("src/app/api/users/[id]/route.ts"), /staffInScope\(/), 0);
  assert.equal(count(read("src/app/api/staff/schedules/work-off/bulk/route.ts"), /staffInScope\(/), 0);
  assert.doesNotMatch(read("src/lib/point-scope.server.ts"), /staffInScope\(session\.user, target\.buildingIds\)/);
});

test("списки руководства не держат старый фильтр только по руководителю точки", () => {
  for (const path of [
    "src/app/(dashboard)/bonuses/page.tsx",
    "src/app/(dashboard)/competencies/page.tsx",
    "src/app/(dashboard)/settings/schedule/page.tsx",
    "src/app/api/team/route.ts",
    "src/app/api/competencies/route.ts",
  ]) {
    assert.doesNotMatch(read(path), /staffScopeWhere\(/, path);
  }
});

test("уборщик другой точки — понятная ошибка", () => {
  assert.match(read("src/app/api/settings/rooms/[id]/route.ts"), /"Уборщик работает на другой точке/);
});

test("руководство с точкой в шапке: «Общий планшет», график и «Портал инспектора» — по точке", () => {
  const kiosk = readFileSync("src/app/(dashboard)/settings/kiosk/page.tsx", "utf8");
  assert.match(kiosk, /AND: \[ORG_ROSTER_WHERE, await visibleStaffWhere\(session\)\]/);
  assert.match(kiosk, /viewedPoint \? \{ OR: \[\{ buildingId: viewedPoint \}, \{ buildingId: null \}\] \}/);
  assert.match(readFileSync("src/app/api/organizations/schedule/route.ts", "utf8"), /user: await visibleStaffWhere\(g\.session\)/);
  assert.match(readFileSync("src/lib/inspector-qr-service.ts", "utf8"), /\.\.\.buildingWhere\(options\.viewedPointId\)/);
  assert.equal(
    readFileSync("src/app/api/settings/inspector-tokens/route.ts", "utf8").match(/viewedPointId: await getViewedPointId\(session\)/g)?.length,
    2,
  );
  assert.match(readFileSync("src/app/(dashboard)/settings/inspector-portal/page.tsx", "utf8"), /viewedPointId: await getViewedPointId\(session\)/);
});
