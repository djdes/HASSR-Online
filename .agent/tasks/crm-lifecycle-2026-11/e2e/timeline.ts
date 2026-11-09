/**
 * Хронология на локальной БД: ежедневная задача биллинга + автоворонка с
 * переводом времени, между прогонами — события (оплата счёта). Как на проде:
 * биллинг раз в день, автоворонка из прогона CRM.
 *
 *   npx tsx .agent/tasks/crm-lifecycle-2026-11/e2e/timeline.ts
 */
import "dotenv/config";

import { runBillingTransitionJob } from "../../../../src/lib/billing.server";
import { db } from "../../../../src/lib/db";
import { markInvoicePaid } from "../../../../src/lib/invoices/service";
import { runLifecycle } from "../../../../src/lib/crm/lifecycle/run.server";

if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) {
  console.error("timeline: only for a local database");
  process.exit(1);
}

type Step = { at: string; label: string } | { event: string; run: () => Promise<string> };

const STEPS: Step[] = [
  { at: "2026-11-09T07:30:00Z", label: "пн 9 ноября 10:30 — за 4 дня до конца пробного (13-го)" },
  {
    event: "Ресторан «Оплатили» оплатил счёт из письма",
    run: async () => {
      const deal = await db.crmDeal.findFirst({ where: { organizationId: "lc-paid" }, select: { invoiceOrderId: true } });
      if (!deal?.invoiceOrderId) return "счёта нет";
      const result = await markInvoicePaid(deal.invoiceOrderId, null);
      return result.ok ? `счёт № ${deal.invoiceOrderId} оплачен` : result.error;
    },
  },
  { at: "2026-11-09T09:05:00Z", label: "пн 9 ноября 12:05 — после оплаты" },
  { at: "2026-11-11T07:30:00Z", label: "ср 11 ноября 10:30 — за 2 дня" },
  { at: "2026-11-14T09:00:00Z", label: "сб 14 ноября 12:00 — пробный кончился, грейс" },
  { at: "2026-11-18T07:30:00Z", label: "ср 18 ноября 10:30 — за 2 дня до отключения" },
  { at: "2026-11-21T07:30:00Z", label: "сб 21 ноября 10:30 — грейс кончился: автопереход" },
  { at: "2026-11-26T08:30:00Z", label: "чт 26 ноября 11:30 — после автоперехода" },
];

async function main() {
  for (const step of STEPS) {
    if ("event" in step) {
      console.log(`\n### Событие: ${step.event} → ${await step.run()}`);
      continue;
    }
    const now = new Date(step.at);
    console.log(`\n### ${step.label}`);
    const billing = await runBillingTransitionJob({ now });
    const skipped = billing.results.filter((row) => row.outcome === "crm lifecycle sends it").length;
    console.log(
      `биллинг: напоминаний пробного ${billing.trialReminded}, оплаты ${billing.paidReminded}, «выберите тариф» ${billing.reminded}, автопереход ${billing.autoFree}, тихо бесплатный ${billing.silentFree}; отдано автоворонке: ${skipped}`,
    );
    const result = await runLifecycle({ now, force: true });
    console.log(`автоворонка: сделки ${JSON.stringify(result.deals)}, письма ${JSON.stringify(result.messages)}, задачи ${JSON.stringify(result.tasks)}`);
    for (const line of result.log.filter((item) => !/e2e/.test(item) === false)) console.log(`  ${line}`);
    for (const error of result.errors) console.log(`  ОШИБКА ${error}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });
