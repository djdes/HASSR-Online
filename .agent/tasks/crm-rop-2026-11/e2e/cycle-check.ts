/**
 * Проверка CRM на локальной БД: два прогона подряд (второй ничего не
 * создаёт), состояние контактов, напоминания и сводка в рабочее время
 * (подставное «утро»), повторная отправка отсекается ключом.
 *
 *   npx tsx .agent/tasks/crm-rop-2026-11/e2e/cycle-check.ts
 */
import "dotenv/config";

import { db } from "../../../../src/lib/db";
import { runCrmCycle } from "../../../../src/lib/crm/cycle.server";
import { runCrmDigest, runCrmReminders } from "../../../../src/lib/crm/notify.server";
import { moscowDateKey } from "../../../../src/lib/crm/reminders";

if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) {
  console.error("cycle-check: only for a local database");
  process.exit(1);
}

async function main() {
  const first = await runCrmCycle("manual");
  console.log("run 1 sources:", JSON.stringify(first.sources));
  console.log("run 1 errors:", JSON.stringify(first.errors));
  const second = await runCrmCycle("manual");
  console.log("run 2 sources:", JSON.stringify(second.sources));
  console.log("run 2 created total:", second.sources.reduce((sum, item) => sum + item.created, 0));

  const contacts = await db.crmContact.findMany({
    orderBy: { createdAt: "asc" },
    select: { name: true, email: true, phoneKey: true, stage: true, source: true, organizationId: true, awaitingSince: true, awaitingChannel: true, _count: { select: { interactions: true } } },
  });
  console.log("contacts:");
  for (const contact of contacts) {
    console.log(
      `  ${contact.name ?? "—"} | ${contact.email ?? "—"} | ${contact.phoneKey ?? "—"} | stage=${contact.stage} | source=${contact.source} | org=${contact.organizationId ?? "—"} | awaiting=${contact.awaitingSince ? `${contact.awaitingChannel}` : "no"} | items=${contact._count.interactions}`,
    );
  }
  const keys = await db.crmInteraction.groupBy({ by: ["externalKey"], _count: { _all: true }, having: { externalKey: { _count: { gt: 1 } } } });
  console.log("duplicate externalKeys:", keys.length);

  // Подставное утро: 09:30 по Москве следующего дня.
  const tomorrow = new Date(Date.now() + 24 * 3_600_000);
  const morning = new Date(`${moscowDateKey(tomorrow)}T09:30:00+03:00`);
  const reminders1 = await runCrmReminders(morning);
  const reminders2 = await runCrmReminders(morning);
  console.log("reminders at", morning.toISOString(), "run1:", JSON.stringify(reminders1), "run2:", JSON.stringify(reminders2));
  const digest1 = await runCrmDigest(morning);
  const digest2 = await runCrmDigest(morning);
  console.log("digest run1 delivered:", digest1, "run2 delivered:", digest2);
  const logs = await db.crmReminderLog.findMany({ orderBy: { sentAt: "asc" }, select: { kind: true, dedupeKey: true } });
  console.log("reminder log rows:", logs.length);
  for (const log of logs) console.log(`  ${log.kind} ${log.dedupeKey}`);
  const night = await runCrmReminders(new Date(`${moscowDateKey(tomorrow)}T02:00:00+03:00`));
  console.log("reminders at night:", JSON.stringify(night));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
