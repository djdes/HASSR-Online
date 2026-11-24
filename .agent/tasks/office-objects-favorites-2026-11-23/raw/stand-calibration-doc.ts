/**
 * Стенд (не для прода): временный документ «График поверки» на первом объекте
 * стенда — чтобы проверить «Сделать копию» на «Выберите объект»
 * (ui-check-third-fixes.cjs). `create` заводит его, `delete` убирает его и
 * все документы поверки стенда, созданные после него.
 * Запуск: npx tsx .agent/tasks/office-objects-favorites-2026-11-23/raw/stand-calibration-doc.ts create|delete
 */
import "dotenv/config";
import { db } from "../../../../src/lib/db";
import { isOfficeBuilding } from "../../../../src/lib/building-scope";
import { normalizeEquipmentCalibrationConfig } from "../../../../src/lib/equipment-calibration-document";

const TITLE = "График поверки (стенд: проверка копии)";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("stand only");
  const mode = process.argv[2];
  const org = await db.organization.findFirst({ where: { name: "Стенд: Кафе «Берёзка»" }, select: { id: true } });
  if (!org) throw new Error("stand not found: run stand-seed.ts first");
  const template = await db.journalTemplate.findFirst({ where: { code: "equipment_calibration" }, select: { id: true } });
  if (!template) throw new Error("equipment_calibration template missing");
  if (mode === "create") {
    const buildings = await db.building.findMany({
      where: { organizationId: org.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, kind: true, name: true },
    });
    const point = buildings.find((building) => !isOfficeBuilding(building));
    if (!point) throw new Error("no object on the stand");
    const year = new Date().getUTCFullYear();
    const created = await db.journalDocument.create({
      data: {
        organizationId: org.id,
        templateId: template.id,
        title: TITLE,
        buildingId: point.id,
        dateFrom: new Date(`${year}-01-01T00:00:00.000Z`),
        dateTo: new Date(`${year}-12-31T00:00:00.000Z`),
        config: normalizeEquipmentCalibrationConfig({ year, documentDate: `${year}-01-10`, rows: [] }) as object,
      },
      select: { id: true, createdAt: true },
    });
    console.log(JSON.stringify({ created: created.id, point: point.name }));
    return;
  }
  if (mode === "delete") {
    const mine = await db.journalDocument.findFirst({ where: { organizationId: org.id, templateId: template.id, title: TITLE }, select: { createdAt: true } });
    if (!mine) {
      console.log(JSON.stringify({ deleted: 0 }));
      return;
    }
    const removed = await db.journalDocument.deleteMany({
      where: { organizationId: org.id, templateId: template.id, createdAt: { gte: mine.createdAt } },
    });
    console.log(JSON.stringify({ deleted: removed.count }));
    return;
  }
  throw new Error("usage: create|delete");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
