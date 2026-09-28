/**
 * Переименование журналов в уже созданных данных (идемпотентно, на каждом
 * деплое — см. .github/workflows/deploy.yml; имя файла прежнее, чтобы не
 * трогать деплой).
 *
 * История: сначала здесь было одно переименование журнала климата
 * («… температуры и влажности» → «… на складах»). 2026-09-28 владелец
 * переименовал оба журнала температуры: журнал складов — «Журнал учёта
 * температуры и влажности на складах» (слова «бланк» в названии журнала
 * быть не должно), холодильный — «Журнал учёта температурного режима
 * холодильного и морозильного оборудования» (форма Приложения № 2 к СанПиН
 * 2.3/2.4.4282-26). Списки старых и новых названий —
 * `src/lib/journal-title-renames.ts` (их же использует печать).
 *
 * Обычный seed обновляет имя шаблона по каталогу, а у созданных документов
 * заголовок лежит в БД строкой с момента создания. Здесь:
 *   • имя шаблона — на новое (если seed ещё не обновил);
 *   • документы шаблона, у которых заголовок ровно старое название или
 *     автоназвание «старое название — период», — на новое (период
 *     сохраняется). Любой статус: печать архивного документа тоже должна
 *     выходить с новым названием.
 * Названия, набранные вручную, под эти правила не попадут. Повторный запуск
 * обновит 0 строк.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import pg from "pg";

import { JOURNAL_TITLE_RENAMES, renamedJournalDocumentTitle } from "../src/lib/journal-title-renames";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  for (const rename of JOURNAL_TITLE_RENAMES) {
    const tag = `[rename-journal ${rename.code}]`;
    const template = await prisma.journalTemplate.findUnique({
      where: { code: rename.code },
      select: { id: true, name: true },
    });
    if (!template) {
      console.log(`${tag} шаблон не найден — нечего делать`);
      continue;
    }

    if (template.name !== rename.title) {
      await prisma.journalTemplate.update({
        where: { id: template.id },
        data: { name: rename.title },
      });
      console.log(`${tag} шаблон: «${template.name}» → «${rename.title}»`);
    }

    // Точное старое название — одним запросом.
    const exact = await prisma.journalDocument.updateMany({
      where: { templateId: template.id, title: { in: [...rename.legacyTitles] } },
      data: { title: rename.title },
    });

    // «Старое название — период» (и прежнее «· период», «(демо)»): хвост у
    // каждого свой — по одному. Какие разделители считаются хвостом, решает
    // renamedJournalDocumentTitle (её же зовёт печать); не переименовала —
    // не трогаем. Условие на прежний заголовок: если его успели поменять
    // руками, не трогаем.
    let withPeriod = 0;
    for (const legacy of rename.legacyTitles) {
      const prefixed = await prisma.journalDocument.findMany({
        where: { templateId: template.id, title: { startsWith: legacy } },
        select: { id: true, title: true },
      });
      for (const document of prefixed) {
        const next = renamedJournalDocumentTitle(rename.code, document.title);
        if (next === document.title) continue;
        const updated = await prisma.journalDocument.updateMany({
          where: { id: document.id, title: document.title },
          data: { title: next },
        });
        withPeriod += updated.count;
      }
    }

    console.log(
      `${tag} документов переименовано: ${exact.count + withPeriod} (без периода: ${exact.count}, с периодом: ${withPeriod})`
    );
  }
}

main()
  .catch((error) => {
    console.error("[rename-journal] ошибка:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
