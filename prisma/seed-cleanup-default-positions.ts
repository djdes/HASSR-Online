/**
 * One-shot cleanup: удаляет 18 канонических default-должностей,
 * которые были авто-засеяны старым seed-job-positions.ts ДО фикса
 * 691ac3f2 (там был блок «если у org 0 positions, seed 18 default»).
 *
 * Безопасно: удаляет position ТОЛЬКО если она:
 *   1. Имеет name из known default-list (точное совпадение)
 *   2. Имеет 0 связанных users (jobPositionId = position.id)
 *   3. Не имеет JobPositionJournalAccess записей
 *
 * Если хоть одна связь — оставляем (юзер мог использовать).
 *
 * Идемпотентно: после прогона следующий запуск удалит 0 строк.
 * Запускается на каждый deploy (см. .github/workflows/deploy.yml).
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Точно тот же список что был в удалённом src/lib/default-job-positions.ts.
// НЕ переиспользуем его (файл удалён) — копируем как константу здесь,
// чтобы скрипт работал автономно. Этот список используется ТОЛЬКО для
// удаления ранее-засеянных дефолтов; новые должности юзер создаёт сам.
const OLD_DEFAULT_NAMES = new Set<string>([
  // management
  "Управляющий",
  "Шеф-повар",
  "Руководитель качества",
  "Технолог",
  "Начальник производства",
  // staff
  "Су-шеф",
  "Повар горячего цеха",
  "Повар холодного цеха",
  "Повар-кондитер",
  "Повар",
  "Официант",
  "Бармен",
  "Посудомойщик",
  "Уборщик",
  "Кладовщик",
  "Товаровед",
  "Менеджер зала",
  "Грузчик",
]);

async function main() {
  // Берём все позиции с матчащим именем + проверяем links.
  const candidates = await prisma.jobPosition.findMany({
    where: { name: { in: [...OLD_DEFAULT_NAMES] } },
    select: {
      id: true,
      name: true,
      organizationId: true,
      _count: {
        select: {
          users: true,
          journalAccess: true,
          workShifts: true,
        },
      },
    },
  });

  let deleted = 0;
  let preservedLinked = 0;
  for (const p of candidates) {
    if (
      p._count.users > 0 ||
      p._count.journalAccess > 0 ||
      p._count.workShifts > 0
    ) {
      preservedLinked += 1;
      continue;
    }
    await prisma.jobPosition.delete({ where: { id: p.id } }).catch(() => {});
    deleted += 1;
  }
  console.log(
    `[seed-cleanup-default-positions] deleted=${deleted} preserved_linked=${preservedLinked} total_candidates=${candidates.length}`,
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
