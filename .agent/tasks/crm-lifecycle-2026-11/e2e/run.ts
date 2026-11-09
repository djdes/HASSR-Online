/**
 * Прогон автоворонки на локальной БД с переводом времени и отчёт по базе.
 *
 *   npx tsx .agent/tasks/crm-lifecycle-2026-11/e2e/run.ts [ISO-время] [--report]
 */
import "dotenv/config";

import { db } from "../../../../src/lib/db";
import { runLifecycle } from "../../../../src/lib/crm/lifecycle/run.server";

if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) {
  console.error("run: only for a local database");
  process.exit(1);
}

async function report() {
  const deals = await db.crmDeal.findMany({ where: { organizationId: { startsWith: "lc-" } }, orderBy: { organizationId: "asc" } });
  const orgs = new Map((await db.organization.findMany({ where: { id: { startsWith: "lc-" } }, select: { id: true, name: true } })).map((org) => [org.id, org.name]));
  const users = new Map((await db.user.findMany({ where: { organizationId: "platform" }, select: { id: true, name: true } })).map((user) => [user.id, user.name]));
  console.log("\n== Сделки");
  for (const deal of deals) {
    const offer = deal.offerJson as { tier?: string; points?: number; discountPercent?: number; segment?: string } | null;
    console.log(
      `${orgs.get(deal.organizationId)} | ${deal.kind} | ${deal.stage}${deal.stageManual ? " (руками)" : ""} | ответственный: ${deal.ownerId ? users.get(deal.ownerId) : "—"} | ${offer?.tier}/${offer?.points}т/${offer?.discountPercent}%/${offer?.segment} | счёт: ${deal.invoiceOrderId ?? "—"} | договор: ${deal.contractSignedAt ? "да" : "нет"}${deal.lostReason ? ` | ${deal.lostReason}` : ""}`,
    );
  }
  const tasks = await db.crmTask.findMany({ where: { organizationId: { startsWith: "lc-" } }, orderBy: [{ organizationId: "asc" }, { createdAt: "asc" }] });
  console.log("\n== Задачи");
  for (const task of tasks) {
    console.log(`${orgs.get(task.organizationId ?? "")} | ${task.scenario} | ${task.kind} | ${task.status}${task.result ? `/${task.result}` : ""} | ${task.assigneeId ? users.get(task.assigneeId) : "—"} | ${task.title}`);
  }
  const invoices = await db.paymentOrder.findMany({ where: { organizationId: { startsWith: "lc-" }, paymentMethod: "invoice" }, orderBy: { id: "asc" }, select: { id: true, organizationId: true, amountRub: true, status: true, description: true } });
  console.log("\n== Счета");
  for (const invoice of invoices) console.log(`№${invoice.id} ${orgs.get(invoice.organizationId ?? "")} ${Number(invoice.amountRub)} ₽ ${invoice.status} — ${invoice.description}`);
  const timeline = await db.crmInteraction.count({ where: { externalKey: { startsWith: "lc:" } } });
  console.log(`\n== Записей автоворонки в лентах контактов: ${timeline}`);
}

async function main() {
  const args = process.argv.slice(2);
  const iso = args.find((arg) => !arg.startsWith("--"));
  if (iso) {
    const now = new Date(iso);
    const result = await runLifecycle({ now, force: true });
    console.log(`== Прогон ${now.toISOString()}: просмотрено ${result.scanned}, сделки ${JSON.stringify(result.deals)}, письма ${JSON.stringify(result.messages)}, задачи ${JSON.stringify(result.tasks)}`);
    for (const line of result.log) console.log(`  ${line}`);
    for (const error of result.errors) console.log(`  ОШИБКА ${error}`);
  }
  if (args.includes("--report")) await report();
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
