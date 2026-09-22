import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkCronSecret } from "@/lib/cron-auth";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { SANITATION_DAY_TEMPLATE_CODE } from "@/lib/sanitation-day-document";
import { sanitationDayAdapter } from "@/lib/tasksflow-adapters/sanitation-day";
import { orgTodayKey } from "@/lib/timezone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/general-cleaning-tasks?secret=$CRON_SECRET
 *
 * Каждый час (crontab `5 * * * *`). Генеральная уборка по графику — это
 * задача в TasksFlow В ДЕНЬ уборки: для каждой включённой интеграции
 * (организация не на паузе, журнал не выключен) берём активные документы
 * «График и учет генеральных уборок», покрывающие сегодняшний день по
 * поясу организации, и прогоняем планировщик адаптера. Он кладёт в
 * TasksFlowOutbox создание задач на сегодняшние плановые уборки и
 * удаление задач по датам, убранным из плана. Повторный запуск в тот же
 * день ничего не дублирует: ключи команд детерминированы (П-13, П-19),
 * а ссылка TaskLink уже есть.
 *
 * Час — чтобы у организации в любом поясе задачи появились вскоре после
 * полуночи по её времени.
 */
export async function GET(request: Request) {
  const authError = checkCronSecret(request);
  if (authError) return authError;

  const integrations = await db.tasksFlowIntegration.findMany({
    where: {
      enabled: true,
      organization: { subscriptionPlan: { notIn: ["paused", "cancelled"] } },
    },
    include: {
      organization: { select: { timezone: true, disabledJournalCodes: true } },
    },
  });

  let documents = 0;
  let queuedCreate = 0;
  let queuedDelete = 0;
  let queuedComplete = 0;
  let skippedNoLink = 0;
  const errors: Array<{ documentId: string; error: string }> = [];

  for (const integration of integrations) {
    const disabled = parseDisabledCodes(integration.organization.disabledJournalCodes);
    if (disabled.has(SANITATION_DAY_TEMPLATE_CODE)) continue;
    const todayKey = orgTodayKey(integration.organization.timezone ?? undefined);
    const today = new Date(`${todayKey}T00:00:00.000Z`);
    const docs = await db.journalDocument.findMany({
      where: {
        organizationId: integration.organizationId,
        status: "active",
        template: { code: SANITATION_DAY_TEMPLATE_CODE },
        dateFrom: { lte: today },
        dateTo: { gte: today },
      },
      select: { id: true },
    });
    for (const doc of docs) {
      documents += 1;
      try {
        const report = await sanitationDayAdapter.syncDocument({
          integration,
          documentId: doc.id,
        });
        queuedCreate += report.created;
        queuedDelete += report.deleted;
        queuedComplete += report.updated;
        skippedNoLink += report.skippedNoLink.length;
      } catch (err) {
        console.error("[general-cleaning-tasks] sync failed", doc.id, err);
        errors.push({
          documentId: doc.id,
          error: err instanceof Error ? err.message : "unknown",
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    integrations: integrations.length,
    documents,
    queuedCreate,
    queuedDelete,
    queuedComplete,
    skippedNoLink,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
  });
}
