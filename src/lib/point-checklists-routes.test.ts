import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Чек-листы и посещения проверяющих по точкам (аудит точек, 2026-11-01):
 * назначения, проверки по чек-листам и посещения другой точки руководитель
 * точки и руководство с точкой в шапке не видят и не меняют. Тест держит
 * проверки на месте по тексту маршрутов; правила — checklist-point-scope.test.ts.
 */
const read = (path: string) => readFileSync(path, "utf8");

const GUARDED: Array<[string, RegExp, number]> = [
  // Назначения: область — точка из шапки и точки руководителя точки.
  ["src/lib/checklist-assignments.api.ts", /visibleObjectBuildingIds\(session\)/, 1],
  ["src/lib/checklist-assignments.api.ts", /assignmentTargetRefusal\(scope\.area, input, keepVerifierUserId\)/, 1],
  ["src/app/api/checklists/assignments/route.ts", /loadAssignmentScope\(auth\.session, auth\.organizationId\)/, 2],
  ["src/app/api/checklists/assignments/route.ts", /assignmentRowsInArea\(scope\.area, /, 1],
  ["src/app/api/checklists/assignments/route.ts", /validateAssignmentRefs\(auth\.organizationId, parsed\.data, new Date\(\), scope\)/, 1],
  ["src/app/api/checklists/assignments/[id]/route.ts", /assignmentChangeRefusal\(scope\.area, existing\)/, 2],
  [
    "src/app/api/checklists/assignments/[id]/route.ts",
    /validateAssignmentRefs\(auth\.organizationId, parsed\.data, new Date\(\), scope, existing\.verifierUserId\)/,
    1,
  ],
  ["src/app/(dashboard)/checklists/assignments/page.tsx", /loadAssignmentScope\(session, organizationId\)/, 1],
  ["src/app/(dashboard)/checklists/assignments/page.tsx", /assignmentRowsInArea\(area, allRows\)/, 1],
  ["src/app/(dashboard)/checklists/assignments/page.tsx", /assignmentFormInArea\(area, context\)/, 1],
  // Начать проверку по чужому назначению руководитель (не получатель) не может.
  ["src/lib/checklist-assignments.server.ts", /!isRecipient && !assignmentInArea\(area, assignment\)/, 1],
  ["src/app/api/checklists/inspections/route.ts", /points: await visibleObjectBuildingIds\(auth\.session\)/, 1],
  // Проверки по чек-листам: по точке назначения, без назначения — по автору.
  ["src/lib/custom-checklists.server.ts", /visibleObjectBuildingIds\(session\)/, 1],
  ["src/app/api/checklists/inspections/route.ts", /checklistInspectionsInArea\(auth\.session, auth\.organizationId, rows\)/, 1],
  ["src/app/api/checklists/inspections/[id]/route.ts", /checklistInspectionInArea\(auth\.session, auth\.organizationId, (inspection|current)\)/g, 2],
  ["src/app/api/checklists/inspections/[id]/review/route.ts", /checklistInspectionInArea\(auth\.session, auth\.organizationId, inspection\)/, 1],
  ["src/app/api/checklists/inspections/[id]/pdf/route.ts", /checklistInspectionAreaRefusal\(id\)/, 1],
  ["src/app/api/checklists/attachments/[id]/route.ts", /checklistInspectionInArea\(auth\.session, auth\.organizationId, file\.inspection\)/, 1],
  ["src/app/api/checklists/attachments/route.ts", /checklistInspectionInArea\(auth\.session, auth\.organizationId, target\)/, 1],
  ["src/app/(dashboard)/checklists/inspections/[id]/page.tsx", /checklistInspectionInArea\(session, getActiveOrgId\(session\), inspection\)\)\) notFound\(\)/, 1],
  // Посещения проверяющих: по точке ссылки, без ссылки — общие.
  ["src/lib/inspection-visits.server.ts", /\.\.\.inspectionVisitAreaWhere\(options\.pointIds\)/, 1],
  ["src/lib/inspection-visits.server.ts", /\.\.\.inspectionVisitAreaWhere\(pointIds\)/, 1],
  ["src/app/api/inspection/visits/route.ts", /pointIds: await visibleObjectBuildingIds\(auth\.session\)/, 1],
  ["src/app/(dashboard)/inspection/visits/page.tsx", /const pointIds = await visibleObjectBuildingIds\(session\)/, 1],
  ["src/app/(dashboard)/inspection/visits/page.tsx", /listInspectionVisits\(organizationId, \{ includeHidden: true, pointIds \}\)/, 1],
  ["src/app/api/inspection/visits/[id]/hidden/route.ts", /inspectionVisitInArea\(await visibleObjectBuildingIds\(session\), visit\.token\?\.buildingId\)/, 1],
  ["src/app/api/inspection/visits/[id]/files/route.ts", /inspectionVisitInArea\(await visibleObjectBuildingIds\(session\), visit\.token\?\.buildingId\)/, 1],
  [
    "src/app/api/inspection/visit-files/[fileId]/route.ts",
    /inspectionVisitInArea\(await visibleObjectBuildingIds\(session\), file\?\.visit\.token\?\.buildingId\)/,
    1,
  ],
  ["src/app/api/reports/compliance-bundle/route.ts", /loadInspectionVisitsForBundle\(organizationId, from, toEndOfDay, pointId \? \[pointId\] : null\)/, 1],
];

test("назначения, проверки и посещения проверяющих проверяют точку", () => {
  for (const [path, pattern, count] of GUARDED) {
    const found = read(path).match(new RegExp(pattern.source, "g"))?.length ?? 0;
    assert.ok(found >= count, `${path}: ожидалось ${count}× ${pattern}, найдено ${found}`);
  }
});

test("форма назначения не получает точки, людей и должности всей организации", () => {
  const page = read("src/app/(dashboard)/checklists/assignments/page.tsx");
  for (const leak of [/buildings=\{context\.buildings\}/, /people=\{context\.people/, /positions=\{context\.positions/]) {
    assert.doesNotMatch(page, leak);
  }
});

test("файл посещения знает точку ссылки, по которой внесли запись", () => {
  assert.match(
    read("src/lib/inspection-visits.server.ts"),
    /visit: \{ select: \{ organizationId: true, tokenId: true, hiddenAt: true, token: \{ select: \{ buildingId: true \} \} \} \}/,
  );
});
