/**
 * Проверка сидера второй волны на локальной базе:
 *   reset — удалить флаг once:new-journals-2026-09b-default-off:v1 (чтобы
 *           прогнать сидер по организациям-фикстурам);
 *   show  — показать флаг и disabledJournalCodes организаций-фикстур.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import pg from "pg";

if (!/wesetup_wt_mc/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("только для локальной базы wesetup_wt_mc");
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const KEY = "once:new-journals-2026-09b-default-off:v1";

async function main() {
  const mode = process.argv[2] ?? "show";
  if (mode === "reset") {
    await prisma.platformSetting.deleteMany({ where: { key: KEY } });
    console.log("flag removed");
    return;
  }
  const flag = await prisma.platformSetting.findUnique({ where: { key: KEY } });
  const users = await prisma.user.findMany({
    where: { email: { startsWith: "e2e-bj-" } },
    select: { email: true, organization: { select: { type: true, disabledJournalCodes: true } } },
    orderBy: { email: "asc" },
  });
  console.log(
    JSON.stringify(
      {
        flag: flag?.value ?? null,
        orgs: users.map((u) => ({
          email: u.email,
          type: u.organization.type,
          disabledJournalCodes: u.organization.disabledJournalCodes,
        })),
      },
      null,
      2,
    ),
  );
}

main().finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
