/**
 * Однократное заполнение `Area.buildingId` (2026-10-17, план 4.3:
 * «точка → помещения → оборудование»).
 *
 * Правило — существующее зеркало «помещение ↔ цех по названию»
 * (`planAreaBuildingBackfill`, src/lib/area-building.ts, с тестами):
 *   • одноимённое помещение ровно в одной точке → эта точка;
 *   • одноимённые помещения в нескольких точках → не трогаем;
 *   • у организации одна точка → все её цеха без точки;
 *   • заполненный `buildingId` не меняется — повторный запуск пуст.
 *
 * Запуск:
 *   npx tsx scripts/backfill-area-building.ts          # сухой прогон, только план
 *   npx tsx scripts/backfill-area-building.ts --apply  # записать
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

import { planAreaBuildingBackfill } from "../src/lib/area-building";

const apply = process.argv.includes("--apply");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const [areas, rooms, buildings] = await Promise.all([
    prisma.area.findMany({
      where: { buildingId: null },
      select: { id: true, organizationId: true, name: true, buildingId: true },
      orderBy: [{ organizationId: "asc" }, { name: "asc" }],
    }),
    prisma.room.findMany({
      select: { name: true, buildingId: true, building: { select: { organizationId: true } } },
    }),
    prisma.building.findMany({ select: { id: true, organizationId: true } }),
  ]);

  const plan = planAreaBuildingBackfill({
    areas,
    rooms: rooms.map((room) => ({
      organizationId: room.building.organizationId,
      buildingId: room.buildingId,
      name: room.name,
    })),
    buildings,
  });

  const areaName = new Map(areas.map((area) => [area.id, area.name]));
  const byReason = (reason: string) => plan.skipped.filter((item) => item.reason === reason).length;
  console.log(
    `[backfill-area-building] mode=${apply ? "apply" : "dry-run"} areas_without_building=${areas.length} ` +
      `assign=${plan.assign.length} (room-name=${plan.assign.filter((a) => a.reason === "room-name").length}, ` +
      `single-building=${plan.assign.filter((a) => a.reason === "single-building").length}) ` +
      `skip_ambiguous=${byReason("ambiguous")} skip_no_match=${byReason("no-match")} skip_no_buildings=${byReason("no-buildings")}`,
  );
  for (const item of plan.assign) {
    console.log(`  assign area=${item.areaId} «${areaName.get(item.areaId)}» → building=${item.buildingId} (${item.reason})`);
  }
  for (const item of plan.skipped.filter((entry) => entry.reason === "ambiguous")) {
    console.log(`  skip   area=${item.areaId} «${areaName.get(item.areaId)}» — помещения с таким названием в нескольких точках`);
  }
  if (!apply) {
    console.log("[backfill-area-building] dry-run: ничего не записано. Запись: --apply");
    return;
  }

  let updated = 0;
  for (const item of plan.assign) {
    // `buildingId: null` в условии — защита от гонки: цех, которому точку
    // уже поставили (окно цеха, зеркало помещения), не перезаписываем.
    const result = await prisma.area.updateMany({
      where: { id: item.areaId, buildingId: null },
      data: { buildingId: item.buildingId },
    });
    updated += result.count;
  }
  console.log(`[backfill-area-building] updated=${updated}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
