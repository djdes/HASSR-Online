import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  documentPointVisible,
  documentVisibleWhere,
  journalEntryPointId,
  pointMismatch,
  visibleBuildingTargets,
} from "@/lib/document-point-access";

const A = { id: "point-a", name: "Точка А", address: null };
const B = { id: "point-b", name: "Точка Б", address: null };

// Контекст человека точки А: в шапке ему доступна только она.
const pointA = { enabled: true, buildings: [A] };
// Руководство на всю компанию (и офис): доступны все точки.
const company = { enabled: true, buildings: [A, B] };
const pointsOff = { enabled: false, buildings: [] };

test("документ чужой точки человеку точки не виден, своей и общий — видны", () => {
  assert.equal(documentPointVisible(pointA, "point-b"), false);
  assert.equal(documentPointVisible(pointA, "point-a"), true);
  assert.equal(documentPointVisible(pointA, null), true);
  assert.equal(documentPointVisible(pointA, undefined), true);
});

test("руководство на всю компанию видит документы всех точек", () => {
  assert.equal(documentPointVisible(company, "point-a"), true);
  assert.equal(documentPointVisible(company, "point-b"), true);
});

test("точки выключены — без ограничения", () => {
  assert.equal(documentPointVisible(pointsOff, "point-b"), true);
  assert.deepEqual(documentVisibleWhere(pointsOff), {});
});

test("where документов: общие и точки человека", () => {
  assert.deepEqual(documentVisibleWhere(pointA), {
    OR: [{ buildingId: null }, { buildingId: { in: ["point-a"] } }],
  });
});

test("создание разом — только для доступных точек", () => {
  assert.deepEqual(visibleBuildingTargets(["point-a", "point-b"], pointA), ["point-a"]);
  assert.deepEqual(visibleBuildingTargets(["point-a", "point-b"], company), ["point-a", "point-b"]);
  assert.deepEqual(visibleBuildingTargets([null], pointsOff), [null]);
});

test("точка записи журнала: цех, без цеха — цех оборудования", () => {
  assert.equal(journalEntryPointId({ area: { buildingId: "point-a" } }), "point-a");
  assert.equal(journalEntryPointId({ area: null, equipment: { area: { buildingId: "point-b" } } }), "point-b");
  // Общий цех — запись видна на всех точках (как в списке).
  assert.equal(journalEntryPointId({ area: { buildingId: null }, equipment: { area: { buildingId: "point-b" } } }), null);
  assert.equal(journalEntryPointId({ area: null, equipment: null }), null);
});

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === "route.ts" ? [path] : [];
  });
}

test("каждый маршрут документа по id проверяет точку документа", () => {
  const files = routeFiles(join(process.cwd(), "src", "app", "api", "journal-documents", "[id]"));
  assert.ok(files.length >= 15, `маршрутов найдено: ${files.length}`);
  const missing = files.filter((file) => !readFileSync(file, "utf8").includes("canSeeDocumentPoint("));
  assert.deepEqual(missing, []);
});

test("страница документа, проверка и печать проверяют точку документа", () => {
  for (const file of [
    "src/app/(dashboard)/journals/[code]/documents/[docId]/page.tsx",
    "src/app/(dashboard)/journals/[code]/documents/[docId]/layout.tsx",
    "src/app/(dashboard)/journals/[code]/documents/[docId]/verify/page.tsx",
    "src/app/(dashboard)/journals/[code]/[entryId]/page.tsx",
    "src/app/api/print/jobs/route.ts",
    "src/app/api/journals/[id]/status/route.ts",
    "src/app/api/journals/cleaning/documents/[id]/room-scopes/route.ts",
  ]) {
    assert.ok(readFileSync(join(process.cwd(), file), "utf8").includes("canSeeDocumentPoint("), file);
  }
});

// Шапка: что выбрано. `resolveActiveBuilding` даёт те же поля.
const header = (active: typeof A, organizationView = false, buildings = [A, B]) => ({
  enabled: true,
  organizationView,
  activeBuildingId: active.id,
  activeBuilding: active,
  buildings,
});

test("объект точки А при выбранной в шапке точке Б — расхождение с переходом на А", () => {
  assert.deepEqual(pointMismatch(header(B), "point-a"), {
    pointId: "point-a",
    pointName: "Точка А",
    selectedId: "point-b",
    selectedName: "Точка Б",
    canSwitch: true,
  });
});

test("та же точка, общий объект, «Вся организация» и выключенные точки — расхождения нет", () => {
  assert.equal(pointMismatch(header(A), "point-a"), null);
  assert.equal(pointMismatch(header(B), null), null);
  assert.equal(pointMismatch(header(B), undefined), null);
  // Офис или пункт «Вся организация»: документы пишутся в активную точку, но человек смотрит на всю компанию.
  assert.equal(pointMismatch(header(B, true), "point-a"), null);
  assert.equal(
    pointMismatch({ enabled: false, organizationView: true, activeBuildingId: null, activeBuilding: null, buildings: [] }, "point-a"),
    null,
  );
});

test("точка объекта недоступна человеку — расхождение без перехода на неё", () => {
  assert.deepEqual(pointMismatch(header(B, false, [B]), "point-a"), {
    pointId: "point-a",
    pointName: null,
    selectedId: "point-b",
    selectedName: "Точка Б",
    canSwitch: false,
  });
});

test("страницы объектов точки показывают расхождение с шапкой", () => {
  for (const file of [
    "src/app/(dashboard)/journals/[code]/documents/[docId]/page.tsx",
    "src/app/(dashboard)/journals/[code]/documents/[docId]/layout.tsx",
    "src/app/(dashboard)/journals/[code]/documents/[docId]/verify/page.tsx",
    "src/app/(dashboard)/journals/[code]/[entryId]/page.tsx",
    "src/app/(dashboard)/settings/journals/paper/[id]/documents/[docId]/page.tsx",
    "src/app/(dashboard)/batches/[id]/page.tsx",
    "src/app/(dashboard)/capa/[id]/page.tsx",
    "src/app/(dashboard)/edo/[id]/page.tsx",
  ]) {
    assert.ok(readFileSync(join(process.cwd(), file), "utf8").includes("findPointMismatch("), file);
  }
});
