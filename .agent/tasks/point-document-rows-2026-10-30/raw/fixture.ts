/**
 * e2e-БД (НЕ прод): «старые» документы точки А, собранные до разделения по
 * точкам, — холодильники обеих точек и сотрудники обеих точек.
 *
 * node --import tsx .agent/tasks/point-document-rows-2026-10-30/raw/fixture.ts
 */
import { readFileSync, writeFileSync } from "node:fs";

import { db } from "@/lib/db";

const DIR = ".agent/tasks/point-document-rows-2026-10-30/raw";

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("localhost:5432/wesetup_e2e")) throw new Error("e2e only");
  const seed = JSON.parse(readFileSync(".agent/tasks/journals-point-mode-2026-10-28/raw/seed.json", "utf8"));
  const orgId: string = seed.orgId;
  await db.organization.update({ where: { id: orgId }, data: { perLocationJournals: true } });
  const buildings = await db.building.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
  const a = buildings.find((b) => b.name === "Точка А");
  const b = buildings.find((b) => b.name === "Точка Б");
  if (!a || !b) throw new Error(`нет точек А/Б: ${buildings.map((x) => x.name).join(", ")}`);

  // Прошлый прогон — убрать.
  await db.journalDocument.deleteMany({ where: { organizationId: orgId, title: { startsWith: "Проверка 30.10" } } });
  await db.equipment.deleteMany({ where: { area: { organizationId: orgId }, name: { startsWith: "ПРОВЕРКА" } } });
  await db.user.deleteMany({ where: { organizationId: orgId, email: { startsWith: "check-3010-" } } });

  const areaFor = async (buildingId: string, name: string) =>
    (await db.area.findFirst({ where: { organizationId: orgId, buildingId }, select: { id: true } })) ??
    (await db.area.create({ data: { organizationId: orgId, buildingId, name }, select: { id: true } }));
  const areaA = await areaFor(a.id, "Цех точки А");
  const areaB = await areaFor(b.id, "Цех точки Б");
  const fridgeA = await db.equipment.create({ data: { areaId: areaA.id, name: "ПРОВЕРКА ШХ-А (точка А)", type: "refrigerator", tempMin: 2, tempMax: 6 } });
  const fridgeB = await db.equipment.create({ data: { areaId: areaB.id, name: "ПРОВЕРКА ШХ-Б (точка Б)", type: "refrigerator", tempMin: 2, tempMax: 6 } });

  const mkUser = (key: string, name: string, buildingIds: string[]) =>
    db.user.create({
      data: { organizationId: orgId, email: `check-3010-${key}@verify.local`, name, role: "cook", passwordHash: "x", buildingIds },
      select: { id: true },
    });
  const anna = await mkUser("a", "Проверка Анна (точка А)", [a.id]);
  const boris = await mkUser("b", "Проверка Борис (точка Б)", [b.id]);
  const vera = await mkUser("all", "Проверка Вера (все точки)", []);
  const gleb = await mkUser("bqr", "Проверка Глеб (точка Б, отметился по QR)", [b.id]);

  const coldTemplate = await db.journalTemplate.findFirstOrThrow({ where: { code: "cold_equipment_control" }, select: { id: true } });
  const hygieneTemplate = await db.journalTemplate.findFirstOrThrow({ where: { code: "hygiene" }, select: { id: true } });
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 16));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // Документы других точек в этой организации на этот период — закрыть, чтобы
  // список журнала открывал наш.
  const cold = await db.journalDocument.create({
    data: {
      organizationId: orgId,
      templateId: coldTemplate.id,
      buildingId: a.id,
      title: "Проверка 30.10 · холодильники точки А",
      status: "active",
      dateFrom: from,
      dateTo: to,
      config: {
        skipWeekends: false,
        equipment: [
          { id: "row-a", sourceEquipmentId: fridgeA.id, name: fridgeA.name, min: 2, max: 6 },
          { id: "row-b", sourceEquipmentId: fridgeB.id, name: fridgeB.name, min: 2, max: 6 },
        ],
      } as never,
    },
    select: { id: true },
  });
  await db.journalDocumentEntry.create({
    data: { documentId: cold.id, employeeId: anna.id, date: today, data: { temperatures: { "row-a": 4, "row-b": 5 } } as never },
  });

  const hygiene = await db.journalDocument.create({
    data: {
      organizationId: orgId,
      templateId: hygieneTemplate.id,
      buildingId: a.id,
      title: "Проверка 30.10 · гигиена точки А",
      status: "active",
      dateFrom: from,
      dateTo: to,
    },
    select: { id: true },
  });
  for (const user of [anna, boris, vera]) {
    await db.journalDocumentEntry.create({ data: { documentId: hygiene.id, employeeId: user.id, date: today, data: { status: "healthy", temperatureAbove37: false } as never } });
  }
  await db.journalDocumentEntry.create({
    data: { documentId: hygiene.id, employeeId: gleb.id, date: today, data: { status: "healthy", temperatureAbove37: false, source: "qr", confirmedAt: now.toISOString() } as never },
  });

  const out = { orgId, manager: seed.manager, pointA: a.id, pointB: b.id, coldId: cold.id, hygieneId: hygiene.id, fridgeA: fridgeA.name, fridgeB: fridgeB.name };
  writeFileSync(`${DIR}/fixture.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().finally(() => db.$disconnect());
