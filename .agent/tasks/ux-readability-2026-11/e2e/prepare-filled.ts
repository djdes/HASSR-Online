/**
 * Локальный стенд (только локальная база), AC8 «Сначала то, что осталось»:
 * `add` — одна запись «Журнала уборки» сегодня от управляющего демо-кухни
 * (журнал становится «заполнен сегодня»); `remove` — убрать её.
 * Запуск: npx tsx --env-file=.env .agent/tasks/ux-readability-2026-11/e2e/prepare-filled.ts add|remove
 */
import { db } from "@/lib/db";

if (!/@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Только для локальной базы: DATABASE_URL должен указывать на 127.0.0.1 или localhost");
}

const ORG_ID = "demo-screenshots";
const MANAGER_EMAIL = "stage3-e2e-manager@example.test";
const MARK = { e2e: "ux-readability-ac8" };

async function main() {
  const mode = process.argv[2];
  const template = await db.journalTemplate.findFirstOrThrow({ where: { code: "cleaning" }, select: { id: true, name: true } });
  const removed = await db.journalEntry.deleteMany({
    where: { organizationId: ORG_ID, templateId: template.id, data: { equals: MARK } },
  });
  console.log("removed", removed.count);
  if (mode === "add") {
    const manager = await db.user.findFirstOrThrow({ where: { email: MANAGER_EMAIL }, select: { id: true } });
    const entry = await db.journalEntry.create({
      data: { organizationId: ORG_ID, templateId: template.id, filledById: manager.id, data: MARK },
      select: { id: true, createdAt: true },
    });
    console.log("added", template.name, entry.id, entry.createdAt.toISOString());
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
