/**
 * Прогон сценария на локальной БД с реальным now: сделки воронки, письма в
 * ловушку SMTP, задачи. Повторный прогон — ничего нового (дедупликация).
 *
 *   SMTP_HOST=127.0.0.1 SMTP_PORT=2526 npx tsx .agent/tasks/crm-funnel-v2-2026-11/e2e/run.ts
 */
import "dotenv/config";

import { db } from "../../../../src/lib/db";
import { syncDeals } from "../../../../src/lib/lifecycle/deals.server";
import { runLifecycleJob } from "../../../../src/lib/lifecycle/job.server";

if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) {
  console.error("run: only for a local database");
  process.exit(1);
}

async function main() {
  console.log("deals sync:", JSON.stringify(await syncDeals()));
  const first = await runLifecycleJob();
  console.log("run 1:", JSON.stringify({ planned: first.planned, emails: first.emails, invoices: first.invoices, tasks: first.tasks, failed: first.failed }));
  for (const row of first.results) console.log(`  ${row.unit} ${row.stage}: ${row.outcome}`);
  const second = await runLifecycleJob();
  console.log("run 2:", JSON.stringify({ planned: second.planned, emails: second.emails, invoices: second.invoices, tasks: second.tasks, failed: second.failed }));
  const tasks = await db.crmTask.findMany({ orderBy: { createdAt: "asc" }, select: { kind: true, title: true, status: true, assigneeId: true, discountPercent: true, approvalStatus: true, dealId: true } });
  console.log(`tasks: ${tasks.length}`);
  for (const task of tasks) console.log(`  [${task.kind}/${task.status}${task.approvalStatus ? `/${task.approvalStatus}` : ""}] ${task.title} · deal=${task.dealId ? "да" : "нет"} · скидка=${task.discountPercent ?? "—"}`);
  const deals = await db.crmDeal.findMany({ orderBy: { periodEnd: "asc" }, select: { kind: true, stage: true, organizationId: true, contractSignedAt: true, messageSentAt: true } });
  console.log(`deals: ${deals.length}`);
  for (const deal of deals) console.log(`  ${deal.organizationId} ${deal.kind}: ${deal.stage}${deal.contractSignedAt ? " · договор" : ""}${deal.messageSentAt ? " · письмо" : ""}`);
  const auto = await db.crmReminderLog.count({ where: { dedupeKey: { startsWith: "lc:invoice:" } } });
  console.log(`automatic invoices marked: ${auto}`);
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
