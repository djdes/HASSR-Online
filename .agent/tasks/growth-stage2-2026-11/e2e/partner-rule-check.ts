/**
 * Сценарий прода для правил партнёров (локальный стенд): действует только
 * v1 (20 %), выпущенная в сентябре → после выкладки появляется v2 с 30 %;
 * повторный вызов ничего не добавляет.
 * Запуск: npx tsx --env-file=.env .agent/tasks/growth-stage2-2026-11/e2e/partner-rule-check.ts
 */
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { ensureRewardRule2026_11, getCurrentRewardRule } from "@/lib/partners/schema-extras";

async function main() {
  await db.partnerRewardRule.deleteMany({});
  await db.partnerRewardRule.create({
    data: {
      version: 1,
      subscriptionPercent: new Prisma.Decimal(20),
      subscriptionMonths: 12,
      hardwarePercent: new Prisma.Decimal(15),
      bonusAmountRub: new Prisma.Decimal(3000),
      bonusAfterPayments: 2,
      minPayoutRub: new Prisma.Decimal(1000),
      effectiveFrom: new Date("2026-09-22T10:00:00Z"),
      createdAt: new Date("2026-09-22T10:00:00Z"),
      comment: "Стартовые правила партнёрской программы",
    },
  });
  const current = await getCurrentRewardRule();
  await ensureRewardRule2026_11();
  const rows = await db.partnerRewardRule.findMany({ orderBy: { version: "asc" }, select: { version: true, subscriptionPercent: true, comment: true } });
  console.log(JSON.stringify({ current, rows: rows.map((row) => ({ ...row, subscriptionPercent: Number(row.subscriptionPercent) })) }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
