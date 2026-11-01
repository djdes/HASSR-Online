import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { objectPointError, SHARED_OBJECT_OFFICE_ERROR } from "@/lib/point-objects";
import { BUILDING_OUT_OF_SCOPE_ERROR } from "@/lib/point-scope";

/**
 * Журнал холодильников точки и справочник «Оборудование» (2026-11-01,
 * «точка видит только своё»): через журнал точки А меняли холодильник
 * точки Б — `syncEquipmentDirectoryItem` искал связанную запись по всей
 * организации. Вместо базы — подменная Prisma в `globalThis.prisma` (её
 * берёт `src/lib/db.ts`), как в today-compliance-close-day.test.ts.
 */

type AreaRow = { id: string; organizationId: string; buildingId: string | null; name: string };
type EquipmentRow = { id: string; areaId: string; name: string; tempMin: number | null; tempMax: number | null };

const ORG = "org-1";

const areas: AreaRow[] = [
  { id: "area-a", organizationId: ORG, buildingId: "point-a", name: "Кухня А" },
  { id: "area-b", organizationId: ORG, buildingId: "point-b", name: "Кухня Б" },
  { id: "area-shared", organizationId: ORG, buildingId: null, name: "Склад" },
  { id: "area-x", organizationId: "org-2", buildingId: "point-x", name: "Чужая" },
];

let equipment: EquipmentRow[] = [];
let updates: string[] = [];
let created: Array<{ areaId: string; name: string }> = [];

beforeEach(() => {
  equipment = [
    { id: "fridge-a", areaId: "area-a", name: "Холодильник А", tempMin: 2, tempMax: 6 },
    { id: "fridge-b", areaId: "area-b", name: "Холодильник Б", tempMin: 2, tempMax: 6 },
    { id: "fridge-shared", areaId: "area-shared", name: "Общий", tempMin: 2, tempMax: 6 },
    { id: "fridge-x", areaId: "area-x", name: "Чужой", tempMin: 2, tempMax: 6 },
  ];
  updates = [];
  created = [];
});

type EquipmentWhere = {
  id?: string;
  area?: { organizationId?: string };
  OR?: Array<{ area: { buildingId: string | null } }>;
};

function matches(row: EquipmentRow, where: EquipmentWhere): boolean {
  const area = areas.find((item) => item.id === row.areaId)!;
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.area?.organizationId !== undefined && area.organizationId !== where.area.organizationId) return false;
  if (where.OR && !where.OR.some((condition) => condition.area.buildingId === area.buildingId)) return false;
  return true;
}

const fakePrisma = {
  equipment: {
    findFirst: async ({ where }: { where: EquipmentWhere }) => {
      const row = equipment.find((item) => matches(item, where));
      if (!row) return null;
      const area = areas.find((item) => item.id === row.areaId)!;
      return { ...row, area: { buildingId: area.buildingId } };
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<EquipmentRow> }) => {
      updates.push(where.id);
      equipment = equipment.map((row) => (row.id === where.id ? { ...row, ...data } : row));
      return { id: where.id };
    },
    create: async ({ data }: { data: { areaId: string; name: string } }) => {
      created.push({ areaId: data.areaId, name: data.name });
      return { id: `new-${created.length}` };
    },
  },
  area: {
    findFirst: async ({ where }: { where: { organizationId: string; buildingId?: string | null } }) =>
      areas.find(
        (area) =>
          area.organizationId === where.organizationId &&
          (where.buildingId === undefined || area.buildingId === where.buildingId),
      ) ?? null,
    create: async () => ({ id: "area-created" }),
  },
  building: { findMany: async () => [] },
};

(globalThis as unknown as { prisma: unknown }).prisma = fakePrisma;

const row = (sourceEquipmentId: string | null, name: string, min: number | null = 2, max: number | null = 6) => ({
  id: "row-1",
  sourceEquipmentId,
  name,
  min,
  max,
});

