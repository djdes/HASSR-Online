/**
 * Локальная копия (НЕ прод): база wesetup_iso в контейнере проверки.
 * Организация «ISO Точки»: офис + точки А и Б, по цеху, холодильнику и помещению
 * на точку, общий цех; повара А и Б, руководитель точки А, руководство.
 * Вторая организация «ISO Чужая» — для проверок между организациями.
 *
 * DATABASE_URL=…/wesetup_iso node --import tsx .agent/tasks/point-isolation-audit-2026-11-01/raw/fixture.ts
 */
import bcrypt from "bcryptjs";
import { writeFileSync } from "node:fs";

import { db } from "@/lib/db";
import { ensureDocumentsFor } from "@/lib/journal-auto-create";

const DIR = ".agent/tasks/point-isolation-audit-2026-11-01/raw";
const PASSWORD = "Verify-2026!";
const CODES = [
  "hygiene",
  "health_check",
  "cold_equipment_control",
  "climate_control",
  "cleaning",
  "general_cleaning",
  "finished_product",
  "perishable_rejection",
  "fryer_oil",
  "equipment_cleaning",
  "uv_lamp_runtime",
];

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("localhost:5432/wesetup_iso")) throw new Error("wesetup_iso only");
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const org = await db.organization.create({
    data: { name: "ISO Точки", type: "restaurant", perLocationJournals: true },
    select: { id: true },
  });
  const office = await db.building.create({ data: { organizationId: org.id, name: "Офис", kind: "office", sortOrder: 0 } });
  const pointA = await db.building.create({ data: { organizationId: org.id, name: "Точка А", address: "ул. Альфа, 1", sortOrder: 1 } });
  const pointB = await db.building.create({ data: { organizationId: org.id, name: "Точка Б", address: "ул. Бета, 2", sortOrder: 2 } });

  const cookPos = await db.jobPosition.create({ data: { organizationId: org.id, categoryKey: "staff", name: "Повар", sortOrder: 1 } });
  const mgrPos = await db.jobPosition.create({ data: { organizationId: org.id, categoryKey: "management", name: "Управляющий", sortOrder: 0 } });

  const user = (email: string, name: string, role: string, buildingIds: string[], jobPositionId: string) =>
    db.user.create({
      data: { organizationId: org.id, email, name, role, buildingIds, jobPositionId, passwordHash, isActive: true, journalAccessMigrated: false } as never,
      select: { id: true, email: true },
    });
  const owner = await user("iso-owner@verify.local", "Владелец ИСО", "owner", [], mgrPos.id);
  const officeMgr = await user("iso-office@verify.local", "Офис Менеджер", "manager", [office.id], mgrPos.id);
  const headA = await user("iso-head-a@verify.local", "Руководитель Альфа", "manager", [pointA.id], mgrPos.id);
  const headB = await user("iso-head-b@verify.local", "Руководитель Бета", "manager", [pointB.id], mgrPos.id);
  const cookA = await user("iso-cook-a@verify.local", "Повар Альфа", "cook", [pointA.id], cookPos.id);
  const cookB = await user("iso-cook-b@verify.local", "Повар Бета", "cook", [pointB.id], cookPos.id);

  const areaA = await db.area.create({ data: { organizationId: org.id, name: "Цех Альфа", buildingId: pointA.id } });
  const areaB = await db.area.create({ data: { organizationId: org.id, name: "Цех Бета", buildingId: pointB.id } });
  const areaShared = await db.area.create({ data: { organizationId: org.id, name: "Общий склад" } });
  const fridgeA = await db.equipment.create({ data: { areaId: areaA.id, name: "ШХ Альфа", type: "refrigerator", tempMin: 2, tempMax: 6 } });
  const fridgeB = await db.equipment.create({ data: { areaId: areaB.id, name: "ШХ Бета", type: "refrigerator", tempMin: 2, tempMax: 6 } });
  const roomA = await db.room.create({ data: { buildingId: pointA.id, name: "Зал Альфа" } });
  const roomB = await db.room.create({ data: { buildingId: pointB.id, name: "Зал Бета" } });

  const docs = await ensureDocumentsFor(db, {
    organizationId: org.id,
    templateCodes: CODES,
    buildingIds: [office.id, pointA.id, pointB.id],
  });

  // Вторая организация — без точек.
  const org2 = await db.organization.create({
    data: { name: "ISO Чужая", type: "restaurant", perLocationJournals: false },
    select: { id: true },
  });
  const org2Pos = await db.jobPosition.create({ data: { organizationId: org2.id, categoryKey: "management", name: "Директор", sortOrder: 0 } });
  const owner2 = await db.user.create({
    data: { organizationId: org2.id, email: "iso2-owner@verify.local", name: "Владелец Чужой", role: "owner", buildingIds: [], jobPositionId: org2Pos.id, passwordHash, isActive: true } as never,
    select: { id: true, email: true },
  });
  const area2 = await db.area.create({ data: { organizationId: org2.id, name: "Цех Чужой" } });
  const fridge2 = await db.equipment.create({ data: { areaId: area2.id, name: "ШХ Чужой", type: "refrigerator", tempMin: 2, tempMax: 6 } });
  const docs2 = await ensureDocumentsFor(db, { organizationId: org2.id, templateCodes: ["hygiene", "cold_equipment_control"], buildingIds: [null] });

  const docMap = async (organizationId: string, names: Record<string, string>) => {
    const rows = await db.journalDocument.findMany({
      where: { organizationId },
      select: { id: true, buildingId: true, template: { select: { code: true } } },
    });
    const out: Record<string, Record<string, string>> = {};
    for (const row of rows) {
      const key = row.buildingId ? (names[row.buildingId] ?? row.buildingId) : "shared";
      (out[row.template.code] ??= {})[key] = row.id;
    }
    return out;
  };
  const docIds = await docMap(org.id, { [office.id]: "office", [pointA.id]: "A", [pointB.id]: "B" });
  const docIds2 = await docMap(org2.id, {});

  const fixture = {
    password: PASSWORD,
    orgId: org.id,
    office: office.id,
    pointA: pointA.id,
    pointB: pointB.id,
    users: { owner, officeMgr, headA, headB, cookA, cookB },
    positions: { cook: cookPos.id, manager: mgrPos.id },
    areaA: areaA.id,
    areaB: areaB.id,
    areaShared: areaShared.id,
    fridgeA: fridgeA.id,
    fridgeB: fridgeB.id,
    roomA: roomA.id,
    roomB: roomB.id,
    docs: docIds,
    created: docs.filter((d) => d.created).length,
    org2: { orgId: org2.id, owner: owner2, area: area2.id, fridge: fridge2.id, docs: docIds2, created: docs2.filter((d) => d.created).length },
  };
  writeFileSync(`${DIR}/fixture.json`, JSON.stringify(fixture, null, 2));
  console.log(JSON.stringify(fixture, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
