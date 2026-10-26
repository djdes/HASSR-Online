// Серверная часть живой проверки (tariffs-limits-ui AC2, AC6): отказ приглашённому по
// местам (текст бота по `nextTier`) и опрос «Меркурия» по крону только с возможностью тарифа.
// Только локальная БД; сначала limits-scenarios.ts.
//
// DATABASE_URL=... CRON_SECRET=local npx tsx --tsconfig tsconfig.json .agent/tasks/tariffs-limits-ui-2026-10/raw/limits-server-check.ts
import { createTranslator } from "use-intl/core";

import { loadMessages } from "@/i18n/messages";
import { checkUserActivation } from "@/lib/billing.server";
import { db } from "@/lib/db";
import { GET as mercuryPoll } from "@/app/api/cron/mercury-poll/route";

async function orgOf(email: string): Promise<string> {
  const user = await db.user.findUnique({ where: { email }, select: { organizationId: true } });
  if (!user) throw new Error(`нет ${email} — сначала limits-scenarios.ts`);
  return user.organizationId;
}

async function main() {
  console.info = () => {};
  console.log("=== Приглашённый принимает приглашение, места заняты: текст бота по следующему тарифу");
  const messages = await loadMessages("ru");
  const t = createTranslator({ locale: "ru", messages, namespace: "telegram.bot.errors" });
  for (const owner of ["lim-free@example.test", "lim-std-full@example.test", "lim-prem-full@example.test"]) {
    const organizationId = await orgOf(owner);
    const email = `lim-invitee-${owner.split("@")[0]}@example.test`;
    const invitee = await db.user.upsert({
      where: { email },
      update: { organizationId, isActive: false, archivedAt: null },
      create: { email, name: "Приглашённый", passwordHash: "", role: "cook", organizationId, isActive: false, journalAccessMigrated: true },
    });
    const seats = await checkUserActivation(invitee.id, { source: "limits-check", audience: "invitee" });
    if (seats.ok) {
      console.log(`-- ${owner}: места есть — ОШИБКА`);
      continue;
    }
    // Тот же выбор ключа, что в `bot/handlers/start.ts`.
    const key =
      seats.nextTier === "standard" ? "inviteSeatLimit" : seats.nextTier === "premium" ? "inviteSeatLimitPremium" : "inviteSeatLimitContact";
    console.log(`-- ${owner}: nextTier=${seats.nextTier} · сервер: «${seats.error}»`);
    console.log(`   бот: «${t(key, { limit: seats.limit })}»`);
  }

  console.log("\n=== Крон опроса «Меркурия»: «Стандарт» пропускается, «Премиум» опрашивается");
  const rows: Array<[string, string]> = [];
  for (const owner of ["lim-std-full@example.test", "lim-prem-full@example.test"]) {
    const organizationId = await orgOf(owner);
    const integration = await db.mercuryIntegration.upsert({
      where: { organizationId },
      update: { enabled: true },
      create: { organizationId, issuerGuid: "00000000-0000-0000-0000-000000000001", initiatorLogin: "check", enabled: true },
    });
    const guid = `limits-check-${organizationId}`;
    const existing = await db.mercuryEnterprise.findFirst({ where: { integrationId: integration.id, enterpriseGuid: guid } });
    if (!existing) {
      await db.mercuryEnterprise.create({ data: { integrationId: integration.id, organizationId, enterpriseGuid: guid, name: "Площадка проверки" } });
    }
    rows.push([owner, integration.id]);
  }
  const before = new Map<string, number>();
  for (const [, id] of rows) before.set(id, await db.mercuryOutbox.count({ where: { integrationId: id } }));
  const response = await mercuryPoll(new Request("http://localhost/api/cron/mercury-poll", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
  const body = (await response.json()) as Record<string, unknown>;
  console.log(`-- ответ крона: HTTP ${response.status} · integrations=${body.integrations} · enqueued=${body.enqueued} · skippedPlan=${body.skippedPlan}`);
  for (const [owner, id] of rows) {
    const after = await db.mercuryOutbox.count({ where: { integrationId: id } });
    console.log(`   ${owner}: заявок в очереди +${after - (before.get(id) ?? 0)}`);
  }
  // Уборка: проверочные интеграции выключаем, чтобы не мешали другим проверкам.
  for (const [, id] of rows) {
    await db.mercuryOutbox.deleteMany({ where: { integrationId: id } });
    await db.mercuryIntegration.update({ where: { id }, data: { enabled: false } });
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
