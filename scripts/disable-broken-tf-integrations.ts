/**
 * Один раз: проходим по всем TasksFlowIntegration, пытаемся
 * расшифровать apiKey текущим INTEGRATION_KEY_SECRET / NEXTAUTH_SECRET.
 * У тех, что fail — выставляем enabled = false. Это останавливает
 * cron'ы (sync-tasks, bulk-assign cleanup и т.п.) от попыток обращаться
 * к битым строкам и спама ошибок «Unsupported state or unable to
 * authenticate data» в pm2-логах.
 *
 * Идемпотентно — следующий прогон disable'нёт 0 строк (если все рабочие
 * остались рабочими). Запускается как часть deploy.yml seeds.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { decryptSecret } from "../src/lib/integration-crypto";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const rows = await prisma.tasksFlowIntegration.findMany({
    where: { enabled: true },
    select: {
      id: true,
      organizationId: true,
      apiKeyEncrypted: true,
      organization: { select: { name: true } },
    },
  });

  let disabledCount = 0;
  for (const r of rows) {
    try {
      decryptSecret(r.apiKeyEncrypted);
    } catch {
      await prisma.tasksFlowIntegration.update({
        where: { id: r.id },
        data: { enabled: false },
      });
      console.log(
        `[disable-broken-tf] DISABLED id=${r.id} org="${r.organization?.name ?? "?"}" — broken key`,
      );
      disabledCount += 1;
    }
  }
  console.log(
    `[disable-broken-tf] checked=${rows.length}, disabled=${disabledCount}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
