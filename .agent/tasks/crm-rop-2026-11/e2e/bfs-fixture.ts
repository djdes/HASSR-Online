/** Локально: компания «БФС» — владелец с Telegram (станет РОП) и повар с Telegram (не станет). */
import "dotenv/config";
import { db } from "../../../../src/lib/db";

if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) process.exit(1);
const extra = Number(process.argv[2] ?? 0);

async function main() {
  await db.organization.upsert({ where: { id: "fixture-bfs" }, update: {}, create: { id: "fixture-bfs", name: "БФС", type: "restaurant", legalFullName: "ООО «БФС»" } });
  await db.user.upsert({ where: { email: "boss@bfs.local.test" }, update: {}, create: { email: "boss@bfs.local.test", name: "Владелец БФС", role: "owner", organizationId: "fixture-bfs", telegramChatId: "111222333", passwordHash: "x" } });
  await db.user.upsert({ where: { email: "cook@bfs.local.test" }, update: {}, create: { email: "cook@bfs.local.test", name: "Повар БФС", role: "cook", organizationId: "fixture-bfs", telegramChatId: "444555666", passwordHash: "x" } });
  for (let i = 0; i < extra; i += 1) {
    await db.user.upsert({ where: { email: `manager${i}@bfs.local.test` }, update: {}, create: { email: `manager${i}@bfs.local.test`, name: `Менеджер ${i}`, role: "manager", organizationId: "fixture-bfs", telegramChatId: `77700${i}`, passwordHash: "x" } });
  }
  console.log("bfs fixture ready", { extra });
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await db.$disconnect(); process.exit(process.exitCode ?? 0); });
