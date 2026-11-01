import { NextResponse } from "next/server";

import { hasPlanFeature } from "@/lib/billing.server";
import { checkCronSecret } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { countPendingVetDocumentsByPoint, enqueueEnterpriseSync } from "@/lib/mercury/sync";
import { withBuildingSuffix } from "@/lib/building-scope";
import { notifyManagement } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ADVISORY_LOCK_KEY = 9523852;

/**
 * GET /api/cron/mercury-poll?secret=$CRON_SECRET
 *
 * Раз в 10 минут ставит в очередь заявки «что изменилось» по каждой
 * подключённой площадке и напоминает о ВСД, у которых горит срок.
 *
 * Сам запросов в Ветис НЕ делает: всё уходит в `MercuryOutbox`, а
 * отправку и разбор ведёт `/api/cron/mercury-outbox`. Так соблюдается
 * П-15 (никаких блокировок и никаких прямых вызовов мимо очереди) и не
 * дублируется логика повторов.
 *
 * Внешнее расписание (crontab на сервере):
 *   *\/10 * * * * curl -s "https://wesetup.ru/api/cron/mercury-poll?secret=$CRON_SECRET" >/dev/null
 */
export async function GET(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;

  const started = Date.now();
  const [{ locked }] = await db.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS locked
  `;
  if (!locked) {
    return NextResponse.json({ ok: true, enqueued: 0, skipped: "another_tick_running" });
  }

  try {
    const integrations = await db.mercuryIntegration.findMany({
      where: { enabled: true },
      include: {
        enterprises: {
          where: { enabled: true },
          select: { id: true, enterpriseGuid: true },
        },
      },
    });

    let enqueued = 0;
    let reminded = 0;
    let skippedPlan = 0;

    for (const integration of integrations) {
      // «Меркурий» — возможность «Премиума» (пробного, прежней «Подписки»,
      // демо): без неё площадки не опрашиваем — тариф понизили или пробный
      // кончился. Вернут «Премиум» — опрос продолжится сам.
      if (!(await hasPlanFeature(integration.organizationId, "mercury"))) {
        skippedPlan += 1;
        continue;
      }
      for (const enterprise of integration.enterprises) {
        try {
          await enqueueEnterpriseSync({ integration, enterprise });
          enqueued += 1;
        } catch (error) {
          console.error("[mercury-poll] enqueue failed", integration.id, error);
          await db.mercuryIntegration.update({
            where: { id: integration.id },
            data: {
              lastSyncError:
                error instanceof Error ? error.message : String(error),
            },
          });
        }
      }

      // Напоминание о горящих сроках. Дедлайн гашения — один рабочий
      // день, и «забыли» здесь стоит дороже лишнего уведомления.
      const org = await db.organization.findUnique({
        where: { id: integration.organizationId },
        select: { timezone: true },
      });
      // По точкам (2026-11-01): напоминание о точке — её людям и офису,
      // а не всем руководителям организации.
      const counts = await countPendingVetDocumentsByPoint(
        integration.organizationId,
        org?.timezone,
      );
      const pointNames = new Map(
        (
          await db.building.findMany({
            where: { organizationId: integration.organizationId },
            select: { id: true, name: true },
          })
        ).map((building) => [building.id, building.name] as const),
      );
      for (const point of counts.points) {
        if (point.overdue <= 0) continue;
        const pointName = point.buildingId ? pointNames.get(point.buildingId) ?? null : null;
        await notifyManagement({
          organizationId: integration.organizationId,
          kind: "mercury-overdue",
          // Дедуп по дню и точке: напоминаем раз в сутки, а не каждые 10 минут.
          dedupeKey: `mercury-overdue:${integration.organizationId}:${point.buildingId ?? "org"}:${counts.todayKey}`,
          title: withBuildingSuffix(`Просрочено гашение ВСД: ${point.overdue}`, pointName),
          linkHref: "/mercury",
          linkLabel: "Входящие ВСД",
          items: [
            {
              id: "mercury-overdue",
              label:
                "Входящий ветеринарный документ гасится в течение одного рабочего дня",
              hint: `всего ждут гашения: ${point.pending}`,
            },
          ],
          buildingId: point.buildingId,
        }).catch(() => {});
        reminded += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      integrations: integrations.length,
      enqueued,
      reminded,
      skippedPlan,
      ms: Date.now() - started,
    });
  } catch (error) {
    console.error("[mercury-poll]", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  } finally {
    await db.$queryRaw`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`;
  }
}
