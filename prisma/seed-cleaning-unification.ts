/**
 * Stage 1 backfill для cleaning-unification (см.
 * docs/superpowers/specs/2026-05-08-cleaning-unification.md).
 *
 * Раньше у каждого cleaning-документа в
 * `JournalDocument.config.rooms[]` (CleaningRoomItem) хранилось
 * `detergent`, `currentScope`, `generalScope`, `currentDays`,
 * `generalDays` — каждый раз дублировалось. Теперь Room (DB)
 * хранит это и читается оттуда напрямую. Этот скрипт:
 *
 *   1. Для каждой Organization берём активные cleaning-документы.
 *   2. Для каждой CleaningRoomItem в config.rooms[]:
 *      - Если room.id матчится на существующий Room — копируем
 *        scope/days/detergent в Room, ЕСЛИ они там пустые
 *        (не перезаписываем уже настроенное в /settings/buildings).
 *      - Если не матчится по id, ищем Room по name в любом
 *        Building орги. Тот же conditional copy.
 *      - Если Room вообще нет — пропускаем (legacy pairs-mode без
 *        Building'ов; такие доки продолжают работать на config.rooms).
 *   3. config.rooms НЕ удаляем — pairs-mode flow всё ещё его читает.
 *
 * Идемпотентно: повторный прогон ничего не меняет (защита через
 * «копируем только если в Room эти поля пусты»).
 *
 * Запускается на каждый deploy (см. .github/workflows/deploy.yml).
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

type CleaningRoomItem = {
  id?: string;
  name?: string;
  detergent?: string;
  currentScope?: string[];
  generalScope?: string[];
  currentDays?: number;
  generalDays?: number;
};

function isEmptyScope(value: unknown): boolean {
  if (!Array.isArray(value)) return true;
  return value.length === 0;
}

async function main() {
  const orgs = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      buildings: {
        select: {
          rooms: {
            select: {
              id: true,
              name: true,
              detergent: true,
              currentScope: true,
              generalScope: true,
              currentDays: true,
              generalDays: true,
            },
          },
        },
      },
    },
  });

  let totalUpdated = 0;
  let totalCleaningDocs = 0;
  let totalSkipped = 0;
  let orgsTouched = 0;

  for (const org of orgs) {
    const dbRooms = org.buildings.flatMap((b) => b.rooms);
    const roomById = new Map(dbRooms.map((r) => [r.id, r]));
    const roomByName = new Map(
      dbRooms.map((r) => [r.name.trim().toLowerCase(), r]),
    );

    const cleaningDocs = await prisma.journalDocument.findMany({
      where: {
        organizationId: org.id,
        template: { code: "cleaning" },
      },
      select: { id: true, config: true },
    });
    totalCleaningDocs += cleaningDocs.length;
    if (cleaningDocs.length === 0) continue;

    let orgUpdated = 0;
    for (const doc of cleaningDocs) {
      const cfg = (doc.config ?? {}) as { rooms?: CleaningRoomItem[] };
      const rooms = Array.isArray(cfg.rooms) ? cfg.rooms : [];
      for (const cri of rooms) {
        if (!cri.id && !cri.name) continue;

        const dbRoom =
          (cri.id ? roomById.get(cri.id) : null) ??
          (cri.name
            ? roomByName.get(cri.name.trim().toLowerCase())
            : null);
        if (!dbRoom) {
          totalSkipped += 1;
          continue;
        }

        // Conditional copy: не перезаписываем настройки которые уже
        // есть в Room. Если /settings/buildings уже отредактирован —
        // оставляем как есть.
        const patch: {
          detergent?: string;
          currentScope?: unknown;
          generalScope?: unknown;
          currentDays?: number;
          generalDays?: number;
        } = {};

        if (
          (!dbRoom.detergent || dbRoom.detergent === "") &&
          cri.detergent &&
          cri.detergent.trim().length > 0
        ) {
          patch.detergent = cri.detergent.trim();
        }
        if (
          isEmptyScope(dbRoom.currentScope) &&
          Array.isArray(cri.currentScope) &&
          cri.currentScope.length > 0
        ) {
          patch.currentScope = cri.currentScope.filter(
            (s) => typeof s === "string" && s.trim().length > 0,
          );
        }
        if (
          isEmptyScope(dbRoom.generalScope) &&
          Array.isArray(cri.generalScope) &&
          cri.generalScope.length > 0
        ) {
          patch.generalScope = cri.generalScope.filter(
            (s) => typeof s === "string" && s.trim().length > 0,
          );
        }
        if (
          dbRoom.currentDays === 127 && // default
          typeof cri.currentDays === "number" &&
          cri.currentDays !== 127
        ) {
          patch.currentDays = cri.currentDays;
        }
        if (
          dbRoom.generalDays === 0 && // default
          typeof cri.generalDays === "number" &&
          cri.generalDays !== 0
        ) {
          patch.generalDays = cri.generalDays;
        }

        if (Object.keys(patch).length === 0) continue;

        await prisma.room.update({
          where: { id: dbRoom.id },
          data: patch,
        });
        orgUpdated += 1;
        totalUpdated += 1;
      }
    }
    if (orgUpdated > 0) {
      orgsTouched += 1;
      console.log(
        `[cleaning-unification] org "${org.name}" — updated ${orgUpdated} room(s) from ${cleaningDocs.length} cleaning doc(s)`,
      );
    }
  }

  console.log(
    `[cleaning-unification] done: orgs=${orgs.length}, orgsTouched=${orgsTouched}, cleaningDocs=${totalCleaningDocs}, roomsUpdated=${totalUpdated}, skippedNoMatchingRoom=${totalSkipped}`,
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
