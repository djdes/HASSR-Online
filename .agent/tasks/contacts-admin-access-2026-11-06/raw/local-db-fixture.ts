/**
 * Local fixture for verifying prisma/seed-platform-admin-2026-11.ts against a
 * throwaway Postgres: platform org + owner, a client org with alexey@wesetup.ru.
 * Run: DATABASE_URL=... npx tsx .agent/tasks/contacts-admin-access-2026-11-06/raw/local-db-fixture.ts [reset]
 */
import "dotenv/config";
import { db } from "../../../../src/lib/db";

async function main() {
  if (process.argv.includes("reset")) {
    await db.platformSetting.deleteMany({ where: { key: "once:platform-admin:alexey:v1" } });
    await db.user.updateMany({ where: { email: "alexey@wesetup.ru" }, data: { platformSections: [], platformGrantedAt: null, platformGrantedById: null } });
    console.log("reset done");
    return;
  }
  await db.organization.upsert({ where: { id: "platform" }, update: {}, create: { id: "platform", name: "WeSetup Platform", type: "platform" } });
  await db.organization.upsert({ where: { id: "org-test" }, update: {}, create: { id: "org-test", name: "Тестовое кафе", type: "restaurant" } });
  await db.user.upsert({
    where: { email: "owner@wesetup.test" },
    update: {},
    create: { email: "owner@wesetup.test", name: "Владелец Платформы", passwordHash: "x", organizationId: "platform", isRoot: true, role: "manager" },
  });
  await db.user.upsert({
    where: { email: "alexey@wesetup.ru" },
    update: {},
    create: { email: "alexey@wesetup.ru", name: "Алексей Тестов", passwordHash: "x", organizationId: "org-test", role: "manager", telegramChatId: "100500" },
  });
  console.log("fixture ready");
}

main().finally(async () => {
  await db.$disconnect();
  process.exit(process.exitCode ?? 0);
});
