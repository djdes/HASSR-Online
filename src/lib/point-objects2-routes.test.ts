import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Объекты и записи точки, вторая волна аудита (2026-11-01, «точка видит
 * только своё»): холодильник другой точки через журнал холодильников,
 * чек-лист помещения другой точки через документ уборки, цеха и подсказки
 * потерь, справочник оборудования общего документа и документа чужой точки.
 * Тест держит проверки на месте по тексту маршрутов.
 */
const read = (path: string) => readFileSync(path, "utf8");

const GUARDED: Array<[string, RegExp, number]> = [
  // C1: связанный холодильник — только точки документа или общий; руководитель точки — свой.
  ["src/lib/equipment-directory.ts", /area: \{ organizationId \}, \.\.\.equipmentBuildingWhere\(pointId\)/, 1],
  ["src/lib/equipment-directory.ts", /pointError\?\.\(linked\.area\.buildingId\)/, 1],
  ["src/app/api/journal-documents/[id]/cold-equipment/route.ts", /objectPointError\(session\.user, buildingId\)/, 1],
  [
    "src/app/api/journal-documents/[id]/cold-equipment/route.ts",
    /syncEquipmentDirectoryItem\(getActiveOrgId\(session\), \w+, pointId, pointError\)/,
    2,
  ],
  ["src/app/api/journal-documents/[id]/cold-equipment/route.ts", /if \(!synced\.ok\)/, 2],
  // C2: помещение — организации и точки документа; руководитель точки — своё.
  [
    "src/app/api/journals/cleaning/documents/[id]/room-scopes/route.ts",
    /where: \{ id: body\.roomId, building: \{ organizationId \} \}/,
    1,
  ],
  ["src/app/api/journals/cleaning/documents/[id]/room-scopes/route.ts", /room\.buildingId !== docPointId/, 1],
  [
    "src/app/api/journals/cleaning/documents/[id]/room-scopes/route.ts",
    /objectPointResponse\(auth\.session\.user, room\.buildingId\)/,
    1,
  ],
  // C3: потери — подсказки и цеха по точке, запись только в видимый цех.
  ["src/app/api/losses/product-suggest/route.ts", /getViewedPointId\(auth\.session\)/, 1],
  ["src/app/api/losses/product-suggest/route.ts", /\.\.\.lossPointWhere\(pointId, /, 1],
  ["src/app/(dashboard)/losses/new/page.tsx", /visibleObjectBuildingIds\(session\)/, 1],
  ["src/app/api/losses/route.ts", /objectVisibleToSession\(session, area\.buildingId\)/, 1],
  ["src/app/api/losses/route.ts", /area\.buildingId !== viewedPointId/, 1],
  // C7: справочник оборудования для окна документа.
  ["src/app/api/equipment/route.ts", /canSeeDocumentPoint\(session, document\.buildingId\)/, 1],
  ["src/app/api/equipment/route.ts", /visibleIds = pointId \? null : await visibleObjectBuildingIds\(session\)/, 1],
];

test("объекты и записи точки проверяют точку", () => {
  for (const [path, pattern, count] of GUARDED) {
    const found = read(path).match(new RegExp(pattern.source, "g"))?.length ?? 0;
    assert.ok(found >= count, `${path}: ожидалось ${count}× ${pattern}, найдено ${found}`);
  }
});

test("форма новой потери не берёт цеха всей организации без фильтра", () => {
  const page = read("src/app/(dashboard)/losses/new/page.tsx");
  assert.doesNotMatch(page, /where: \{ organizationId: getActiveOrgId\(session\) \}/);
  assert.match(page, /buildingId: \{ in: visibleIds \}/);
});
