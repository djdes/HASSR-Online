/**
 * One-shot rename: «Гигиенический журнал» →
 * «Гигиенический журнал (сотрудники)».
 *
 * Заказчик попросил называть журнал так, как на его бланке (форма
 * Приложения №1 СанПиН). Название в коде поправили, и обычный seed
 * обновляет шаблон. Но у уже созданных документов заголовок лежит в БД
 * строкой с момента создания («Гигиенический журнал — 16–30 сентября
 * 2026»), и действующие документы так и назывались бы по-старому.
 *
 * Безопасно: трогаем только АКТИВНЫЕ документы шаблона hygiene, у которых
 * заголовок ровно «Гигиенический журнал» или начинается с «Гигиенический
 * журнал — » (автоназвание «журнал — период»). Период после тире
 * сохраняется. Закрытые документы — архив, их не переименовываем.
 * Названия, набранные вручную, под эти правила не попадут.
 *
 * Идемпотентно: новое название с «Гигиенический журнал — » не начинается,
 * и следующий запуск обновит 0 строк. Запускается на каждый deploy
 * (см. .github/workflows/deploy.yml).
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TEMPLATE_CODE = "hygiene";
const OLD_TITLE = "Гигиенический журнал";
const NEW_TITLE = "Гигиенический журнал (сотрудники)";
/** Автоназвание документа: «<журнал> — <период>» (journal-document-title.ts). */
const OLD_PREFIX = `${OLD_TITLE} — `;

async function main() {
  const template = await prisma.journalTemplate.findUnique({
    where: { code: TEMPLATE_CODE },
    select: { id: true, name: true },
  });
  if (!template) {
    console.log(`[rename-hygiene] шаблон ${TEMPLATE_CODE} не найден — нечего делать`);
    return;
  }

  if (template.name !== NEW_TITLE) {
    await prisma.journalTemplate.update({
      where: { id: template.id },
      data: { name: NEW_TITLE },
    });
    console.log(`[rename-hygiene] шаблон: «${template.name}» → «${NEW_TITLE}»`);
  }

  const exact = await prisma.journalDocument.updateMany({
    where: { templateId: template.id, status: "active", title: OLD_TITLE },
    data: { title: NEW_TITLE },
  });

  // Хвост с периодом у каждого документа свой — поэтому по одному. Условие
  // на прежний заголовок: если его успели поменять руками, не трогаем.
  const prefixed = await prisma.journalDocument.findMany({
    where: { templateId: template.id, status: "active", title: { startsWith: OLD_PREFIX } },
    select: { id: true, title: true },
  });
  let withPeriod = 0;
  for (const document of prefixed) {
    const updated = await prisma.journalDocument.updateMany({
      where: { id: document.id, title: document.title },
      data: { title: `${NEW_TITLE}${document.title.slice(OLD_TITLE.length)}` },
    });
    withPeriod += updated.count;
  }

  console.log(
    `[rename-hygiene] документов переименовано: ${exact.count + withPeriod} (без периода: ${exact.count}, с периодом: ${withPeriod})`
  );
}

main()
  .catch((error) => {
    console.error("[rename-hygiene] ошибка:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
