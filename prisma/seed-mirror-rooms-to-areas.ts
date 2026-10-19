/**
 * Idempotent backfill: для каждого Room без матчащего Area по имени —
 * создаём Area. Запускается на каждый deploy чтобы существующие
 * организации (созданные ДО auto-mirror логики в /api/settings/rooms)
 * получили цеха в /settings/areas без ручной работы.
 *
 * Не трогает: Areas уже существующие; Rooms которые имеют матчащий
 * Area по name. Дубликаты не создаём.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // Все организации с Building+Rooms
  const orgs = await prisma.organization.findMany({
    select: {
      id: true,
      buildings: {
        select: {
          id: true,
          rooms: { select: { id: true, name: true } },
        },
      },
      areas: { select: { name: true } },
    },
  });

  let totalCreated = 0;
  for (const org of orgs) {
    const existingAreaNames = new Set(org.areas.map((a) => a.name));
    // Название помещения → точки, где оно есть (2026-10-17: цех знает точку).
    const roomBuildings = new Map<string, Set<string>>();
    for (const b of org.buildings) {
      for (const r of b.rooms) {
        const set = roomBuildings.get(r.name) ?? new Set<string>();
        set.add(b.id);
        roomBuildings.set(r.name, set);
      }
    }
    const missingAreas = [...roomBuildings.keys()].filter(
      (name) => !existingAreaNames.has(name),
    );
    for (const name of missingAreas) {
      // Помещение в одной точке — цех сразу её; в нескольких — без точки
      // (то же правило, что scripts/backfill-area-building.ts).
      const points = [...(roomBuildings.get(name) ?? [])];
      await prisma.area.create({
        data: {
          organizationId: org.id,
          name,
          buildingId: points.length === 1 ? points[0] : null,
          description: "Авто-создан backfill'ом из Помещения",
        },
      }).catch(() => {
        // Idempotent — race-condition unique-конфликт игнорируем.
      });
      totalCreated += 1;
    }
  }
  console.log(
    `[seed-mirror-rooms-to-areas] orgs=${orgs.length} areas_created=${totalCreated}`,
  );
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
