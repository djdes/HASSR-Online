import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PAPER_POINT_REQUIRED,
  paperDocumentBuilding,
  paperDocumentsListWhere,
  paperDocumentVisibleWhere,
} from "@/lib/paper-journal-point";

/** Бумажные журналы по точкам (владелец 2026-11-01: «бумажные привязывай к точкам»). */
const read = (path: string) => readFileSync(path, "utf8");

const office = { id: "office", name: "Офис", address: null, kind: "office" };
const pointA = { id: "a", name: "Точка А", address: null, kind: "point" };
const pointB = { id: "b", name: "Точка Б", address: null, kind: "point" };

function context(over: Partial<Parameters<typeof paperDocumentBuilding>[0]>) {
  return {
    enabled: true,
    organizationView: false,
    activeBuildingId: "a",
    activeBuilding: pointA,
    buildings: [office, pointA, pointB],
    ...over,
  } as Parameters<typeof paperDocumentBuilding>[0];
}

test("новый документ — точке из шапки; «Вся организация» без офиса — выбрать точку", () => {
  assert.deepEqual(paperDocumentBuilding(context({})), { buildingId: "a" });
  // Офис — уровень организации: документ офиса, как у электронных журналов.
  assert.deepEqual(
    paperDocumentBuilding(context({ organizationView: true, activeBuildingId: "office", activeBuilding: office })),
    { buildingId: "office" },
  );
  assert.deepEqual(
    paperDocumentBuilding(context({ organizationView: true, buildings: [pointA, pointB] })),
    { error: PAPER_POINT_REQUIRED },
  );
  // Точки выключены — общий документ, как раньше.
  assert.deepEqual(paperDocumentBuilding(context({ enabled: false })), { buildingId: null });
});

test("список: на точке — её и общие, на уровне организации — все доступные", () => {
  assert.deepEqual(paperDocumentsListWhere(context({})), { OR: [{ buildingId: "a" }, { buildingId: null }] });
  assert.deepEqual(
    paperDocumentsListWhere(context({ organizationView: true, activeBuildingId: "office", activeBuilding: office })),
    { OR: [{ buildingId: null }, { buildingId: { in: ["office", "a", "b"] } }] },
  );
  assert.deepEqual(paperDocumentsListWhere(context({ enabled: false })), {});
  // Руководитель точки А: документ точки Б по ссылке не откроется.
  assert.deepEqual(paperDocumentVisibleWhere(context({ buildings: [pointA] })), {
    OR: [{ buildingId: null }, { buildingId: { in: ["a"] } }],
  });
});

test("маршруты и страницы бумажных журналов проверяют точку", () => {
  const list = read("src/app/api/settings/journals/paper/[id]/documents/route.ts");
  assert.match(list, /journalId: id, \.\.\.paperDocumentsListWhere\(context\)/);
  assert.match(list, /paperDocumentBuilding\(await loadBuildingContext\(session\)\)/);
  assert.match(list, /buildingId: place\.buildingId/);
  const one = read("src/app/api/settings/journals/paper/[id]/documents/[docId]/route.ts");
  assert.equal(one.match(/\.\.\.paperDocumentVisibleWhere\(await loadBuildingContext\(session\)\)/g)?.length, 3, "GET, PUT и DELETE");
  const page = read("src/app/(dashboard)/settings/journals/paper/[id]/documents/[docId]/page.tsx");
  assert.match(page, /\.\.\.paperDocumentVisibleWhere\(await loadBuildingContext\(session\)\)/);
  assert.match(page, /pointRowsWhere\(await documentRowsPointId\(organizationId, document\.buildingId\)\)\.staff/);
  assert.match(read("src/app/(dashboard)/settings/journals/paper/[id]/page.tsx"), /await visibleStaffWhere\(session\)/);
  assert.match(read("prisma/schema.prisma"), /model PaperJournalDocument \{[\s\S]*?buildingId\s+String\?[\s\S]*?onDelete: SetNull/);
});
