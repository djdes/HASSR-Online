/**
 * e2e-БД (НЕ прод): своя организация с точками А и Б и «старыми» документами
 * точки А, собранными до разделения по точкам: график генуборок с
 * помещениями обеих точек, журнал уборки с уборщиками обеих точек.
 *
 * node --import tsx .agent/tasks/point-docs-rows-2026-10-31/raw/fixture.ts
 */
import bcrypt from "bcryptjs";
import { readFileSync, writeFileSync } from "node:fs";

import { db } from "@/lib/db";

const DIR = ".agent/tasks/point-docs-rows-2026-10-31/raw";

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("localhost:5432/wesetup_e2e")) throw new Error("e2e only");
  // Шаблон организации — тестовая организация прошлых проверок (тариф,
  // онбординг), чтобы кабинет открывался без экранов настройки.
  const seed = JSON.parse(readFileSync(".agent/tasks/journals-point-mode-2026-10-28/raw/seed.json", "utf8"));
  const template = await db.organization.findUniqueOrThrow({ where: { id: seed.orgId } });
  const { id: _id, createdAt: _c, updatedAt: _u, serviceCode: _s, externalApiToken: _t, badgeCode: _b, ...rest } = template as Record<string, unknown>;
  void _id; void _c; void _u; void _s; void _t; void _b;

  const previous = await db.organization.findMany({ where: { name: "Проверка 31.10 · журналы точек" }, select: { id: true } });
  for (const org of previous) {
    await db.journalDocument.deleteMany({ where: { organizationId: org.id } });
    await db.user.deleteMany({ where: { organizationId: org.id } });
    await db.organization.delete({ where: { id: org.id } }).catch(() => undefined);
  }

  const org = await db.organization.create({
    data: { ...(rest as object), name: "Проверка 31.10 · журналы точек", perLocationJournals: true } as never,
    select: { id: true },
  });
  const a = await db.building.create({ data: { organizationId: org.id, name: "Точка А", sortOrder: 1 }, select: { id: true } });
  const b = await db.building.create({ data: { organizationId: org.id, name: "Точка Б", sortOrder: 2 }, select: { id: true } });
  const roomA = await db.room.create({ data: { buildingId: a.id, name: "Кухня точки А" }, select: { id: true } });
  const roomB = await db.room.create({ data: { buildingId: b.id, name: "Кухня точки Б" }, select: { id: true } });
  const roomB2 = await db.room.create({ data: { buildingId: b.id, name: "Склад точки Б" }, select: { id: true } });
  const areaA = await db.area.create({ data: { organizationId: org.id, buildingId: a.id, name: "Цех точки А" }, select: { id: true } });
  const areaB = await db.area.create({ data: { organizationId: org.id, buildingId: b.id, name: "Цех точки Б" }, select: { id: true } });
  const fridgeA = await db.equipment.create({ data: { areaId: areaA.id, name: "ШХ точки А", type: "refrigerator", tempMin: 2, tempMax: 6 }, select: { id: true } });
  await db.equipment.create({ data: { areaId: areaB.id, name: "ШХ точки Б", type: "refrigerator", tempMin: 2, tempMax: 6 } });

  const passwordHash = await bcrypt.hash("Verify-2026!", 10);
  const manager = await db.user.create({
    data: { organizationId: org.id, email: `manager-${org.id}@verify.local`, name: "Руководитель проверки", role: "manager", passwordHash, isActive: true, buildingIds: [] } as never,
    select: { id: true, email: true },
  });
  const mkUser = (key: string, name: string, buildingIds: string[]) =>
    db.user.create({
      data: { organizationId: org.id, email: `${key}-${org.id}@verify.local`, name, role: "cook", passwordHash, isActive: true, buildingIds } as never,
      select: { id: true },
    });
  const anna = await mkUser("anna", "Анна точки А", [a.id]);
  const boris = await mkUser("boris", "Борис точки Б", [b.id]);
  const vera = await mkUser("vera", "Вера все точки", []);

  const tpl = async (code: string) => (await db.journalTemplate.findFirstOrThrow({ where: { code }, select: { id: true } })).id;
  const now = new Date();
  const year = now.getUTCFullYear();
  const monthFrom = new Date(Date.UTC(year, now.getUTCMonth(), 1));
  const monthTo = new Date(Date.UTC(year, now.getUTCMonth() + 1, 0));

  const general = await db.journalDocument.create({
    data: {
      organizationId: org.id,
      templateId: await tpl("general_cleaning"),
      buildingId: a.id,
      title: "График ген. уборок точки А",
      status: "active",
      dateFrom: new Date(Date.UTC(year, 0, 1)),
      dateTo: new Date(Date.UTC(year, 11, 31)),
      config: {
        year,
        documentDate: `${year}-01-01`,
        approveRole: "Управляющий",
        approveEmployee: "",
        responsibleRole: "Повар",
        responsibleEmployee: "",
        rows: [
          { id: "g-a", roomId: roomA.id, roomName: "Кухня точки А", cleanings: [] },
          { id: "g-b", roomId: roomB.id, roomName: "Кухня точки Б", cleanings: [] },
          { id: "g-b2", roomId: roomB2.id, roomName: "Склад точки Б", cleanings: [{ id: `p:${year}-02-06`, planned: `${year}-02-06`, done: `${year}-02-06` }] },
        ],
      } as never,
    },
    select: { id: true },
  });

  const cleaning = await db.journalDocument.create({
    data: {
      organizationId: org.id,
      templateId: await tpl("cleaning"),
      buildingId: a.id,
      title: "Уборка точки А",
      status: "active",
      dateFrom: monthFrom,
      dateTo: monthTo,
      config: {
        cleaningMode: "rooms",
        selectedRoomIds: [roomA.id, roomB.id],
        selectedCleanerUserIds: [anna.id, boris.id, vera.id],
        cleaningResponsibles: [
          { id: "c1", kind: "cleaning", title: "Уборщица", userId: anna.id, userName: "Анна точки А", code: "С1" },
          { id: "c2", kind: "cleaning", title: "Уборщица", userId: boris.id, userName: "Борис точки Б", code: "С2" },
        ],
        controlResponsibles: [{ id: "k1", kind: "control", title: "Контролёр", userId: boris.id, userName: "Борис точки Б", code: "К1" }],
      } as never,
    },
    select: { id: true },
  });

  const cold = await db.journalDocument.create({
    data: {
      organizationId: org.id,
      templateId: await tpl("cold_equipment_control"),
      buildingId: a.id,
      title: "Холодильники точки А",
      status: "active",
      dateFrom: monthFrom,
      dateTo: monthTo,
      config: { skipWeekends: false, equipment: [{ id: "row-a", sourceEquipmentId: fridgeA.id, name: "ШХ точки А", min: 2, max: 6 }] } as never,
    },
    select: { id: true },
  });

  const out = {
    orgId: org.id,
    manager: manager.email,
    pointA: a.id,
    pointB: b.id,
    generalId: general.id,
    cleaningId: cleaning.id,
    coldId: cold.id,
    users: { anna: anna.id, boris: boris.id, vera: vera.id },
    rooms: { roomA: roomA.id, roomB: roomB.id, roomB2: roomB2.id },
  };
  writeFileSync(`${DIR}/fixture.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().finally(() => db.$disconnect());