// Руководитель точки А — как `pointError` маршрута.
const pointManagerA = (buildingId: string | null) => objectPointError({ pointScope: ["point-a"] }, buildingId);

test("через журнал точки А холодильник точки Б не меняется — 404, копия не заводится", async () => {
  const { syncEquipmentDirectoryItem } = await import("./equipment-directory");
  const result = await syncEquipmentDirectoryItem(ORG, row("fridge-b", "X", -50, 50), "point-a");
  assert.equal(result.ok, false);
  assert.equal(result.ok ? 0 : result.status, 404);
  assert.deepEqual(updates, []);
  assert.deepEqual(created, []);
  assert.equal(equipment.find((item) => item.id === "fridge-b")?.name, "Холодильник Б");
});

test("свой и общий холодильник из журнала точки правятся", async () => {
  const { syncEquipmentDirectoryItem } = await import("./equipment-directory");
  assert.equal((await syncEquipmentDirectoryItem(ORG, row("fridge-a", "Витрина"), "point-a")).ok, true);
  assert.equal((await syncEquipmentDirectoryItem(ORG, row("fridge-shared", "Склад 2"), "point-a")).ok, true);
  assert.deepEqual(updates, ["fridge-a", "fridge-shared"]);
  assert.equal(equipment.find((item) => item.id === "fridge-a")?.name, "Витрина");
});

test("руководитель точки не меняет общий и чужой холодильник — 403", async () => {
  const { syncEquipmentDirectoryItem } = await import("./equipment-directory");
  const shared = await syncEquipmentDirectoryItem(ORG, row("fridge-shared", "Склад 2"), "point-a", pointManagerA);
  assert.deepEqual(shared, { ok: false, error: SHARED_OBJECT_OFFICE_ERROR, status: 403 });
  // Документ без точки: ищем по всей организации, но чужую точку руководителю не даём.
  const foreign = await syncEquipmentDirectoryItem(ORG, row("fridge-b", "X"), null, pointManagerA);
  assert.deepEqual(foreign, { ok: false, error: BUILDING_OUT_OF_SCOPE_ERROR, status: 403 });
  assert.deepEqual(updates, []);
  const own = await syncEquipmentDirectoryItem(ORG, row("fridge-a", "Витрина"), "point-a", pointManagerA);
  assert.equal(own.ok, true);
  assert.deepEqual(updates, ["fridge-a"]);
});

test("строка без изменений сохраняется без правки справочника и без отказа", async () => {
  const { syncEquipmentDirectoryItem } = await import("./equipment-directory");
  const result = await syncEquipmentDirectoryItem(ORG, row("fridge-shared", "Общий"), "point-a", pointManagerA);
  assert.equal(result.ok, true);
  assert.deepEqual(updates, []);
});

test("удалённая или чужой организации запись заводится заново в цехе точки", async () => {
  const { syncEquipmentDirectoryItem } = await import("./equipment-directory");
  const gone = await syncEquipmentDirectoryItem(ORG, row("deleted-id", "Новый"), "point-a");
  assert.equal(gone.ok && gone.item.sourceEquipmentId, "new-1");
  const otherOrg = await syncEquipmentDirectoryItem(ORG, row("fridge-x", "Новый 2"), "point-a");
  assert.equal(otherOrg.ok && otherOrg.item.sourceEquipmentId, "new-2");
  assert.deepEqual(created.map((item) => item.areaId), ["area-a", "area-a"]);
  assert.deepEqual(updates, []);
});

test("документ без точки у руководства компании — как раньше: любой холодильник организации", async () => {
  const { syncEquipmentDirectoryItem } = await import("./equipment-directory");
  const result = await syncEquipmentDirectoryItem(ORG, row("fridge-b", "Холодильник Б2"), null);
  assert.equal(result.ok, true);
  assert.deepEqual(updates, ["fridge-b"]);
});
