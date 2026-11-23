/**
 * One-shot (владелец, 2026-11-23): «Мы не считаем офис за объект… Если журнал
 * в офисе уже создан и там не указан объект, то привязывать к единственному
 * созданному или первому по списку объекту». Документы электронных и бумажных
 * журналов, привязанные к офису, переходят на единственный объект
 * организации, а если объектов несколько — на первый по списку (порядок
 * объектов, затем название). Организации без объектов не трогаются. Каждый
 * перенос — в журнал действий организации (`journals.office_to_point`).
 * Новые документы на офис больше не создаются: окно создания и API требуют
 * объект, автосоздание раздаёт документы только объектам.
 *
 * Ключ `once:office-journals-to-points:v1`: второй раз не запускается. Лог
 * Actions публичный — в лог только счётчики и id, без названий.
 *
 * Запуск: npx tsx prisma/seed-office-journals-to-points-2026-11.ts [--dry-run]
 * На деплое — см. .github/workflows/deploy.yml.
 */
import "dotenv/config";

import { db } from "../src/lib/db";
import { moveOfficeJournalsToPoints } from "../src/lib/office-journals.server";

const DRY_RUN = process.argv.includes("--dry-run");
const TAG = DRY_RUN ? "[office-journals:dry-run]" : "[office-journals]";
const ONCE_KEY = "once:office-journals-to-points:v1";

async function main() {
  if (await db.platformSetting.findUnique({ where: { key: ONCE_KEY } })) {
    console.log(`${TAG} ${ONCE_KEY}: already done`);
    return;
  }
  const moves = await moveOfficeJournalsToPoints({ dryRun: DRY_RUN });
  for (const move of moves) {
    console.log(
      `${TAG} ${move.organizationId}: office ${move.officeId} → ${move.targetId ?? "no sites, skipped"}; ` +
        `documents ${move.documents}, paper ${move.paperDocuments}`,
    );
  }
  const moved = moves.filter((move) => move.targetId);
  const documents = moved.reduce((sum, move) => sum + move.documents, 0);
  const paper = moved.reduce((sum, move) => sum + move.paperDocuments, 0);
  // Итог — последней строкой: на выкладке лог обрезается `tail`.
  console.log(
    `${TAG} organizations ${moved.length} (without sites ${moves.length - moved.length}); ` +
      `${DRY_RUN ? "would move" : "moved"} documents ${documents}, paper ${paper}`,
  );
  if (!DRY_RUN) {
    await db.platformSetting.create({
      data: {
        key: ONCE_KEY,
        value: JSON.stringify({ at: new Date().toISOString(), organizations: moved.length, documents, paper }),
      },
    });
  }
}

main()
  .catch((error) => {
    console.error(`${TAG} failed:`, error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
