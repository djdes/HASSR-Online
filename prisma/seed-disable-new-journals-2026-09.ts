/**
 * One-shot: новые журналы сентября 2026 (суточные пробы, витаминизация,
 * рацион, перевозка, бой посуды, вода в бассейне) у СУЩЕСТВУЮЩИХ
 * организаций — выключены.
 *
 * Почему: каталог хранит выключенные журналы негативным списком
 * (`disabledJournalCodes` = «всё, кроме»). Без этого сидера новые коды у
 * всех старых организаций оказались бы включёнными — шесть незнакомых
 * карточек на дашборде и «0/1» у каждой. Новые организации получают их
 * по правилам сферы (`defaultDisabledCodesFor`), их этот сидер не трогает.
 *
 * Что делаем: `applyNewJournalsDefaultOff` дописывает недостающие коды в
 * `disabledJournalCodes`. Документы и записи не трогаем; включить журнал
 * можно в /settings/journals. Анкета по-прежнему применяет набор сферы к
 * организациям, которые список сами не меняли (см. isUntouchedDisabledCodes).
 *
 * Однократно: после боевого прогона пишем PlatformSetting
 * `once:new-journals-2026-09-default-off:v1`, следующие деплои выходят
 * сразу — иначе журнал, который организация включила руками, снова
 * выключался бы при каждом деплое. Повторный прогон без флага тоже ничего
 * не меняет: у всех организаций коды уже в списке.
 *
 * Запуск: npx tsx prisma/seed-disable-new-journals-2026-09.ts [--dry-run]
 * На деплое — см. .github/workflows/deploy.yml (рядом с seed-disable-health-check).
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import pg from "pg";

import { applyNewJournalsDefaultOff } from "../src/lib/new-journals-default-off";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const ONCE_KEY = "once:new-journals-2026-09-default-off:v1";
const PLATFORM_ORG_ID = process.env.PLATFORM_ORG_ID || "platform";
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const tag = DRY_RUN ? "[new-journals-off:dry-run]" : "[new-journals-off]";

  const done = await prisma.platformSetting.findUnique({ where: { key: ONCE_KEY } });
  if (done) {
    console.log(`${tag} уже выполнено (${done.value}) — пропускаем`);
    return;
  }

  const orgs = await prisma.organization.findMany({
    where: { id: { not: PLATFORM_ORG_ID } },
    select: { id: true, name: true, disabledJournalCodes: true },
    orderBy: { createdAt: "asc" },
  });

  let switched = 0;
  let alreadyOff = 0;
  for (const org of orgs) {
    const next = applyNewJournalsDefaultOff(org.disabledJournalCodes);
    if (!next.changed) {
      alreadyOff += 1;
      continue;
    }
    switched += 1;
    console.log(`${tag} выключаем ${next.added.join(", ")}: ${org.name} (${org.id})`);
    if (DRY_RUN) continue;
    await prisma.organization.update({
      where: { id: org.id },
      data: { disabledJournalCodes: next.disabledJournalCodes as Prisma.InputJsonValue },
    });
  }

  const summary = `организаций: ${orgs.length}, уже выключены: ${alreadyOff}, выключено: ${switched}`;
  console.log(`${tag} итог — ${summary}`);

  if (!DRY_RUN) {
    await prisma.platformSetting.upsert({
      where: { key: ONCE_KEY },
      create: { key: ONCE_KEY, value: `${new Date().toISOString()} · ${summary}` },
      update: { value: `${new Date().toISOString()} · ${summary}` },
    });
  }
}

main()
  .catch((error) => {
    console.error("[new-journals-off] ошибка:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
